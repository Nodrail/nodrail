/**
 * A cell a spreadsheet would read as a formula starts with one of these. Agents
 * write resources and parameters, so their text is never trusted to be inert.
 */
const formulaStart = /^[=+\-@\t\r]/;

/** One CSV field: formulas neutralised with `'`, then quoted as RFC 4180 asks. */
export function csvField(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  const inert = formulaStart.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(inert) ? `"${inert.replaceAll('"', '""')}"` : inert;
}

/** A whole CSV document, CRLF line endings as RFC 4180 specifies. */
export function toCsv(
  header: readonly string[],
  rows: readonly (readonly (string | number | null | undefined)[])[],
) {
  return [header, ...rows]
    .map((row) => row.map(csvField).join(","))
    .join("\r\n")
    .concat("\r\n");
}
