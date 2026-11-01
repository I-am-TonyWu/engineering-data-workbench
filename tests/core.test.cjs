const { test } = require('node:test'), assert = require('node:assert/strict');
const { catalogChanges, undoChanges } = require('../.runtime/core.js'), { configureTables } = require('../.runtime/catalog.js');
const seed = () => ({ tables: [{ name: '记录', headers: ['ID', '名称', '备注'], rows: [['item-1', '初始值', null]] }], assets: [] });
test('schema starts empty and contains no deployment identity', () => { const s = require('../config/schema.json'); assert.equal(s.tables[0].rows.length, 0); assert.equal(s.assets.length, 0); });
test('changes are detected by stable record ID', () => { const a = seed(), b = seed(); configureTables(a.tables); b.tables[0].rows[0][1] = '修订值'; assert.equal(catalogChanges(a, b).length, 1); });
test('undo preserves subsequent edits to different fields', () => { const a = seed(), b = seed(); configureTables(a.tables); b.tables[0].rows[0][1] = '修订值'; const e = { changes: catalogChanges(a, b) }, live = structuredClone(b); live.tables[0].rows[0][2] = '后续备注'; const r = undoChanges(live, e); assert.equal(r.tables[0].rows[0][1], '初始值'); assert.equal(r.tables[0].rows[0][2], '后续备注'); });
test('undo blocks overlapping subsequent changes', () => { const a = seed(), b = seed(); configureTables(a.tables); b.tables[0].rows[0][1] = '修订值'; const e = { changes: catalogChanges(a, b) }; b.tables[0].rows[0][1] = '后续值'; assert.throws(() => undoChanges(b, e), /冲突/); });
