import { NextResponse } from "next/server";
import { z } from "zod";
import { requireMembership } from "../../../lib/auth/require-membership";
import { decimalToMinor } from "../../../lib/imports/locale-number";
import { add, breakEvenRevenue, eventContribution, marginBasisPoints, money } from "../../../lib/calculations";

const envelope = z.object({
  workflow: z.enum(["booking_inquiry", "supplier", "event_yield", "staff_profile", "incident", "demand_forecast", "staff_shift", "availability"]),
  organisationId: z.string().uuid(),
  values: z.record(z.string(), z.string()),
});

const bookingSchema = z.object({
  venueId: z.string().uuid(), contactName: z.string().trim().min(2).max(120),
  contactEmail: z.email(), preferredStart: z.iso.datetime({ local: true }),
  groupSize: z.coerce.number().int().positive().max(5000), budget: z.string().max(32).default(""),
  occasion: z.string().trim().max(200).default(""), source: z.string().trim().min(1).max(80),
  preferences: z.string().trim().max(1000).default(""),
});
const supplierSchema = z.object({
  name: z.string().trim().min(2).max(160), contactEmail: z.union([z.email(), z.literal("")]).default(""),
});
const eventSchema = z.object({
  venueId: z.string().uuid(), name: z.string().trim().min(2).max(160),
  startsAt: z.iso.datetime({ local: true }), attendance: z.coerce.number().int().positive().max(100000),
  ticketRevenue: z.string(), barRevenue: z.string(), staffing: z.string(), security: z.string(),
  entertainment: z.string(), stock: z.string(), otherCosts: z.string(),
});
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
const forecastSchema = z.object({
  venueId:z.string().uuid(), startsAt:z.iso.datetime({local:true}), endsAt:z.iso.datetime({local:true}),
  expectedGuests:z.coerce.number().int().min(0).max(100000), expectedRevenue:z.string(),
  sourceBasis:z.string().trim().min(2).max(500),
});
const shiftSchema = z.object({
  venueId:z.string().uuid(), staffProfileId:z.union([z.string().uuid(),z.literal("")]).default(""),
  roleName:z.string().trim().min(2).max(120), startsAt:z.iso.datetime({local:true}), endsAt:z.iso.datetime({local:true}),
  breakMinutes:z.coerce.number().int().min(0).max(720), hourlyCost:z.string(),
  status:z.enum(["draft","open","published"]),
});
const availabilitySchema = z.object({
  venueId:z.string().uuid(), staffProfileId:z.string().uuid(),
  startsAt:z.iso.datetime({local:true}), endsAt:z.iso.datetime({local:true}),
  availability:z.enum(["available","unavailable","preferred"]), note:z.string().trim().max(500).default(""),
});

function iso(value:string) { return new Date(value).toISOString(); }
function minor(value:string) { return decimalToMinor(value || "0", "nl-NL"); }

export async function POST(request: Request) {
  try {
    const input = envelope.parse(await request.json());
    if (input.workflow === "booking_inquiry") {
      const values = bookingSchema.parse(input.values);
      const { supabase, user } = await requireMembership(input.organisationId, "bookings.manage", values.venueId);
      const budgetMinor = values.budget ? minor(values.budget).toString() : null;
      const { error } = await supabase.from("booking_inquiries").insert({
        organisation_id: input.organisationId, venue_id: values.venueId, status: "new",
        source: values.source, preferred_start: iso(values.preferredStart), group_size: values.groupSize,
        budget_minor: budgetMinor, occasion: values.occasion || null, preferences: { notes: values.preferences },
        contact_name: values.contactName, contact_email: values.contactEmail, assigned_to: user.id,
      });
      if (error) throw error;
      return NextResponse.json({ message: "Aanvraag toegevoegd aan de pipeline." }, { status: 201 });
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
    if (input.workflow === "event_yield") {
      const values = eventSchema.parse(input.values);
      const { supabase, user } = await requireMembership(input.organisationId, "events.manage", values.venueId);
      const revenue = add(minor(values.ticketRevenue), minor(values.barRevenue));
      const staff = minor(values.staffing);
      const directCosts = [staff, minor(values.security), minor(values.entertainment), minor(values.stock), minor(values.otherCosts)];
      const contribution = eventContribution(revenue, ...directCosts);
      const variableCost = minor(values.stock);
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
        attendance: values.attendance, ticket_revenue_minor: minor(values.ticketRevenue).toString(),
        bar_revenue_minor: minor(values.barRevenue).toString(), costs_minor: directCosts.map(String),
      };
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(inputs)));
      const contentHash = Array.from(new Uint8Array(digest), byte=>byte.toString(16).padStart(2,"0")).join("");
      const { error } = await supabase.from("event_yield_scenarios").insert({
        organisation_id: input.organisationId, venue_id: values.venueId, event_id: event.id, scenario: "base",
        model_version: "deterministic-planning", calculation_version: "1", formula_version: "1",
        input_snapshot: inputs, configuration_snapshot: { locale: "nl-NL" },
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
    if (input.workflow === "demand_forecast") {
      const values=forecastSchema.parse(input.values);
      if(new Date(values.endsAt)<=new Date(values.startsAt)) throw new Error("invalid_window");
      const {supabase,user}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {error}=await supabase.from("demand_forecasts").insert({
        organisation_id:input.organisationId,venue_id:values.venueId,
        trading_date:values.startsAt.slice(0,10),interval_start:iso(values.startsAt),interval_end:iso(values.endsAt),
        expected_guests:values.expectedGuests,expected_revenue_minor:minor(values.expectedRevenue).toString(),
        confidence_basis_points:0,source_basis:values.sourceBasis.split(",").map(value=>value.trim()).filter(Boolean),
        assumptions:{mode:"manager_input"},created_by:user.id,
      });
      if(error) throw error;
      return NextResponse.json({message:"Vraagverwachting opgeslagen en gekoppeld aan de personeelsplanning."},{status:201});
    }
    if (input.workflow === "staff_shift") {
      const values=shiftSchema.parse(input.values);
      if(new Date(values.endsAt)<=new Date(values.startsAt)) throw new Error("invalid_window");
      const {supabase,user}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {error}=await supabase.from("staff_shifts").insert({
        organisation_id:input.organisationId,venue_id:values.venueId,
        staff_profile_id:values.staffProfileId||null,role_name:values.roleName,
        starts_at:iso(values.startsAt),ends_at:iso(values.endsAt),break_minutes:values.breakMinutes,
        hourly_cost_minor:minor(values.hourlyCost).toString(),status:values.status,
        source:values.staffProfileId?"manual":"open_shift",published_at:values.status==="published"?new Date().toISOString():null,
        created_by:user.id,
      });
      if(error) throw error;
      return NextResponse.json({message:values.staffProfileId?"Dienst ingepland.":"Open dienst aangemaakt."},{status:201});
    }
    if (input.workflow === "availability") {
      const values=availabilitySchema.parse(input.values);
      if(new Date(values.endsAt)<=new Date(values.startsAt)) throw new Error("invalid_window");
      const {supabase}=await requireMembership(input.organisationId,"planning.manage",values.venueId);
      const {error}=await supabase.from("staff_availability").insert({
        organisation_id:input.organisationId,venue_id:values.venueId,staff_profile_id:values.staffProfileId,
        starts_at:iso(values.startsAt),ends_at:iso(values.endsAt),availability:values.availability,
        source:"manager",note:values.note||null,
      });
      if(error) throw error;
      return NextResponse.json({message:"Beschikbaarheid verwerkt in het planbord."},{status:201});
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
    const message = error instanceof z.ZodError ? "Controleer de verplichte velden en bedragen." : "Deze bewerking kon niet veilig worden opgeslagen.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
