/**
 * CSV export.
 *
 * Export only in this version. Bulk import is deliberately not implemented yet
 * (see the implementation report): an importer that cannot detect duplicates and
 * bad coordinates safely is worse than no importer at all, because it corrupts a
 * dataset the Android app depends on.
 */

export interface CsvColumn<T> {
  key: string;
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

/** RFC 4180 escaping, plus a guard against spreadsheet formula injection. */
function escapeCell(input: string): string {
  // A leading =, +, - or @ makes Excel and Sheets treat the cell as a formula.
  // Prefixing a tab neutralises it while staying readable.
  const guarded = /^[=+\-@\t\r]/.test(input) ? `\t${input}` : input;

  if (/[",\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`;
  }
  return guarded;
}

export function toCsv<T>(rows: T[], columns: Array<CsvColumn<T>>): string {
  const header = columns.map((column) => escapeCell(column.header)).join(",");

  const body = rows.map((row) =>
    columns
      .map((column) => {
        const value = column.value(row);
        if (value === null || value === undefined) return "";
        return escapeCell(String(value));
      })
      .join(","),
  );

  return [header, ...body].join("\r\n");
}

/**
 * UTF-8 byte order mark.
 *
 * Without it, Excel on Windows reads Bangla names as mojibake — which for this
 * dataset makes the export useless.
 */
export const UTF8_BOM = "\uFEFF";

export function csvFilename(prefix: string, stamp = new Date()): string {
  const iso = stamp.toISOString().slice(0, 10);
  return `${prefix}-${iso}.csv`;
}
