const { test, before, after } = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { createApp } = require('../server/start.cjs');
let server, base, version = 1;
const owner = crypto.randomBytes(32).toString('hex'), admin = crypto.randomBytes(32).toString('hex');
process.env.OWNER_TOKEN = owner;
process.env.ADMIN_TOKEN = admin;
before(async () => { const directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'data-workbench-test-')); server = createApp(directory).listen(0, '127.0.0.1'); await new Promise(r => server.once('listening', r)); base = 'http://127.0.0.1:' + server.address().port; });
after(async () => new Promise(r => server.close(r)));
async function call(route, token = '', body) { const r = await fetch(base + '/api/' + route, { method: body ? 'POST' : 'GET', headers: { Authorization: token ? 'Bearer ' + token : '', 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; }
test('anonymous visitor only reads empty configured structure', async () => { const r = await call('catalog'); assert.equal(r.status, 200); assert.equal(r.data.tables[0].rows.length, 0); assert.equal((await call('history')).status, 403); });
test('administrator adds new data but cannot back up whole workspace', async () => { const r = await call('commit', admin, { kind: 'merge', baseVersion: version, reason: '合成数据测试', payload: { tables: [{ name: '资料记录', headers: ['记录ID', '名称', '分类', '状态', '备注'], rows: [['demo-1', '合成记录', '测试', null, null]] }], assets: [] } }); assert.equal(r.status, 200); version = r.data.version; assert.equal((await call('backup', admin)).status, 403); });
test('stale revision cannot overwrite current data', async () => { assert.equal((await call('commit', owner, { kind: 'edit', baseVersion: 1, reason: '验证过期保护', table: '资料记录', key: 'demo-1', fields: { 名称: '过期值' } })).status, 409); });
test('creator restores baseline while retaining history', async () => { const r = await call('commit', owner, { kind: 'restore', baseVersion: version, reason: '恢复合成测试基线', targetVersion: 1 }); assert.equal(r.status, 200); assert.equal((await call('catalog')).data.tables[0].rows.length, 0); assert.equal((await call('history', owner)).data.length, 2); });
