const FORMULA_PREFIX = /^[\t\r]*[=+\-@]/;

export function neutralizeSpreadsheetFormula(value: string): string {
  return FORMULA_PREFIX.test(value) ? `'${value}` : value;
}

export function csvCell(value: string | number | bigint | null | undefined): string {
  const text = neutralizeSpreadsheetFormula(value === null || value === undefined ? "" : String(value));
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvRow(values: ReadonlyArray<string | number | bigint | null | undefined>): string {
  return values.map(csvCell).join(",");
}
