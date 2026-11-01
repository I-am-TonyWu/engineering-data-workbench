import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Database, FolderInput, History, ImagePlus, RotateCcw, ShieldCheck } from 'lucide-react';
import { Workbook } from 'exceljs';
import JSZip from 'jszip';
import './style.css';
const roles = { user: '用户', admin: '资料管理员', creator: '应用创建人' };
function App() {
    const [token, setToken] = useState(sessionStorage.getItem('workbench-token') || ''), [session, setSession] = useState({ role: 'user' }), [data, setData] = useState<any>(null), [events, setEvents] = useState<any[]>([]), [page, setPage] = useState('query'), [query, setQuery] = useState(''), [table, setTable] = useState(''), [reason, setReason] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [selected, setSelected] = useState<any>(null), [file, setFile] = useState<File | null>(null), [target, setTarget] = useState('');
    const canManage = session.role !== 'user', owner = session.role === 'creator';
    async function api(url: string, options: any = {}) { const response = await fetch('/api/' + url, { ...options, headers: { Authorization: token ? 'Bearer ' + token : '', ...(options.body && !options.raw ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }); if (!response.ok) {
        let error;
        try {
            error = await response.json();
        }
        catch { }
        throw new Error(error?.error || '请求失败');
    } return options.binary ? response.arrayBuffer() : response.json(); }
    async function refresh() { try {
        const [s, d] = await Promise.all([api('session'), api('catalog')]);
        setSession(s);
        setData(d);
        if (s.role !== 'user')
            setEvents(await api('history'));
        else {
            setEvents([]);
            if (!['query', 'identity'].includes(page))
                setPage('query');
        }
    }
    catch (e: any) {
        setMessage(e.message);
    } }
    useEffect(() => { void refresh(); }, [token]);
    async function run(action: () => Promise<void>) { setBusy(true); setMessage(''); try {
        await action();
        await refresh();
    }
    catch (e: any) {
        setMessage(e.message);
    }
    finally {
        setBusy(false);
    } }
    async function commit(command: any) { const r = await api('commit', { method: 'POST', body: JSON.stringify({ ...command, baseVersion: data.version, reason }) }); setMessage(r.unchanged ? '内容未变化' : `已保存V${r.version}`); setSelected(null); }
    function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 30000); }
    async function template() { const w = new Workbook(); for (const t of data.tables) {
        const s = w.addWorksheet(t.name);
        s.addRow(t.headers);
        s.columns.forEach(c => { c.width = 24; c.numFmt = '@'; });
    } download(new Blob([await w.xlsx.writeBuffer()]), '资料导入模板.xlsx'); }
    async function readPackage(f: File) { if (f.size > 400 * 1024 * 1024)
        throw new Error("资料包不得超过400MB"); let workbookFile = f, assets: any[] = []; if (f.name.endsWith('.zip')) {
        const z = await JSZip.loadAsync(await f.arrayBuffer());
        const entries = Object.values(z.files);
        if (entries.length > 5000 || entries.reduce((n, e) => n + Number((e as any)._data?.uncompressedSize || 0), 0) > 700 * 1024 * 1024 || entries.some(e => Number((e as any)._data?.uncompressedSize || 0) > 100 * 1024 * 1024))
            throw new Error('压缩包文件数量或解压体积超限');
        const manifest = z.file('catalog.json');
        let catalog = manifest ? JSON.parse(await manifest.async('string')) : null;
        const x = Object.values(z.files).filter(e => !e.dir && e.name.endsWith('.xlsx'));
        if (!catalog && x.length !== 1)
            throw new Error('ZIP中需要一份Excel或备份catalog.json');
        for (const e of Object.values(z.files).filter(e => !e.dir && /\.(png|jpe?g|pdf)$/i.test(e.name))) {
            const bytes = await e.async('arraybuffer');
            const a = await api('upload?name=' + encodeURIComponent(e.name.split('/').pop()!), { method: 'PUT', body: bytes, raw: true, headers: { 'Content-Type': 'application/octet-stream' } });
            assets.push(a);
        }
        if (catalog) {
            catalog.assets = catalog.assets.map((a: any) => assets.find(b => b.sha256 === a.sha256) || a);
            return catalog;
        }
        workbookFile = new File([await x[0].async('arraybuffer')], 'data.xlsx');
    } const w = new Workbook(); await w.xlsx.load(await workbookFile.arrayBuffer()); return { tables: w.worksheets.map(s => ({ name: s.name, headers: s.getRow(1).values.slice(1).map(String), rows: s.getRows(2, Math.max(0, s.rowCount - 1))?.filter(r => r.getCell(1).text).map(r => s.getRow(1).values.slice(1).map((_, i) => { const v = r.getCell(i + 1).value; if (v === null || ['string', 'number', 'boolean'].includes(typeof v))
                return v; throw new Error('请使用文本或数值，不要使用公式'); })) || [] })), assets }; }
    async function backup() { const state = await api('backup'), z = new JSZip(); z.file('catalog.json', JSON.stringify(state.versions.find((v: any) => v.version === state.current).catalog)); z.file('history.json', JSON.stringify(state)); const assets = new Map(state.versions.flatMap((v: any) => v.catalog.assets).map((a: any) => [a.sha256, a])); for (const [sha, a] of assets as Map<string, any>)
        z.file('attachments/' + sha + '/' + a.name, await api('objects/' + sha, { binary: true })); download(await z.generateAsync({ type: 'blob' }), 'workspace-backup.zip'); setMessage('备份已生成'); }
    if (!data)
        return <main className="loading">{message || '正在读取工作台…'}</main>;
    const active = data.tables.find((t: any) => t.name === table) || data.tables[0], rows = active?.rows.filter((r: any[]) => r.join(' ').toLowerCase().includes(query.toLowerCase())) || [];
    const nav = [['query', '资料查询', Database], ['identity', '身份切换', ShieldCheck], ...(canManage ? [['review', '资料维护', Database], ['import', '资料导入', FolderInput], ['files', '附件管理', ImagePlus], ['history', '操作记录', History]] : []), ...(owner ? [['backup', '备份与更新', Database], ['recovery', '回滚与撤销', RotateCcw]] : [])];
    return <div className="app"><aside><h2>{data.title}</h2><nav>{nav.map(([id, label, Icon]: any) => <button key={id} className={page === id ? 'active' : ''} onClick={() => { setPage(id); setMessage(''); setSelected(null); }}><Icon size={18}/>{label}</button>)}</nav></aside><div className="body"><header><span>{nav.find(n => n[0] === page)?.[1] as string}</span><span>{roles[session.role as keyof typeof roles]}</span></header><main><div className="heading"><h1>{nav.find(n => n[0] === page)?.[1] as string}</h1><span>V{data.version}</span></div>{message && <p className="message" role="status">{message}</p>}
 {['query', 'review'].includes(page) && <section><div className="toolbar"><input aria-label="搜索资料" placeholder="输入名称、分类或字段内容" value={query} onChange={e => setQuery(e.target.value)}/><select aria-label="资料表" value={active?.name} onChange={e => setTable(e.target.value)}>{data.tables.map((t: any) => <option key={t.name}>{t.name}</option>)}</select></div><div className="table"><table><thead><tr>{active?.headers.map((h: string) => <th key={h}>{h}</th>)}{page === 'review' && <th>操作</th>}</tr></thead><tbody>{rows.map((r: any[]) => <tr key={r[0]}>{r.map((v, i) => <td key={i}>{String(v ?? '')}</td>)}{page === 'review' && <td><button onClick={() => setSelected([...r])}>编辑</button></td>}</tr>)}</tbody></table>{!rows.length && <p className="empty">暂无记录。管理员可通过模板导入资料。</p>}</div></section>}
 {page === 'identity' && <section><h2>当前身份：{roles[session.role as keyof typeof roles]}</h2><p>通过部署环境的认证适配器启用管理权限；默认访客只读。</p><label>管理凭证<input aria-label="管理凭证" type="password" value={token} onChange={e => { setToken(e.target.value); sessionStorage.setItem('workbench-token', e.target.value); }} autoComplete="off"/></label><button onClick={() => { setToken(''); sessionStorage.removeItem('workbench-token'); }}>退出管理身份</button></section>}
 {['import', 'backup', 'files'].includes(page) && <section><h2>{page === 'files' ? '附件上传与版本替换' : '导入已整理资料'}</h2><p>{page === 'files' ? 'PNG / JPG / JPEG图片≤20MB，PDF≤100MB。同名附件更新引用，旧文件保留。' : '首列为固定记录ID。Excel与附件可放在同一ZIP中；未知参数保留为空。'}</p><div className="toolbar">{page !== 'files' && <button onClick={() => void run(template)}>下载Excel模板</button>}{owner && page === 'backup' && <button onClick={() => void run(backup)}>下载完整备份</button>}</div><label>选择文件<input type="file" aria-label="选择文件" accept={page === 'files' ? '.png,.jpg,.jpeg,.pdf' : '.xlsx,.zip'} onChange={e => setFile(e.target.files?.[0] || null)}/></label><label>修改原因<textarea aria-label="修改原因" value={reason} onChange={e => setReason(e.target.value)}/></label><button disabled={busy || !file || reason.trim().length < 2} onClick={() => void run(async () => { if (page === 'files') {
        const asset = await api('upload?name=' + encodeURIComponent(file!.name), { method: 'PUT', body: await file!.arrayBuffer(), raw: true, headers: { 'Content-Type': 'application/octet-stream' } });
        await commit({ kind: 'merge', payload: { tables: [], assets: [asset] } });
    }
    else
        await commit({ kind: 'merge', payload: await readPackage(file!) }); })}>{busy ? '处理中…' : '核验并合并入库'}</button>{owner && page === 'backup' && <button className="danger" disabled={busy || !file || reason.trim().length < 2} onClick={() => { if (confirm('以导入包替换当前业务资料？历史版本仍保留。'))
        void run(async () => commit({ kind: 'replace', payload: await readPackage(file!) })); }}>以资料包替换整库</button>}</section>}
 {page === 'history' && <section>{events.map(e => <details key={e.id}><summary>V{e.version} · {e.actor.name} · {e.reason} · {new Date(e.time).toLocaleString()}</summary>{e.changes.map((c: any, i: number) => <div key={i}><h3>{c.table} · {c.key}</h3><pre>{JSON.stringify({ before: c.before, after: c.after }, null, 2)}</pre></div>)}</details>)}{!events.length && <p className="empty">暂无修改记录。</p>}</section>}
 {page === 'recovery' && <section><h2>选择编辑人及保存时点</h2><p>整库恢复会退回后续所有人的修改；撤销仅限最近30次未撤销的业务提交，同字段后续修改会触发冲突。</p><select aria-label="目标保存状态" value={target} onChange={e => setTarget(e.target.value)}><option value="">选择版本</option><option value="1">V1 · 初始基线</option>{events.map(e => <option key={e.id} value={e.id}>V{e.version} · {e.actor.name} · {e.reason}</option>)}</select><label>操作原因<textarea aria-label="恢复或撤销原因" value={reason} onChange={e => setReason(e.target.value)}/></label><button disabled={!target || reason.trim().length < 2 || busy} onClick={() => { if (confirm('恢复到所选版本之后的状态？'))
        void run(() => commit({ kind: 'restore', targetVersion: target === '1' ? 1 : events.find(e => e.id === target)?.version })); }}>恢复整库</button><button disabled={!target || target === '1' || reason.trim().length < 2 || busy} onClick={() => void run(() => commit({ kind: 'undo', targetId: target }))}>撤销该次提交</button></section>}
 {selected && <div className="overlay"><section className="editor"><h2>修订记录 · {selected[0]}</h2>{active.headers.map((h: string, i: number) => <label key={h}>{h}<input disabled={i === 0} value={String(selected[i] ?? '')} onChange={e => setSelected(selected.map((v: any, n: number) => n === i ? e.target.value : v))}/></label>)}<label>核验依据<textarea value={reason} onChange={e => setReason(e.target.value)}/></label><div className="toolbar"><button onClick={() => setSelected(null)}>取消</button><button disabled={busy || reason.trim().length < 2} onClick={() => void run(() => commit({ kind: 'edit', table: active.name, key: selected[0], fields: Object.fromEntries(active.headers.slice(1).map((h: string, i: number) => [h, selected[i + 1] || null])) }))}>确认修改并保存</button></div></section></div>}
 </main></div></div>;
}
createRoot(document.getElementById('root')!).render(<App />);
