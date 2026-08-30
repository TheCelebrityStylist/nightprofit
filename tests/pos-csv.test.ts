import { describe, expect, it } from "vitest";
import { detectDelimiter, dryRunPosCsv, inferPosLocale, sha256Hex, type PosColumnMapping } from "../lib/imports/pos-csv";

const mappings: PosColumnMapping[] = [
  ["id", "external_id"], ["timestamp", "timestamp"], ["date", "trading_date"],
  ["item", "item_name"], ["qty", "quantity"], ["gross", "gross_sales"],
  ["net", "net_sales"], ["vat", "vat"], ["payment", "payment_method"],
].map(([source, target]) => ({ source, target } as PosColumnMapping));

describe("POS CSV ingestion", () => {
  const dutchCsv = [
    "id;timestamp;date;item;qty;gross;net;vat;payment",
    'sale-1;2026-07-28T22:00:00+02:00;2026-07-28;"Gin, tonic";2;24,20;20,00;4,20;PIN',
  ].join("\n");

  it("detects locale delimiters without treating quoted commas as columns", () => {
    expect(detectDelimiter(dutchCsv)).toBe(";");
  });

  it("normalizes authoritative money to integer minor units", () => {
    const result = dryRunPosCsv(dutchCsv, mappings, "nl-NL");
    expect(result.rejected).toEqual([]);
    expect(result.accepted[0].grossSalesMinor).toBe(2420n);
    expect(result.accepted[0].attributes.payment_method).toBe("PIN");
  });

  it("infers decimal separators from mapped monetary columns", () => {
    const englishCsv = [
      "id,timestamp,date,item,qty,gross,net,vat,payment",
      "sale-1,2026-07-28T22:00:00Z,2026-07-28,Gin tonic,2,24.20,20.00,4.20,PIN",
    ].join("\n");
    expect(inferPosLocale(dutchCsv, mappings)).toBe("nl-NL");
    expect(inferPosLocale(englishCsv, mappings)).toBe("en-US");
    expect(dryRunPosCsv(englishCsv, mappings, inferPosLocale(englishCsv, mappings)).accepted[0].grossSalesMinor).toBe(2420n);
  });

  it("creates stable file evidence hashes", async () => {
    expect(await sha256Hex(dutchCsv)).toHaveLength(64);
    expect(await sha256Hex(dutchCsv)).toBe(await sha256Hex(dutchCsv));
  });

  it("returns a rejected-row report instead of partially trusting bad rows", () => {
    const result = dryRunPosCsv(`${dutchCsv}\nsale-2;bad;2026-07-28;Beer;1;5,00;4,59;0,41;Cash`, mappings, "nl-NL");
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toEqual([{ rowNumber: 3, code: "INVALID_TIMESTAMP", message: expect.any(String) }]);
  });
});
