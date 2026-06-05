import * as XLSX from "xlsx";

export function exportToExcel(
  sheets: { name: string; rows: Record<string, any>[] }[],
  filename: string,
): void {
  const wb = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, `${filename}.xlsx`);
}
