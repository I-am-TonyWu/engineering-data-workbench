export type CellValue = string | number | boolean | null;
export interface DataTable {
    name: string;
    headers: string[];
    rows: CellValue[][];
    note?: string;
}
export interface AssetInfo {
    key: string;
    name: string;
    filePath: string;
    mimeType: string;
    size: number;
    sha256: string;
    replacesSha256?: string;
}
export interface CatalogPayload {
    tables: DataTable[];
    assets: AssetInfo[];
}
