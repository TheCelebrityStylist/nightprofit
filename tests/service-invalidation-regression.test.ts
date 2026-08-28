import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("service-operation invalidation trigger", () => {
  it("uses table-specific branches instead of dereferencing absent record fields in CASE", () => {
    const migration = readFileSync("supabase/migrations/20260729001400_availability_venue_timezone.sql", "utf8");

    expect(migration).toContain("elsif tg_table_name='shifts'");
    expect(migration).toContain("affected_date:=source_row.starts_at::date");
    expect(migration).not.toContain("affected_date:=case tg_table_name");
  });
});
