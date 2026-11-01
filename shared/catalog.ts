import type { CatalogPayload, DataTable, CellValue } from './api.interface';
export const TABLE_KEYS: Record<string, string> = {};
export function configureTables(tables: DataTable[]): void { for (const table of tables)
    TABLE_KEYS[table.name] = table.headers[0]; }
export const getTable = (data: CatalogPayload, name: string): DataTable | undefined => data.tables.find(t => t.name === name);
export const text = (value: CellValue | undefined): string => value === null || value === undefined ? '' : String(value);
