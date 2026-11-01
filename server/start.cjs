const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), express = require('express'), ts = require('typescript');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, '.runtime'), { recursive: true });
for (const name of ['catalog', 'core']) {
    const source = fs.readFileSync(path.join(root, 'shared', name + '.ts'), 'utf8');
    fs.writeFileSync(path.join(root, '.runtime', name + '.js'), ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const { catalogChanges, undoChanges } = require('../.runtime/core.js'), { configureTables } = require('../.runtime/catalog.js'), { identity } = require('./auth.cjs');
function createApp(directory = path.join(root, '.data')) {
    fs.mkdirSync(path.join(directory, 'objects'), { recursive: true });
    const stateFile = path.join(directory, 'state.json');
    let state = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { current: 1, versions: [{ version: 1, catalog: { tables: JSON.parse(fs.readFileSync(path.join(root, 'config/schema.json'))).tables, assets: [] }, event: null }], uploads: [], attempts: [] };
    const current = () => state.versions.find(v => v.version === state.current).catalog;
    const persist = () => { fs.writeFileSync(stateFile + '.tmp', JSON.stringify(state)); fs.renameSync(stateFile + '.tmp', stateFile); };
    const deny = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
    const manage = req => { const actor = identity(req); if (actor.role === 'user')
        deny('需要资料管理员或创建人身份', 403); return actor; };
    const app = express();
    app.use('/api', (req, res, next) => { if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)
        return res.status(403).json({ error: 'Origin rejected' }); next(); });
    app.use(express.json({ limit: '16mb' }));
    app.get('/api/session', (req, res) => res.json(identity(req)));
    app.get('/api/catalog', (_req, res) => res.json({ ...current(), version: state.current, title: JSON.parse(fs.readFileSync(path.join(root, 'config/schema.json'))).title }));
    app.get('/api/history', (req, res) => { manage(req); res.json(state.versions.filter(v => v.event).map(v => v.event).reverse()); });
    app.get('/api/backup', (req, res) => { if (manage(req).role !== 'creator')
        deny('仅创建人可以完整备份', 403); res.json(state); });
    app.get('/api/objects/:sha', (req, res) => { const sha = String(req.params.sha); if (!/^[a-f0-9]{64}$/.test(sha))
        deny('Invalid attachment'); const allowed = (identity(req).role === 'user' ? current().assets : state.versions.flatMap(v => v.catalog.assets).concat(state.uploads)).some(a => a.sha256 === sha); if (!allowed)
        deny('Attachment not available', 404); res.sendFile(path.join(directory, 'objects', sha)); });
    app.put('/api/upload', express.raw({ type: '*/*', limit: '100mb' }), (req, res) => { const actor = manage(req), name = String(req.query.name || ''); if (!Buffer.isBuffer(req.body) || !req.body.length || path.basename(name) !== name || !name || !(/\.(png|jpe?g|pdf)$/i.test(name)))
        deny('支持PNG/JPG/JPEG/PDF，文件名不得包含路径'); const b = req.body; const mime = /\.pdf$/i.test(name) ? 'application/pdf' : /\.png$/i.test(name) ? 'image/png' : 'image/jpeg'; if (mime.startsWith('image/') && b.length > 20 * 1024 * 1024)
        deny('图片不得超过20MB'); const valid = mime === 'application/pdf' ? b.subarray(0, 5).toString() === '%PDF-' : mime === 'image/png' ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : b[0] === 255 && b[1] === 216 && b[2] === 255; if (!valid)
        deny('文件扩展名与内容不符'); const sha = crypto.createHash('sha256').update(b).digest('hex'), asset = { key: name.replace(/\.[^.]+$/, ''), name, filePath: sha, mimeType: mime, size: b.length, sha256: sha }; fs.writeFileSync(path.join(directory, 'objects', sha), b); state.uploads.push(asset); state.attempts.push({ actor, time: new Date().toISOString(), action: 'upload', name }); persist(); res.json(asset); });
    app.post('/api/commit', (req, res) => {
        const actor = manage(req), c = req.body;
        if (c.baseVersion !== state.current)
            deny('资料版本已变化，请刷新后重试', 409);
        if (typeof c.reason !== 'string' || c.reason.trim().length < 2 || c.reason.length > 1000)
            deny('请填写修改原因');
        if (['replace', 'restore', 'undo'].includes(c.kind) && actor.role !== 'creator')
            deny('此操作仅限创建人', 403);
        let next = structuredClone(current());
        if (c.kind === 'edit') {
            const t = next.tables.find(t => t.name === c.table), row = t?.rows.find(r => String(r[0]) === c.key);
            if (!row || !c.fields || typeof c.fields !== 'object')
                deny('记录不存在');
            for (const [key, value] of Object.entries(c.fields)) {
                const i = t.headers.indexOf(key);
                if (i <= 0)
                    deny('不能修改固定编号或未知字段');
                row[i] = value;
            }
        }
        else if (c.kind === 'merge' || c.kind === 'replace') {
            const incoming = c.payload;
            if (!incoming || !Array.isArray(incoming.tables) || !Array.isArray(incoming.assets))
                deny('导入结构错误');
            if (c.kind === 'replace')
                next = structuredClone(incoming);
            else {
                for (const t of incoming.tables) {
                    const old = next.tables.find(x => x.name === t.name);
                    if (!old)
                        next.tables.push(t);
                    else {
                        if (JSON.stringify(t.headers) !== JSON.stringify(old.headers))
                            deny('表头与已有结构不一致');
                        for (const row of t.rows) {
                            const i = old.rows.findIndex(r => String(r[0]) === String(row[0]));
                            if (i < 0)
                                old.rows.push(row);
                            else if (actor.role !== 'creator' && JSON.stringify(row) !== JSON.stringify(old.rows[i]))
                                deny('管理员请逐条修订已有记录', 403);
                            else
                                old.rows[i] = row;
                        }
                    }
                }
                for (const asset of incoming.assets) {
                    const i = next.assets.findIndex(a => a.key === asset.key);
                    if (i < 0)
                        next.assets.push(asset);
                    else
                        next.assets[i] = asset;
                }
            }
        }
        else if (c.kind === 'restore') {
            const target = state.versions.find(v => v.version === c.targetVersion);
            if (!target)
                deny('目标版本不存在');
            next = structuredClone(target.catalog);
        }
        else if (c.kind === 'undo') {
            const eligible = state.versions.filter(v => v.event && !['undo', 'restore'].includes(v.event.kind)).slice(-30);
            const target = eligible.find(v => v.event.id === c.targetId);
            if (!target || state.versions.some(v => v.event?.kind === 'undo' && v.event.targetId === c.targetId))
                deny('只能撤销最近30次尚未撤销的提交');
            configureTables(next.tables);
            try {
                next = undoChanges(next, target.event);
            }
            catch (e) {
                deny(e.message);
            }
        }
        else
            deny('未知操作');
        if (next.tables.length > 30 || next.assets.length > 10000)
            deny('资料规模超限');
        const names = new Set();
        for (const t of next.tables) {
            if (typeof t.name !== 'string' || !t.name || names.has(t.name) || !Array.isArray(t.headers) || !t.headers.length || new Set(t.headers).size !== t.headers.length || t.headers.length > 120 || t.rows.length > 50000)
                deny('表结构无效');
            names.add(t.name);
            const ids = new Set();
            for (const row of t.rows) {
                if (row.length !== t.headers.length || typeof row[0] !== 'string' || !row[0] || ids.has(row[0]) || row.some(v => !(v === null || ['string', 'number', 'boolean'].includes(typeof v)) || typeof v === 'number' && !Number.isFinite(v) || typeof v === 'string' && v.length > 20000))
                    deny('记录编号重复、数据类型或列数错误');
                ids.add(row[0]);
            }
        }
        const trusted = state.versions.flatMap(v => v.catalog.assets).concat(state.uploads);
        const keys = new Set();
        for (const a of next.assets) {
            if (keys.has(a.key) || !trusted.some(t => t.sha256 === a.sha256 && t.filePath === a.filePath && t.size === a.size && t.mimeType === a.mimeType))
                deny('附件未核验或重复');
            keys.add(a.key);
        }
        configureTables([...current().tables, ...next.tables]);
        const changes = catalogChanges(current(), next);
        if (!changes.length)
            return res.json({ version: state.current, unchanged: true });
        const event = { id: crypto.randomUUID(), kind: c.kind === 'merge' ? 'project-import' : c.kind, actor, time: new Date().toISOString(), reason: c.reason, baseVersion: state.current, version: state.current + 1, changes, ...(c.targetId ? { targetId: c.targetId } : {}) };
        const previous = state;
        state = { ...state, current: event.version, versions: [...state.versions, { version: event.version, catalog: next, event }] };
        try {
            persist();
        }
        catch (e) {
            state = previous;
            throw e;
        }
        res.json({ version: state.current });
    });
    app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
    app.use((err, _req, res, _next) => res.status(err.status || 400).json({ error: err.message }));
    return app;
}
module.exports = { createApp };
if (require.main === module && !process.argv.includes('--compile-only'))
    (async () => { const app = createApp(), port = Number(process.env.PORT || 5273); if (process.env.NODE_ENV === 'production') {
        app.use(express.static(path.join(root, 'dist')));
        app.get('*', (_req, res) => res.sendFile(path.join(root, 'dist/index.html')));
    }
    else {
        const { createServer } = await import('vite');
        const vite = await createServer({ configFile: path.join(root, 'vite.config.mts'), server: { middlewareMode: true, ws: { port: port + 1 } } });
        app.use(vite.middlewares);
    } app.listen(port, '127.0.0.1', () => process.stdout.write(`http://127.0.0.1:${port}\n`)); })().catch(e => { process.stderr.write(e.stack + '\n'); process.exit(1); });
