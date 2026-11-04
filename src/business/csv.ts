/**
 * A small, strict CSV reader and writer (no dependency).
 *
 * Spreadsheet-formula injection is closed on the way out: a text cell that starts with = + - @ (or a tab or carriage return) would be run
 * as a formula by Excel, so it is written with a leading apostrophe, and the apostrophe is removed again on the way in. Business names
 * come from public data and website pages, so they are never trusted.
 */
const DANGEROUS = new Set(["=", "+", "-", "@", "\t", "\r"]);

const needsGuard = (s: string): boolean => s.length > 0 && (DANGEROUS.has(s[0]!) || (s[0] === "'" && s.length > 1 && DANGEROUS.has(s[1]!)));

export function guardCell(value: string): string {
  return needsGuard(value) ? `'${value}` : value;
}

export function unguardCell(value: string): string {
  return value.length > 1 && value[0] === "'" && needsGuard(value.slice(1)) ? value.slice(1) : value;
}

function quote(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export type Cell = string | number | null;

/** Header and rows to text. Numbers are written as they are (never guarded); text is guarded. */
export function toCsv(header: string[], rows: Cell[][]): string {
  const line = (cells: Cell[]) => cells.map((c) => (c === null ? "" : typeof c === "number" ? String(c) : quote(guardCell(c)))).join(",");
  return [line(header), ...rows.map(line)].join("\r\n") + "\r\n";
}

/** Text to rows of strings (the first row is the header). Tolerates a leading byte-order mark, CRLF or LF, and quoted newlines. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let touched = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += c;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      touched = true;
    } else if (c === ",") {
      row.push(cell);
      cell = "";
      touched = true;
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      if (touched || cell !== "" || row.length > 0) {
        row.push(cell);
        rows.push(row);
      }
      row = [];
      cell = "";
      touched = false;
    } else {
      cell += c;
      touched = true;
    }
  }
  if (touched || cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map(unguardCell));
}
