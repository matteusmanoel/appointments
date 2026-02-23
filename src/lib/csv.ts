/**
 * Build a CSV row with quoted fields (handles commas and newlines).
 */
function escapeCsvField(value: string): string {
  const s = String(value ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Build CSV content from rows. Header is the first row.
 * Uses UTF-8; caller should use Blob with type "text/csv;charset=utf-8"
 * and optionally a BOM for Excel: \uFEFF.
 */
export function buildCsv(header: string[], rows: string[][]): string {
  const lines = [
    header.map(escapeCsvField).join(","),
    ...rows.map((row) => row.map(escapeCsvField).join(",")),
  ];
  return lines.join("\r\n");
}

/**
 * Trigger download of a CSV file. Optional BOM for Excel to recognize UTF-8.
 */
export function downloadCsv(content: string, filename: string): void {
  const bom = "\uFEFF";
  const blob = new Blob([bom + content], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
