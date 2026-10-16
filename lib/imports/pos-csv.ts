import { decimalToMinor } from "./locale-number";

export type PosLocale = "nl-NL" | "en-US";
export type PosColumn =
  | "external_id" | "timestamp" | "trading_date" | "item_name" | "category"
  | "modifier" | "quantity" | "gross_sales" | "net_sales" | "vat" | "discount"
  | "void" | "refund" | "complimentary" | "payment_method" | "terminal"
  | "external_staff_id" | "external_event_reference";

export interface PosColumnMapping {
  source: string;
  target: PosColumn;
}

export interface NormalizedPosRow {
  rowNumber: number;
  externalId: string;
  timestamp: string;
  tradingDate: string;
  itemName: string;
  quantity: string;
  grossSalesMinor: bigint;
  netSalesMinor: bigint;
  vatMinor: bigint;
  discountMinor: bigint;
  voidMinor: bigint;
  refundMinor: bigint;
  complimentaryMinor: bigint;
  attributes: Record<string, string>;
}

export interface PosDryRun {
  delimiter: "," | ";" | "\t";
  headers: string[];
  accepted: NormalizedPosRow[];
  rejected: Array<{ rowNumber: number; code: string; message: string }>;
}

export function detectDelimiter(source: string): "," | ";" | "\t" {
  const line = source.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0] ?? "";
  const counts = ([",", ";", "\t"] as const).map((delimiter) => ({
    delimiter,
    count: parseCsvLine(line, delimiter).length,
  }));
  counts.sort((left, right) => right.count - left.count);
  if (counts[0].count < 2) throw new Error("POS_DELIMITER_NOT_DETECTED");
  return counts[0].delimiter;
}

export function parseCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("POS_UNCLOSED_QUOTE");
  cells.push(cell.trim());
  return cells;
}

export function inferPosLocale(source: string, mappings: PosColumnMapping[]): PosLocale {
  const nl = (() => { try { return dryRunPosCsv(source, mappings, "nl-NL"); } catch { return null; } })();
  const en = (() => { try { return dryRunPosCsv(source, mappings, "en-US"); } catch { return null; } })();
  if (!nl && !en) throw new Error("UNSUPPORTED_POS_FORMAT");
  if (!en) return "nl-NL";
  if (!nl) return "en-US";
  if (nl.rejected.length !== en.rejected.length) return nl.rejected.length < en.rejected.length ? "nl-NL" : "en-US";
  const delimiter = detectDelimiter(source);
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(lines[0] ?? "", delimiter);
  const monetaryTargets = new Set(["gross_sales", "net_sales", "vat", "discount", "void", "refund", "complimentary"]);
  const monetaryIndexes = mappings
    .filter(mapping => monetaryTargets.has(mapping.target))
    .map(mapping => headers.indexOf(mapping.source))
    .filter(index => index >= 0);
  let commaDecimals = 0, dotDecimals = 0;
  for (const line of lines.slice(1, 51)) {
    const cells = parseCsvLine(line, delimiter);
    for (const index of monetaryIndexes) {
      const value = (cells[index] ?? "").trim();
      if (/^-?\d+(?:\.\d{3})*,\d{1,2}$/.test(value)) commaDecimals++;
      if (/^-?\d+(?:,\d{3})*\.\d{1,2}$/.test(value)) dotDecimals++;
    }
  }
  if (dotDecimals !== commaDecimals) return dotDecimals > commaDecimals ? "en-US" : "nl-NL";
  throw new Error("AMBIGUOUS_POS_NUMBER_LOCALE");
}

export function dryRunPosCsv(source: string, mappings: PosColumnMapping[], locale: PosLocale): PosDryRun {
  const delimiter = detectDelimiter(source);
  const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headers = parseCsvLine(lines[0] ?? "", delimiter);
  const indexByTarget = new Map(mappings.map(({ source: name, target }) => [target, headers.indexOf(name)]));
  for (const required of ["external_id", "timestamp", "trading_date", "item_name", "quantity", "gross_sales", "net_sales", "vat"] as const) {
    if ((indexByTarget.get(required) ?? -1) < 0) throw new Error(`POS_REQUIRED_MAPPING_${required.toUpperCase()}`);
  }

  const accepted: NormalizedPosRow[] = [];
  const rejected: PosDryRun["rejected"] = [];
  const value = (cells: string[], target: PosColumn) => cells[indexByTarget.get(target) ?? -1] ?? "";
  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const rowNumber = lineIndex + 1;
    try {
      const cells = parseCsvLine(lines[lineIndex], delimiter);
      const timestamp = new Date(value(cells, "timestamp"));
      if (Number.isNaN(timestamp.valueOf())) throw new Error("INVALID_TIMESTAMP");
      const tradingDate = value(cells, "trading_date");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(tradingDate)) throw new Error("INVALID_TRADING_DATE");
      const minor = (target: PosColumn) => decimalToMinor(value(cells, target) || "0", locale);
      const quantity = value(cells, "quantity");
      if (!/^-?\d+([.,]\d+)?$/.test(quantity)) throw new Error("INVALID_QUANTITY");
      accepted.push({
        rowNumber,
        externalId: value(cells, "external_id"),
        timestamp: timestamp.toISOString(),
        tradingDate,
        itemName: value(cells, "item_name"),
        quantity: quantity.replace(",", "."),
        grossSalesMinor: minor("gross_sales"),
        netSalesMinor: minor("net_sales"),
        vatMinor: minor("vat"),
        discountMinor: minor("discount"),
        voidMinor: minor("void"),
        refundMinor: minor("refund"),
        complimentaryMinor: minor("complimentary"),
        attributes: Object.fromEntries(mappings
          .filter(({ target }) => !["external_id", "timestamp", "trading_date", "item_name", "quantity", "gross_sales", "net_sales", "vat", "discount", "void", "refund", "complimentary"].includes(target))
          .map(({ source: name, target }) => [target, cells[headers.indexOf(name)] ?? ""])),
      });
    } catch (error) {
      rejected.push({
        rowNumber,
        code: error instanceof Error ? error.message : "INVALID_ROW",
        message: "Row was rejected during the dry run; no authoritative records were written.",
      });
    }
  }
  return { delimiter, headers, accepted, rejected };
}

export async function sha256Hex(contents: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(contents));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
