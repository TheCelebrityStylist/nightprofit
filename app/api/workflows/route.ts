import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "../../../lib/auth/require-membership";
import { decimalToMinor } from "../../../lib/imports/locale-number";
import { add, breakEvenRevenue, eventContribution, marginBasisPoints, money } from "../../../lib/calculations";
import { assertSameOrigin, securityErrorResponse } from "../../../lib/http/security";

const envelope = z.object({
  workflow: z.enum(["booking_inquiry", "booking_quote", "booking_transition", "supplier", "supplier_contract", "contract_transition", "discrepancy_resolution", "product", "menu_item", "event_yield", "event_outcome", "staff_profile", "staff_transition", "incident", "incident_finalize"]),
  organisationId: z.string().uuid(),
  locale: z.enum(["nl-NL", "en-US"]).default("nl-NL"),
  values: z.record(z.string(), z.string()),
});

const bookingSchema = z.object({
  venueId: z.string().uuid(), contactName: z.string().trim().min(2).max(120),
  contactEmail: z.email(), preferredStart: z.iso.datetime({ local: true }),
  groupSize: z.coerce.number().int().positive().max(5000), budget: z.string().max(32).default(""),
  occasion: z.string().trim().max(200).default(""), source: z.string().trim().min(1).max(80),
  preferences: z.string().trim().max(1000).default(""),
});
const bookingQuoteSchema=z.object({inquiryId:z.string().uuid(),subtotal:z.string(),vatBasisPoints:z.coerce.number().int().min(0).max(10000),deposit:z.string().default("0"),expiresAt:z.iso.datetime({local:true})});
const bookingTransitionSchema=z.object({inquiryId:z.string().uuid(),status:z.enum(["qualified","proposal","awaiting_deposit","confirmed","completed","lost","cancelled","expired"]),reason:z.string().trim().min(5).max(1000)});
const supplierSchema = z.object({
  name: z.string().trim().min(2).max(160), contactEmail: z.union([z.email(), z.literal("")]).default(""),
});
const supplierContractSchema=z.object({supplierId:z.string().uuid(),venueId:z.union([z.string().uuid(),z.literal("")]).default(""),name:z.string().trim().min(2).max(160),startDate:z.iso.date(),endDate:z.union([z.iso.date(),z.literal("")]).default(""),noticeDeadline:z.union([z.iso.date(),z.literal("")]).default(""),automaticRenewal:z.enum(["true","false"]),terms:z.string().trim().min(5).max(10000)});
const contractTransitionSchema=z.object({contractId:z.string().uuid(),status:z.enum(["active","notice_due","renewing","terminated","expired"]),reason:z.string().trim().min(5).max(1000)});
const discrepancyResolutionSchema=z.object({discrepancyId:z.string().uuid(),status:z.enum(["reviewing","accepted","disputed","resolved","dismissed"]),resolution:z.string().trim().min(5).max(2000),creditReceived:z.string().default("0"),verifiedRecovered:z.string().default("0")});
const productSchema = z.object({
  supplierId:z.union([z.string().uuid(),z.literal("")]).default(""), name:z.string().trim().min(2).max(160),
  brand:z.string().trim().max(120).default(""), category:z.string().trim().min(2).max(120),
  sku:z.string().trim().max(80).default(""), barcode:z.string().trim().max(80).default(""),
  packageQuantity:z.coerce.number().positive(), unitVolumeMl:z.union([z.coerce.number().positive(),z.literal("")]).default(""),
  purchaseUnit:z.string().trim().min(1).max(40), servingUnit:z.string().trim().min(1).max(40),
  netCost:z.string(), vatBasisPoints:z.coerce.number().int(), deposit:z.string().default("0"),
});
const menuItemSchema = z.object({
  venueId:z.string().uuid(), name:z.string().trim().min(2).max(160), category:z.string().trim().min(2).max(120),
  productId:z.string().uuid(), quantity:z.coerce.number().positive(), unit:z.string().trim().min(1).max(40),
  wasteBasisPoints:z.coerce.number().int().min(0).max(10000), grossPrice:z.string(),
  vatBasisPoints:z.coerce.number().int(), targetMarginBasisPoints:z.coerce.number().int().min(0).max(10000),
});
const eventSchema = z.object({
  venueId: z.string().uuid(), name: z.string().trim().min(2).max(160),
  startsAt: z.iso.datetime({ local: true }), attendance: z.coerce.number().int().positive().max(100000),
  ticketRevenue: z.string(), barRevenue: z.string(), staffing: z.string(), security: z.string(),
  entertainment: z.string(), stock: z.string(), otherCosts: z.string(),
});
const eventOutcomeSchema=z.object({scenarioId:z.string().uuid(),actualAttendance:z.coerce.number().int().min(0),actualRevenue:z.string(),actualContribution:z.string()});
const staffSchema = z.object({
  fullName: z.string().trim().min(2).max(160), contactEmail: z.union([z.email(), z.literal("")]).default(""),
  roleName: z.string().trim().min(2).max(120), preferredLanguage: z.enum(["nl", "en"]),
  engagementType: z.string().trim().min(2).max(80), startDate: z.iso.date(),
});
const incidentSchema = z.object({
  venueId: z.string().uuid(), occurredAt: z.iso.datetime({ local: true }),
  category: z.string().trim().min(2).max(80), factualRecord: z.string().trim().min(10).max(10000),
  witnesses: z.string().trim().max(1000).default(""), actions: z.string().trim().max(2000).default(""),
});
const staffTransitionSchema=z.object({staffId:z.string().uuid(),status:z.enum(["in_progress","review_required","cleared","expired","suspended","rejected"]),reason:z.string().trim().min(5).max(1000)});
const incidentFinalizeSchema=z.object({incidentId:z.string().uuid(),reason:z.string().trim().min(5).max(1000)});

function iso(value:string) { return new Date(value).toISOString(); }
function minor(value:string, locale:"nl-NL"|"en-US") { return decimalToMinor(value || "0", locale); }

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const input = envelope.parse(await request.json());
    const minorValue = (value:string) => minor(value, input.locale);
    if (input.workflow === "booking_inquiry") {
      const values = bookingSchema.parse(input.values);
      const { supabase, user } = await requireMembership(input.organisationId, "bookings.manage", values.venueId);
      const budgetMinor = values.budget ? minorValue(values.budget).toString() : null;
      const { error } = await supabase.from("booking_inquiries").insert({
        organisation_id: input.organisationId, venue_id: values.venueId, status: "new",
        source: values.source, preferred_start: iso(values.preferredStart), group_size: values.groupSize,
        budget_minor: budgetMinor, occasion: values.occasion || null, preferences: { notes: values.preferences },
        contact_name: values.contactName, contact_email: values.contactEmail, assigned_to: user.id,
      });
      if (error) throw error;
      return NextResponse.json({ message: "Aanvraag toegevoegd aan de pipeline." }, { status: 201 });
    }
    if(input.workflow==="booking_quote"){
      const values=bookingQuoteSchema.parse(input.values);const {supabase,user}=await requireMembership(input.organisationId,"bookings.manage");
      const {data:inquiry,error:inquiryError}=await supabase.from("booking_inquiries").select("id,venue_id,status").eq("organisation_id",input.organisationId).eq("id",values.inquiryId).single();if(inquiryError||!inquiry)throw inquiryError??new Error("inquiry_missing");
      const subtotal=minorValue(values.subtotal),vat=(subtotal*BigInt(values.vatBasisPoints)+5000n)/10000n,total=subtotal+vat,deposit=minorValue(values.deposit);
      const {data:latest}=await supabase.from("booking_quotes").select("version").eq("organisation_id",input.organisationId).eq("inquiry_id",values.inquiryId).order("version",{ascending:false}).limit(1);
      const version=Number(latest?.[0]?.version??0)+1,snapshot={subtotal_minor:String(subtotal),vat_minor:String(vat),total_minor:String(total),deposit_minor:String(deposit),version};
      const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({...snapshot,inquiry_id:values.inquiryId})));const contentHash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
      const {data:quote,error}=await supabase.from("booking_quotes").insert({organisation_id:input.organisationId,venue_id:inquiry.venue_id,inquiry_id:values.inquiryId,version,status:"approved",currency:"EUR",subtotal_minor:String(subtotal),vat_minor:String(vat),total_minor:String(total),deposit_minor:String(deposit),discount_minor:"0",line_snapshot:[snapshot],terms_snapshot:{external_delivery:"not_sent"},expires_at:iso(values.expiresAt),approved_by:user.id,content_hash:contentHash}).select("id").single();if(error||!quote)throw error??new Error("quote_failed");
      await supabase.from("booking_inquiries").update({status:"proposal"}).eq("organisation_id",input.organisationId).eq("id",values.inquiryId);
      await supabase.from("operational_events").insert({organisation_id:input.organisationId,venue_id:inquiry.venue_id,aggregate_type:"booking_inquiry",aggregate_id:values.inquiryId,event_type:"booking.quote_approved",actor_id:user.id,payload:{quote_id:quote.id,version,total_minor:String(total),external_delivery:"not_sent"}});
      return NextResponse.json({message:"Offerteversie goedgekeurd en veilig opgeslagen; er is niets extern verstuurd."},{status:201});
    }
    if(input.workflow==="booking_transition"){
      const values=bookingTransitionSchema.parse(input.values);const {supabase,user}=await requireMembership(input.organisationId,"bookings.manage");
      const {data:row,error}=await supabase.from("booking_inquiries").select("id,venue_id,status").eq("organisation_id",input.organisationId).eq("id",values.inquiryId).single();if(error||!row)throw error??new Error("inquiry_missing");
      const allowed:Record<string,string[]>={new:["qualified","lost","cancelled"],qualified:["proposal","lost","cancelled"],proposal:["awaiting_deposit","confirmed","lost","expired"],awaiting_deposit:["confirmed","lost","expired"],confirmed:["completed","cancelled"],completed:[],lost:[],cancelled:[],expired:[]};if(!allowed[row.status]?.includes(values.status))throw new Error("invalid_booking_transition");
      const {error:updateError}=await supabase.from("booking_inquiries").update({status:values.status}).eq("organisation_id",input.organisationId).eq("id",values.inquiryId).eq("status",row.status);if(updateError)throw updateError;
      await supabase.from("operational_events").insert({organisation_id:input.organisationId,venue_id:row.venue_id,aggregate_type:"booking_inquiry",aggregate_id:row.id,event_type:`booking.${values.status}`,actor_id:user.id,payload:{from:row.status,to:values.status,reason:values.reason}});
      return NextResponse.json({message:"Boekingsfase bijgewerkt en vastgelegd."});
    }
    if (input.workflow === "supplier") {
      const values = supplierSchema.parse(input.values);
      const { supabase } = await requireMembership(input.organisationId, "suppliers.manage");
      const { error } = await supabase.from("suppliers").insert({
        organisation_id: input.organisationId, name: values.name,
        email: values.contactEmail || null,
      });
      if (error) throw error;
      return NextResponse.json({ message: "Leverancier opgeslagen." }, { status: 201 });
    }
    if(input.workflow==="supplier_contract"){
      const values=supplierContractSchema.parse(input.values);const {supabase,user}=await requireMembership(input.organisationId,"suppliers.manage",values.venueId||undefined);
      const {data:contract,error}=await supabase.from("supplier_contracts").insert({organisation_id:input.organisationId,venue_id:values.venueId||null,supplier_id:values.supplierId,name:values.name,status:"draft",start_date:values.startDate,end_date:values.endDate||null,notice_deadline:values.noticeDeadline||null,automatic_renewal:values.automaticRenewal==="true",responsible_owner_id:user.id}).select("id").single();if(error||!contract)throw error??new Error("contract_failed");
      const terms={summary:values.terms},digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(JSON.stringify({...terms,contract_id:contract.id,version:1}))),contentHash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("");
      const {error:versionError}=await supabase.from("supplier_contract_versions").insert({organisation_id:input.organisationId,contract_id:contract.id,version:1,terms,price_list:[],discounts:[],rebates:[],content_hash:contentHash,effective_from:values.startDate,created_by:user.id});if(versionError)throw versionError;
      await supabase.from("operational_events").insert({organisation_id:input.organisationId,venue_id:values.venueId||null,aggregate_type:"supplier_contract",aggregate_id:contract.id,event_type:"supplier_contract.created",actor_id:user.id,payload:{version:1}});
      return NextResponse.json({message:"Contract en onveranderlijke eerste voorwaardenversie opgeslagen."},{status:201});
    }
    if(input.workflow==="contract_transition"){
      const values=contractTransitionSchema.parse(input.values);const {supabase,user}=await requireMembership(input.organisationId,"suppliers.manage");const {data:rawRow,error}=await supabase.from("supplier_contracts").select("id,venue_id,status").eq("organisation_id",input.organisationId).eq("id",values.contractId).single();if(error||!rawRow)throw error??new Error("contract_missing");const row=rawRow as unknown as {id:string;venue_id:string|null;status:string};
      const allowed:Record<string,string[]>={draft:["active","terminated"],active:["notice_due","renewing","terminated","expired"],notice_due:["renewing","terminated","expired"],renewing:["active","terminated","expired"],terminated:[],expired:[]};if(!allowed[row.status]?.includes(values.status))throw new Error("invalid_contract_transition");
      const {error:updateError}=await supabase.from("supplier_contracts").update({status:values.status}).eq("organisation_id",input.organisationId).eq("id",row.id).eq("status",row.status);if(updateError)throw updateError;
      await supabase.from("operational_events").insert({organisation_id:input.organisationId,venue_id:row.venue_id,aggregate_type:"supplier_contract",aggregate_id:row.id,event_type:`supplier_contract.${values.status}`,actor_id:user.id,payload:{from:row.status,to:values.status,reason:values.reason}});return NextResponse.json({message:"Contractstatus bijgewerkt en geaudit."});
    }
    if(input.workflow==="discrepancy_resolution"){
      const values=discrepancyResolutionSchema.parse(input.values);const {supabase,user}=await requireMembership(input.organisationId,"suppliers.manage");const {data:rawRow,error}=await supabase.from("contract_discrepancies").select("id,venue_id,status").eq("organisation_id",input.organisationId).eq("id",values.discrepancyId).single();if(error||!rawRow)throw error??new Error("discrepancy_missing");const row=rawRow as unknown as {id:string;venue_id:string|null;status:string};
      const {error:updateError}=await supabase.from("contract_discrepancies").update({status:values.status,resolution:values.resolution,credit_received_minor:String(minorValue(values.creditReceived)),verified_recovered_minor:String(minorValue(values.verifiedRecovered)),owner_id:user.id}).eq("organisation_id",input.organisationId).eq("id",row.id);if(updateError)throw updateError;
      await supabase.from("operational_events").insert({organisation_id:input.organisationId,venue_id:row.venue_id,aggregate_type:"contract_discrepancy",aggregate_id:row.id,event_type:`contract_discrepancy.${values.status}`,actor_id:user.id,payload:{reason:values.resolution,credit_received_minor:String(minorValue(values.creditReceived)),verified_recovered_minor:String(minorValue(values.verifiedRecovered))}});return NextResponse.json({message:"Afwijking beoordeeld; financiële terugwinning is apart vastgelegd."});
    }
    if (input.workflow === "product") {
      const values=productSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"suppliers.manage");
      const {error}=await supabase.rpc("create_product_with_cost",{
        target_organisation_id:input.organisationId,target_supplier_id:values.supplierId||null,
        target_name:values.name,target_brand:values.brand,target_category:values.category,target_sku:values.sku,
        target_barcode:values.barcode,target_package_quantity:values.packageQuantity,
        target_unit_volume_ml:values.unitVolumeMl===""?null:values.unitVolumeMl,
        target_purchase_unit:values.purchaseUnit,target_serving_unit:values.servingUnit,
        target_net_cost_minor:minorValue(values.netCost).toString(),target_vat_basis_points:values.vatBasisPoints,
        target_deposit_minor:minorValue(values.deposit).toString(),
      });
      if(error)throw error;
      return NextResponse.json({message:"Product en actuele inkoopprijs atomair opgeslagen."},{status:201});
    }
    if (input.workflow === "menu_item") {
      const values=menuItemSchema.parse(input.values);
      const {supabase}=await requireMembership(input.organisationId,"suppliers.manage",values.venueId);
      const {error}=await supabase.rpc("create_menu_item_with_component",{
        target_organisation_id:input.organisationId,target_venue_id:values.venueId,target_name:values.name,
        target_category:values.category,target_product_id:values.productId,target_quantity:values.quantity,
        target_unit:values.unit,target_waste_basis_points:values.wasteBasisPoints,
        target_gross_price_minor:minorValue(values.grossPrice).toString(),target_vat_basis_points:values.vatBasisPoints,
        target_margin_basis_points:values.targetMarginBasisPoints,
      });
      if(error)throw error;
      return NextResponse.json({message:"Menu-item, receptkost en marge-snapshot opgeslagen."},{status:201});
    }
    if (input.workflow === "event_yield") {
      const values = eventSchema.parse(input.values);
      const { supabase, user } = await requireMembership(input.organisationId, "events.manage", values.venueId);
      const revenue = add(minorValue(values.ticketRevenue), minorValue(values.barRevenue));
      const staff = minorValue(values.staffing);
      const directCosts = [staff, minorValue(values.security), minorValue(values.entertainment), minorValue(values.stock), minorValue(values.otherCosts)];
      const contribution = eventContribution(revenue, ...directCosts);
      const variableCost = minorValue(values.stock);
      const variableRate = revenue === 0n ? 0n : (variableCost * 10000n) / revenue;
      const contributionMargin = 10000n - variableRate;
      const fixedCosts = add(...directCosts.filter((_, index)=>index !== 3));
      const breakEven = breakEvenRevenue(fixedCosts, contributionMargin);
      const { data: event, error: eventError } = await supabase.from("events").insert({
        organisation_id: input.organisationId, venue_id: values.venueId, name: values.name,
        event_type: "planned", starts_at: iso(values.startsAt),
        ends_at: new Date(new Date(values.startsAt).getTime() + 4 * 60 * 60 * 1000).toISOString(),
        expected_attendance: values.attendance, created_by: user.id,
      }).select("id").single();
      if (eventError || !event) throw eventError ?? new Error("event_failed");
      const inputs = {
        attendance: values.attendance, ticket_revenue_minor: minorValue(values.ticketRevenue).toString(),
        bar_revenue_minor: minorValue(values.barRevenue).toString(), costs_minor: directCosts.map(String),
      };
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(inputs)));
      const contentHash = Array.from(new Uint8Array(digest), byte=>byte.toString(16).padStart(2,"0")).join("");
      const { error } = await supabase.from("event_yield_scenarios").insert({
        organisation_id: input.organisationId, venue_id: values.venueId, event_id: event.id, scenario: "base",
        model_version: "deterministic-planning", calculation_version: "1", formula_version: "1",
        input_snapshot: inputs, configuration_snapshot: { locale: input.locale },
        assumptions: { planning_mode: "deterministic", comparable_minimum: 3 },
        attendance_low: values.attendance, attendance_high: values.attendance,
        revenue_low_minor: revenue.toString(), revenue_high_minor: revenue.toString(),
        staff_cost_minor: staff.toString(), contribution_minor: contribution.toString(),
        break_even_revenue_minor: breakEven.toString(),
        break_even_attendance: revenue > 0n ? Number((money(values.attendance) * breakEven + revenue - 1n) / revenue) : null,
        confidence_basis_points: 0, missing_data: ["Minimaal drie vergelijkbare events vereist voor statistische bandbreedte."],
        content_hash: contentHash,
      });
      if (error) throw error;
      return NextResponse.json({ message: `Basisscenario opgeslagen · marge ${Number(marginBasisPoints(contribution,revenue))/100}%` }, { status: 201 });
    }
    if(input.workflow==="event_outcome"){
      const values=eventOutcomeSchema.parse(input.values);const {supabase,user}=await requireMembership(input.organisationId,"events.manage");const {data:rawScenario,error}=await supabase.from("event_yield_scenarios").select("id,venue_id,attendance_low,revenue_low_minor,contribution_minor").eq("organisation_id",input.organisationId).eq("id",values.scenarioId).single();if(error||!rawScenario)throw error??new Error("scenario_missing");const scenario=rawScenario as unknown as {id:string;venue_id:string;attendance_low:number;revenue_low_minor:string;contribution_minor:string};
      const actualRevenue=minorValue(values.actualRevenue),actualContribution=minorValue(values.actualContribution);const {error:outcomeError}=await supabase.from("event_forecast_outcomes").insert({organisation_id:input.organisationId,venue_id:scenario.venue_id,scenario_id:scenario.id,actual_attendance:values.actualAttendance,actual_revenue_minor:String(actualRevenue),actual_contribution_minor:String(actualContribution),attendance_error:values.actualAttendance-Number(scenario.attendance_low??0),revenue_error_minor:String(actualRevenue-BigInt(scenario.revenue_low_minor??0)),contribution_error_minor:String(actualContribution-BigInt(scenario.contribution_minor??0))});if(outcomeError)throw outcomeError;
      await supabase.from("operational_events").insert({organisation_id:input.organisationId,venue_id:scenario.venue_id,aggregate_type:"event_yield_scenario",aggregate_id:scenario.id,event_type:"event.outcome_recorded",actor_id:user.id,payload:{actual_attendance:values.actualAttendance,actual_revenue_minor:String(actualRevenue),actual_contribution_minor:String(actualContribution)}});return NextResponse.json({message:"Werkelijk eventresultaat opgeslagen en deterministisch vergeleken."},{status:201});
    }
    if (input.workflow === "staff_profile") {
      const values = staffSchema.parse(input.values);
      const { supabase } = await requireMembership(input.organisationId, "compliance.manage");
      const { error } = await supabase.from("staff_profiles").insert({
        organisation_id: input.organisationId, full_name: values.fullName,
        contact_email: values.contactEmail || null, role_name: values.roleName,
        preferred_language: values.preferredLanguage, engagement_type: values.engagementType,
        start_date: values.startDate, onboarding_status: "invited",
      });
      if (error) throw error;
      return NextResponse.json({ message: "Beperkt medewerkersprofiel aangemaakt." }, { status: 201 });
    }
    if(input.workflow==="staff_transition"){
      const values=staffTransitionSchema.parse(input.values);const {supabase,user}=await requireMembership(input.organisationId,"compliance.manage");const {data:rawRow,error}=await supabase.from("staff_profiles").select("id,onboarding_status").eq("organisation_id",input.organisationId).eq("id",values.staffId).single();if(error||!rawRow)throw error??new Error("staff_missing");const row=rawRow as unknown as {id:string;onboarding_status:string};
      const {error:updateError}=await supabase.from("staff_profiles").update({onboarding_status:values.status}).eq("organisation_id",input.organisationId).eq("id",row.id);if(updateError)throw updateError;await supabase.from("operational_events").insert({organisation_id:input.organisationId,venue_id:null,aggregate_type:"staff_profile",aggregate_id:row.id,event_type:`staff.${values.status}`,actor_id:user.id,payload:{from:row.onboarding_status,to:values.status,reason:values.reason}});return NextResponse.json({message:"Onboardingstatus bijgewerkt en geaudit."});
    }
    if(input.workflow==="incident_finalize"){
      const values=incidentFinalizeSchema.parse(input.values);const {supabase,user}=await requireMembership(input.organisationId,"compliance.manage");const {data:rawRow,error}=await supabase.from("staff_incidents").select("id,venue_id,status").eq("organisation_id",input.organisationId).eq("id",values.incidentId).single();if(error||!rawRow)throw error??new Error("incident_missing");const row=rawRow as unknown as {id:string;venue_id:string;status:string};if(row.status!=="draft")throw new Error("incident_already_finalized");
      const {error:updateError}=await supabase.from("staff_incidents").update({status:"finalized",finalized_by:user.id,finalized_at:new Date().toISOString()}).eq("organisation_id",input.organisationId).eq("id",row.id).eq("status","draft");if(updateError)throw updateError;await supabase.from("operational_events").insert({organisation_id:input.organisationId,venue_id:row.venue_id,aggregate_type:"staff_incident",aggregate_id:row.id,event_type:"staff_incident.finalized",actor_id:user.id,payload:{reason:values.reason}});return NextResponse.json({message:"Incident definitief en onveranderlijk vastgelegd."});
    }
    const values = incidentSchema.parse(input.values);
    const { supabase, user } = await requireMembership(input.organisationId, "compliance.manage", values.venueId);
    const { error } = await supabase.from("staff_incidents").insert({
      organisation_id: input.organisationId, venue_id: values.venueId, occurred_at: iso(values.occurredAt),
      factual_record: values.factualRecord, status: "draft", created_by: user.id,
      category: values.category, witnesses: values.witnesses, actions_taken: values.actions,
    });
    if (error) throw error;
    return NextResponse.json({ message: "Conceptincident veilig opgeslagen." }, { status: 201 });
  } catch (error) {
    return securityErrorResponse(error) ?? NextResponse.json({ errorCode: error instanceof z.ZodError ? "VALIDATION_FAILED" : "WORKFLOW_ACTION_FAILED" }, { status: 400 });
  }
}
