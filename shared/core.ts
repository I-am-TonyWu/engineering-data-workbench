import type { AssetInfo, CatalogPayload, CellValue, DataTable } from './api.interface';
import { getTable, TABLE_KEYS, text } from './catalog';
export type MaintenanceKind = 'edit' | 'attachment' | 'project-import' | 'merge' | 'replace' | 'restore' | 'undo';
export interface EditorAccount {
    id: string;
    name: string;
    role: 'user' | 'admin' | 'creator';
}
export interface EntityChange {
    table: string;
    key: string;
    before: Record<string, CellValue> | AssetInfo | DataTable | null;
    after: Record<string, CellValue> | AssetInfo | DataTable | null;
}
export interface MaintenanceEvent {
    id: string;
    kind: MaintenanceKind;
    actor: EditorAccount;
    time: string;
    reason: string;
    baseVersion: number;
    version: number;
    changes: EntityChange[];
    targetId?: string;
}
export interface AttemptEvent {
    id: string;
    actor: EditorAccount;
    time: string;
    action: string;
    status: '成功' | '失败' | '取消' | '未变化';
    detail: string;
}
export interface MaintenanceCommand {
    kind: MaintenanceKind;
    baseVersion: number;
    reason: string;
    payload?: CatalogPayload;
    table?: string;
    key?: string;
    fields?: Record<string, CellValue>;
    issueId?: string;
    issueState?: '已核验' | '不适用';
    targetId?: string;
    targetVersion?: number;
    confirmUnchanged?: boolean;
}
export interface MaintenancePreview {
    payload: CatalogPayload;
    changes: EntityChange[];
    errors: string[];
    warnings: string[];
}
export const KIND_LABELS: Record<MaintenanceKind, string> = { edit: '资料修订', attachment: '附件更新', 'project-import': '资料导入', merge: '总表合并', replace: '总表替换', restore: '整库回滚', undo: '撤销修改' };
const equal = (a: unknown, b: unknown): boolean => {
    if (a === b)
        return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object')
        return false;
    if (Array.isArray(a) || Array.isArray(b))
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, i) => equal(value, b[i]));
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && equal(Reflect.get(a, key), Reflect.get(b, key)));
};
function objects(table: DataTable): Map<string, Record<string, CellValue>> {
    const key = TABLE_KEYS[table.name];
    return new Map(table.rows.map(row => [text(row[table.headers.indexOf(key)]), Object.fromEntries(table.headers.map((h, i) => [h, row[i] ?? null]))]));
}
export function catalogChanges(before: CatalogPayload, after: CatalogPayload): EntityChange[] {
    const changes: EntityChange[] = [];
    for (const name of new Set([...before.tables, ...after.tables].map(t => t.name))) {
        const left = getTable(before, name), right = getTable(after, name);
        if (equal(left, right))
            continue;
        if (!left || !right || !TABLE_KEYS[name] || !equal(left.headers, right.headers)) {
            changes.push({ table: name, key: '整表结构', before: left ?? null, after: right ?? null });
            continue;
        }
        const a = objects(left), b = objects(right);
        for (const key of new Set([...a.keys(), ...b.keys()]))
            if (!equal(a.get(key), b.get(key)))
                changes.push({ table: name, key, before: a.get(key) ?? null, after: b.get(key) ?? null });
    }
    for (const key of new Set([...before.assets, ...after.assets].map(a => a.key))) {
        const a = before.assets.find(item => item.key === key), b = after.assets.find(item => item.key === key);
        if (!equal(a, b))
            changes.push({ table: '附件', key, before: a ?? null, after: b ?? null });
    }
    return changes;
}
export function mayMaintain(actor: EditorAccount, view: string): boolean {
    return actor.role === 'creator' && view === 'creator' || actor.role === 'admin' && view === 'admin';
}
export function authorizeMaintenance(actor: EditorAccount, view: string, kind: MaintenanceKind): void {
    if (!mayMaintain(actor, view))
        throw new Error('请先切换到已授权的资料管理员或应用创建人身份');
    if (['merge', 'replace', 'restore', 'undo'].includes(kind) && !(actor.role === 'creator' && view === 'creator'))
        throw new Error('此操作仅应用创建人可执行');
}
function cleanAssets(payload: CatalogPayload): CatalogPayload {
    return { tables: payload.tables, assets: payload.assets.map(asset => { const clean = { ...asset }; delete clean.replacesSha256; return clean; }) };
}
export function undoChanges(current: CatalogPayload, event: MaintenanceEvent): CatalogPayload {
    const next = structuredClone(current);
    for (const change of [...event.changes].reverse()) {
        if (change.table === '附件') {
            const index = next.assets.findIndex(a => a.key === change.key);
            if (!equal(next.assets[index] ?? null, change.after))
                throw new Error(`撤销冲突：附件${change.key}已被后续修改`);
            if (index >= 0)
                next.assets.splice(index, 1);
            if (change.before)
                next.assets.push(change.before as AssetInfo);
            continue;
        }
        const table = getTable(next, change.table);
        if (change.key === '整表结构') {
            if (!equal(table ?? null, change.after))
                throw new Error(`撤销冲突：${change.table}结构或内容已发生后续修改`);
            next.tables = next.tables.filter(t => t.name !== change.table);
            if (change.before)
                next.tables.push(change.before as DataTable);
            continue;
        }
        if (!table)
            throw new Error(`撤销冲突：${change.table}已不存在`);
        const index = table.rows.findIndex(r => text(r[table.headers.indexOf(TABLE_KEYS[table.name])]) === change.key);
        const live = index < 0 ? null : Object.fromEntries(table.headers.map((h, i) => [h, table.rows[index][i] ?? null]));
        const before = change.before as Record<string, CellValue> | null, after = change.after as Record<string, CellValue> | null;
        if (before && after && live) {
            for (const field of Object.keys(after).filter(h => !equal(before[h], after[h]))) {
                if (!equal(live[field], after[field]))
                    throw new Error(`撤销冲突：${change.table}/${change.key}/${field}已被后续修改`);
                table.rows[index][table.headers.indexOf(field)] = before[field] ?? null;
            }
        }
        else {
            if (!equal(live, after))
                throw new Error(`撤销冲突：${change.table}/${change.key}已被后续修改`);
            if (index >= 0)
                table.rows.splice(index, 1);
            if (before)
                table.rows.push(table.headers.map(h => before[h] ?? null));
        }
    }
    return next;
}
