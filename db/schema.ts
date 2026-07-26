import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
};

export const organisations = sqliteTable("organisations", {
  id: text("id").primaryKey(), name: text("name").notNull(), currency: text("currency").notNull().default("EUR"),
  locale: text("locale").notNull().default("nl-NL"), timezone: text("timezone").notNull().default("Europe/Amsterdam"), ...timestamps,
});
export const members = sqliteTable("organisation_members", {
  id: text("id").primaryKey(), organisationId: text("organisation_id").notNull().references(()=>organisations.id),
  email: text("email").notNull(), role: text("role",{enum:["owner","administrator","manager","bookkeeper","viewer"]}).notNull(), ...timestamps,
},t=>[uniqueIndex("member_org_email").on(t.organisationId,t.email)]);
export const venues = sqliteTable("venues", {
  id:text("id").primaryKey(),organisationId:text("organisation_id").notNull().references(()=>organisations.id),name:text("name").notNull(),
  timezone:text("timezone").notNull(),tradingCutoffMinutes:integer("trading_cutoff_minutes").notNull().default(360),...timestamps,
});
export const closingSessions = sqliteTable("closing_sessions", {
  id:text("id").primaryKey(),organisationId:text("organisation_id").notNull().references(()=>organisations.id),venueId:text("venue_id").notNull().references(()=>venues.id),
  tradingDate:text("trading_date").notNull(),status:text("status",{enum:["draft","submitted","approved","reopened","locked"]}).notNull(),
  expectedMinor:integer("expected_minor").notNull().default(0),accountedMinor:integer("accounted_minor").notNull().default(0),submittedBy:text("submitted_by"),...timestamps,
},t=>[uniqueIndex("close_venue_date").on(t.venueId,t.tradingDate)]);
export const closeSnapshots = sqliteTable("close_snapshots", {
  id:text("id").primaryKey(),organisationId:text("organisation_id").notNull().references(()=>organisations.id),closingSessionId:text("closing_session_id").notNull().references(()=>closingSessions.id),
  snapshotJson:text("snapshot_json").notNull(),hash:text("hash").notNull().unique(),createdAt:integer("created_at",{mode:"timestamp_ms"}).notNull(),
});
export const events = sqliteTable("events", {
  id:text("id").primaryKey(),organisationId:text("organisation_id").notNull().references(()=>organisations.id),venueId:text("venue_id").notNull().references(()=>venues.id),
  name:text("name").notNull(),startsAt:integer("starts_at",{mode:"timestamp_ms"}).notNull(),attendance:integer("attendance"),revenueMinor:integer("revenue_minor").notNull().default(0),directCostMinor:integer("direct_cost_minor").notNull().default(0),...timestamps,
});
export const products = sqliteTable("products", {
  id:text("id").primaryKey(),organisationId:text("organisation_id").notNull().references(()=>organisations.id),name:text("name").notNull(),sku:text("sku"),category:text("category").notNull(),...timestamps,
});
export const productCostHistory = sqliteTable("product_cost_history", {
  id:text("id").primaryKey(),organisationId:text("organisation_id").notNull().references(()=>organisations.id),productId:text("product_id").notNull().references(()=>products.id),
  effectiveDate:text("effective_date").notNull(),costMinor:integer("cost_minor").notNull(),sourceInvoiceId:text("source_invoice_id"),createdAt:integer("created_at",{mode:"timestamp_ms"}).notNull(),
});
export const supplierInvoices = sqliteTable("supplier_invoices", {
  id:text("id").primaryKey(),organisationId:text("organisation_id").notNull().references(()=>organisations.id),venueId:text("venue_id").references(()=>venues.id),
  fileKey:text("file_key").notNull(),fileHash:text("file_hash").notNull(),status:text("status",{enum:["uploaded","extracting","needs_review","confirmed","failed","archived"]}).notNull(),
  totalMinor:integer("total_minor"),extractionJson:text("extraction_json"),confirmedJson:text("confirmed_json"),...timestamps,
});
export const alerts = sqliteTable("alerts", {
  id:text("id").primaryKey(),organisationId:text("organisation_id").notNull().references(()=>organisations.id),venueId:text("venue_id").references(()=>venues.id),
  type:text("type").notNull(),severity:text("severity",{enum:["info","warning","critical"]}).notNull(),measuredMinor:integer("measured_minor"),comparisonMinor:integer("comparison_minor"),
  evidenceJson:text("evidence_json").notNull(),status:text("status",{enum:["open","reviewing","resolved"]}).notNull(),...timestamps,
});
export const auditLogs = sqliteTable("audit_logs", {
  id:text("id").primaryKey(),organisationId:text("organisation_id").notNull().references(()=>organisations.id),venueId:text("venue_id"),
  actorId:text("actor_id"),action:text("action").notNull(),entityType:text("entity_type").notNull(),entityId:text("entity_id").notNull(),
  beforeJson:text("before_json"),afterJson:text("after_json"),correlationId:text("correlation_id").notNull(),source:text("source").notNull(),createdAt:integer("created_at",{mode:"timestamp_ms"}).notNull(),
});
export const jobRuns = sqliteTable("job_runs", {
  id:text("id").primaryKey(),organisationId:text("organisation_id").notNull().references(()=>organisations.id),venueId:text("venue_id"),jobType:text("job_type").notNull(),
  idempotencyKey:text("idempotency_key").notNull().unique(),status:text("status").notNull(),attempts:integer("attempts").notNull().default(0),errorCode:text("error_code"),...timestamps,
});
