import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "../../../../lib/auth/require-membership";
import { dryRunPosCsv, inferPosLocale, sha256Hex, type PosColumnMapping, type PosLocale } from "../../../../lib/imports/pos-csv";
import { createSupabaseAdminClient } from "../../../../lib/supabase/admin";
import { assertSameOrigin, consumeRateLimit, opaqueRateLimitKey, securityErrorResponse } from "../../../../lib/http/security";

const MAX_POS_FILE_BYTES = 5 * 1024 * 1024;
const mappingSchema = z.array(z.object({
  source: z.string().min(1).max(200),
  target: z.enum([
    "external_id", "timestamp", "trading_date", "item_name", "category", "modifier",
    "quantity", "gross_sales", "net_sales", "vat", "discount", "void", "refund",
    "complimentary", "payment_method", "terminal", "external_staff_id", "external_event_reference",
  ]),
})).min(8).max(40);

const confirmSchema = z.object({
  action: z.literal("confirm"),
  organisationId: z.string().uuid(),
  venueId: z.string().uuid(),
  importId: z.string().uuid(),
});

const safeName = (name: string) => name.replaceAll("\\", "/").split("/").at(-1)?.replace(/[\r\n"\0]/g, "_").slice(0, 180) || "source.csv";
const filePath = (organisationId: string, venueId: string, importId: string) =>
  `${organisationId}/${venueId}/${importId}/source.csv`;

function detectLocale(csv: string, mappings: PosColumnMapping[]): PosLocale {
  return inferPosLocale(csv, mappings);
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    consumeRateLimit(await opaqueRateLimitKey(request, "pos-import", "request"), 20, 15 * 60_000);
    if (request.headers.get("content-type")?.includes("application/json")) {
      return confirmImport(confirmSchema.parse(await request.json()));
    }
    const form = await request.formData();
    const organisationId = z.string().uuid().parse(form.get("organisationId"));
    const venueId = z.string().uuid().parse(form.get("venueId"));
    const tradingDate = z.iso.date().parse(form.get("tradingDate"));
    const file = z.instanceof(File).parse(form.get("file"));
    const mappings = mappingSchema.parse(JSON.parse(z.string().parse(form.get("mappings"))));
    if (file.size < 1 || file.size > MAX_POS_FILE_BYTES) throw new Error("INVALID_FILE_SIZE");
    if (!["text/csv", "text/plain", "application/vnd.ms-excel", ""].includes(file.type)) throw new Error("INVALID_FILE_TYPE");
    if (!safeName(file.name).toLowerCase().endsWith(".csv")) throw new Error("INVALID_FILE_EXTENSION");

    const { user } = await requireMembership(organisationId, "close.create", venueId);
    const supabase = createSupabaseAdminClient();
    const contents = await file.text();
    if (contents.includes("\0")) throw new Error("INVALID_TEXT_FILE");
    const hash = await sha256Hex(contents);
    const { data: duplicate } = await supabase.from("pos_imports").select("id,status")
      .eq("organisation_id", organisationId).eq("connector_key", "pos_csv").eq("file_hash", hash)
      .neq("status", "superseded").maybeSingle();
    if (duplicate) return NextResponse.json({ errorCode: "DUPLICATE_POS_IMPORT", duplicateImportId: duplicate.id }, { status: 409 });

    const locale = detectLocale(contents, mappings);
    const dryRun = dryRunPosCsv(contents, mappings, locale);
    const importId = crypto.randomUUID();
    const storagePath = filePath(organisationId, venueId, importId);
    const { error: uploadError } = await supabase.storage.from("pos-imports").upload(
      storagePath,
      new Blob([contents], { type: "text/csv" }),
      { upsert: false, contentType: "text/csv" },
    );
    if (uploadError) throw uploadError;
    const { error: importError } = await supabase.from("pos_imports").insert({
      id: importId,
      organisation_id: organisationId,
      venue_id: venueId,
      connector_key: "pos_csv",
      trading_date: tradingDate,
      status: "dry_run",
      file_hash: hash,
      original_filename: safeName(file.name),
      delimiter: dryRun.delimiter,
      number_locale: locale,
      column_mapping: mappings,
      accepted_rows: dryRun.accepted.length,
      rejected_rows: dryRun.rejected.length,
      created_by: user.id,
    });
    if (importError) {
      await supabase.storage.from("pos-imports").remove([storagePath]);
      throw importError;
    }
    if (dryRun.rejected.length) {
      const { error } = await supabase.from("pos_rejected_rows").insert(dryRun.rejected.map((row) => ({
        organisation_id: organisationId,
        venue_id: venueId,
        import_id: importId,
        source_row_number: row.rowNumber,
        error_code: row.code,
        safe_values: {},
      })));
      if (error) throw error;
    }
    return NextResponse.json({
      importId,
      status: "dry_run",
      delimiter: dryRun.delimiter,
      locale,
      headers: dryRun.headers,
      acceptedCount: dryRun.accepted.length,
      rejectedCount: dryRun.rejected.length,
      rejectedRows: dryRun.rejected,
      fileHash: hash,
    }, { status: 201 });
  } catch (error) {
    const securityResponse = securityErrorResponse(error);
    if (securityResponse) return securityResponse;
    const rawCode = error instanceof Error ? error.message : "IMPORT_FAILED";
    const code = /^(INVALID_|POS_|UNSUPPORTED_POS_FORMAT|AMBIGUOUS_POS_NUMBER_LOCALE)/.test(rawCode) ? rawCode : "IMPORT_FAILED";
    console.error("pos_import_failed", {
      code,
      name: error instanceof Error ? error.name : "UnknownError",
    });
    const clientError = code.startsWith("INVALID_") || code.startsWith("POS_") || code === "UNSUPPORTED_POS_FORMAT" || code === "AMBIGUOUS_POS_NUMBER_LOCALE";
    return NextResponse.json({ errorCode: clientError ? code : "POS_IMPORT_FAILED" }, { status: clientError ? 400 : 500 });
  }
}

async function confirmImport(input: z.infer<typeof confirmSchema>) {
  const { user } = await requireMembership(input.organisationId, "close.create", input.venueId);
  const supabase = createSupabaseAdminClient();
  const { data: importRow, error } = await supabase.from("pos_imports")
    .select("id,status,file_hash,trading_date,column_mapping,number_locale")
    .eq("organisation_id", input.organisationId).eq("venue_id", input.venueId).eq("id", input.importId).single();
  if (error || !importRow) return NextResponse.json({ errorCode: "POS_IMPORT_NOT_FOUND" }, { status: 404 });
  if (importRow.status === "processed") return NextResponse.json({ importId: input.importId, status: "processed", idempotent: true });
  if (importRow.status !== "dry_run") return NextResponse.json({ errorCode: "POS_IMPORT_NOT_CONFIRMABLE" }, { status: 409 });

  const { data: stored, error: downloadError } = await supabase.storage.from("pos-imports")
    .download(filePath(input.organisationId, input.venueId, input.importId));
  if (downloadError || !stored) throw downloadError ?? new Error("SOURCE_FILE_MISSING");
  const contents = await stored.text();
  if (await sha256Hex(contents) !== importRow.file_hash) throw new Error("SOURCE_HASH_MISMATCH");
  const dryRun = dryRunPosCsv(contents, mappingSchema.parse(importRow.column_mapping), z.enum(["nl-NL", "en-US"]).parse(importRow.number_locale));
  const sourceRows = dryRun.accepted.map((row) => ({
    organisation_id: input.organisationId,
    venue_id: input.venueId,
    source_system: "pos_csv",
    source_type: "sale_line",
    external_id: row.externalId || null,
    source_hash: `${importRow.file_hash}:${row.rowNumber}`,
    occurred_at: row.timestamp,
    payload: {
      source_row_number: row.rowNumber,
      item_name: row.itemName,
      quantity: row.quantity,
      gross_minor: row.grossSalesMinor.toString(),
      net_minor: row.netSalesMinor.toString(),
      vat_minor: row.vatMinor.toString(),
    },
  }));
  const normalizedRows = dryRun.accepted.map((row) => ({
    organisation_id: input.organisationId,
    venue_id: input.venueId,
    import_id: input.importId,
    source_row_number: row.rowNumber,
    external_transaction_id: row.externalId || null,
    transaction_at: row.timestamp,
    trading_date: row.tradingDate,
    pos_product_name: row.itemName,
    quantity: row.quantity,
    gross_minor: row.grossSalesMinor.toString(),
    net_minor: row.netSalesMinor.toString(),
    vat_minor: row.vatMinor.toString(),
    discount_minor: row.discountMinor.toString(),
    void_minor: row.voidMinor.toString(),
    refund_minor: row.refundMinor.toString(),
    complimentary_minor: row.complimentaryMinor.toString(),
    terminal: row.attributes.terminal || null,
    payment_method: row.attributes.payment_method || null,
    event_reference: row.attributes.external_event_reference || null,
  }));
  const [{ error: sourceError }, { error: normalizedError }] = await Promise.all([
    supabase.from("source_records").upsert(sourceRows as never[], { onConflict: "organisation_id,source_system,source_type,source_hash", ignoreDuplicates: true }),
    supabase.from("normalized_sales").upsert(normalizedRows, { onConflict: "organisation_id,import_id,source_row_number", ignoreDuplicates: true }),
  ]);
  if (sourceError || normalizedError) throw sourceError ?? normalizedError;
  const { error: updateError } = await supabase.from("pos_imports").update({
    status: "processed",
    confirmed_by: user.id,
    confirmed_at: new Date().toISOString(),
    immutable_evidence: {
      file_hash: importRow.file_hash,
      accepted_rows: dryRun.accepted.length,
      rejected_rows: dryRun.rejected.length,
      parser_version: "pos-csv-v1",
    },
  }).eq("organisation_id", input.organisationId).eq("venue_id", input.venueId).eq("id", input.importId).eq("status", "dry_run");
  if (updateError) throw updateError;
  return NextResponse.json({ importId: input.importId, status: "processed", acceptedCount: dryRun.accepted.length });
}
