import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pending = ["000100_automation_engine", "000200_pos_stock_reconciliation", "000300_stock_posting_preclose", "000400_reconciliation_execution", "000500_guided_reconciliation_close", "000600_workflow_least_privilege", "000700_reconciliation_uuid_min", "000800_pos_mapping_boundary", "000900_pos_connector_registry", "001000_reconciliation_recipe_units", "001100_membership_revocation"];

function migration(name: string) {
  return readFileSync(resolve(`supabase/migrations/20260729${name}.sql`), "utf8");
}

describe("pending migration safety", () => {
  it.each(pending)("keeps %s transactional", (name) => {
    const sql = migration(name).trim();
    expect(sql.startsWith("begin;")).toBe(true);
    expect(sql.endsWith("commit;")).toBe(true);
  });

  it("expands connector statuses only after reviewing legacy vocabulary", () => {
    const sql = migration(pending[0]);
    for (const status of ["disconnected", "connecting", "connected", "degraded", "error", "not_configured", "authorization_required", "syncing", "failed", "disabled"]) {
      expect(sql).toContain(`'${status}'`);
    }
    expect(sql).toContain("not valid");
    expect(sql).toContain("validate constraint integration_connections_connection_status_expanded_check");
    expect(sql.indexOf("validate constraint integration_connections_connection_status_expanded_check"))
      .toBeLessThan(sql.indexOf("drop constraint integration_connections_connection_status_check"));
    expect(sql).toContain("unknown connection status exists; inspect and migrate it explicitly");
  });

  it("does not delete or silently replace existing draft close lines", () => {
    const sql = migration(pending[4]);
    expect(sql).not.toMatch(/\bdelete\s+from\s+public\.closing_lines\b/i);
    expect(sql).toContain("existing_reconciliation_preparation_requires_explicit_repair");
    expect(sql).toContain("repair_reconciliation_close_preparation");
    expect(sql).toContain("close.preparation_repaired");
    expect(sql).toContain("'preparation_status','superseded'");
  });

  it("removes direct close-table mutations and exposes venue-aware RPCs", () => {
    const sql = migration(pending[4]);
    expect(sql).toContain("revoke all privileges on public.closing_sessions,public.closing_lines from anon,authenticated");
    expect(sql).toContain("create_close_draft");
    expect(sql).toContain("add_close_line");
    expect(sql).toContain("public.has_capability(target_organisation_id,target_close.venue_id,'close.create')");
    expect(sql).toContain("closing_lines_idempotency_unique");
  });

  it("qualifies cryptographic functions for secured function search paths", () => {
    for (const name of [pending[2], pending[3], pending[4]]) {
      const sql = migration(name);
      expect(sql).not.toMatch(/(?<!extensions\.)\bdigest\s*\(/);
    }
  });

  it("enforces venue-aware reads for workflow and private storage records", () => {
    const automation = migration(pending[0]);
    const stock = migration(pending[1]);
    const reconciliation = migration(pending[3]);
    expect(automation).toContain("public.has_venue_access(organisation_id,venue_id)");
    expect(stock).toContain("public.has_venue_access(organisation_id,venue_id)");
    expect(reconciliation).toContain("public.has_venue_access(organisation_id,venue_id)");
    expect(stock.match(/public\.has_venue_access\(\(storage\.foldername\(name\)\)\[1\]::uuid,\(storage\.foldername\(name\)\)\[2\]::uuid\)/g)).toHaveLength(2);
    expect(stock).not.toContain("create policy pos_imports_write");
    expect(stock).not.toContain("create policy bottle_vision_write");
  });

  it("removes API-role default mutation and function privileges", () => {
    const sql = migration(pending[5]);
    expect(sql).toContain("from anon, authenticated");
    expect(sql).toContain("grant select on");
    expect(sql).toContain("to authenticated");
    expect(sql).toContain("revoke all privileges on function %s from public, anon");
  });

  it("repairs UUID location ordering with an exact function precondition", () => {
    const sql = migration(pending[6]);
    expect(sql).toContain("'select min(id) id from public.stock_locations'");
    expect(sql).toContain(
      "'select (array_agg(id order by id))[1] id from public.stock_locations'",
    );
    expect(sql).toContain("if repaired_definition = function_definition");
    expect(sql).toContain("from public, anon");
  });

  it("keeps POS mapping writes protected and venue scoped", () => {
    const sql = migration(pending[7]);
    expect(sql).toContain("security definer");
    expect(sql).toContain("venue_id is not distinct from target_venue_id");
    expect(sql).toContain("source_mappings_confirmed_venue_unique");
    expect(sql.indexOf("create unique index source_mappings_confirmed_venue_unique"))
      .toBeLessThan(sql.indexOf("drop index public.source_mappings_confirmed_unique"));
    expect(sql).toContain("duplicate confirmed venue mapping exists");
  });

  it("seeds the POS connector required by mapping foreign keys", () => {
    const sql = migration(pending[8]);
    expect(sql).toContain("'pos_csv'");
    expect(sql).toContain("'Generic POS CSV'");
    expect(sql).toContain("on conflict(connector_key) do update");
  });

  it("normalizes volume recipes before stock-unit reconciliation", () => {
    const sql = migration(pending[9]);
    expect(sql).toContain("component_product.unit_volume_ml");
    expect(sql).toContain("c.quantity/nullif(component_product.unit_volume_ml,0)");
    expect(sql).toContain("c.quantity*10/nullif(component_product.unit_volume_ml,0)");
    expect(sql).toContain("c.quantity*1000/nullif(component_product.unit_volume_ml,0)");
  });

  it("removes disabled memberships from every authorization helper", () => {
    const sql = migration(pending[10]);
    for (const functionName of ["is_member", "has_role", "is_venue_member", "has_venue_access", "has_capability"]) {
      expect(sql).toContain(`function public.${functionName}`);
    }
    expect(sql.match(/member\.active/g)?.length).toBeGreaterThanOrEqual(5);
    expect(sql.match(/revoke all on function/g)?.length).toBeGreaterThanOrEqual(5);
  });

  it("binds approved corrections to an original movement in the same tenant scope", () => {
    const sql = migration(pending[10]);
    for (const predicate of [
      "original.organisation_id=target_organisation_id",
      "original.venue_id=target_venue_id",
      "original.location_id=target_location_id",
      "original.product_id=target_product_id",
      "original.movement_type<>'approved_correction'",
    ]) expect(sql).toContain(predicate);
    expect(sql).toContain("correction_scope_mismatch");
  });
});
