import Link from "next/link";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "../lib/supabase/server";
import {
  authEnumLabel,
  authIntlLocale,
  authMessage,
  normalizeAuthLocale,
  type AuthLocale,
  type AuthMessageKey,
} from "../lib/i18n/authenticated";
import { AuthLocaleProvider, AuthLocaleSwitch } from "./auth-locale";
import { AuthForm } from "./auth-form";
import { CloseForm } from "./close-form";
import { CloseWorkspace } from "./close-workspace";
import { OnboardingForm } from "./onboarding/onboarding-form";
import { WorkflowForm } from "./workflow-form";
import { AvailabilityManager } from "./availability-manager";
import { PosImportWorkspace } from "./pos-import-workspace";
import { PosMappingWorkspace } from "./pos-mapping-workspace";
import { InventoryCountWorkspace } from "./inventory-count-workspace";
import { ReconciliationWorkspace } from "./reconciliation-workspace";
import { RosterBoard } from "./roster-board";
import { ServiceAutopilot } from "./service-autopilot";
import "./real-app.css";

const navigation = [
  ["nav.today", "/app/dashboard"],
  ["nav.sales", "/app/bookings"],
  ["nav.planning", "/app/planning"],
  ["nav.inventory", "/app/inventory"],
  ["nav.suppliers", "/app/suppliers"],
  ["nav.close", "/app/close"],
  ["nav.settings", "/app/settings"],
] as const;

type Venue = { id: string; name: string; timezone: string };
type Close = {
  id: string;
  venue_id: string;
  trading_date: string;
  status: string;
  version: number;
  expected_total_minor: string;
  accounted_total_minor: string;
  difference_minor: string;
};
type Inquiry = {
  id: string;
  venue_id: string;
  status: string;
  preferred_start: string;
  group_size: number;
  contact_name: string;
  occasion: string | null;
  budget_minor: string | null;
};
type Supplier = { id: string; name: string; email: string | null };
type Staff = {
  id: string;
  full_name: string;
  role_name: string;
  onboarding_status: string;
  preferred_language: string;
};
type Scenario = {
  id: string;
  venue_id: string;
  event_id: string;
  scenario: string;
  revenue_low_minor: string;
  contribution_minor: string;
  break_even_revenue_minor: string;
  missing_data: string[];
  created_at: string;
};
type EventRow = { id: string; name: string; starts_at: string };
type IncidentRow = {
  id: string;
  venue_id: string;
  occurred_at: string;
  category: string;
  status: string;
  factual_record: string;
};

const euro = (
  minor: string | number | bigint | null | undefined,
  locale: AuthLocale = "nl",
) =>
  new Intl.NumberFormat(authIntlLocale(locale), {
    style: "currency",
    currency: "EUR",
  }).format(Number(BigInt(minor ?? 0)) / 100);
const date = (value: string, locale: AuthLocale = "nl") =>
  new Intl.DateTimeFormat(authIntlLocale(locale), {
    dateStyle: "medium",
  }).format(new Date(value));
const venueOptions = (venues: Venue[]) =>
  venues.map((venue) => ({ label: venue.name, value: venue.id }));

export async function AuthenticatedApp({ path }: { path: string }) {
  const locale = normalizeAuthLocale(
    (await cookies()).get("nightprofit_locale")?.value,
  );
  return (
    <AuthLocaleProvider initialLocale={locale}>
      <AuthenticatedAppContent path={path} locale={locale} />
    </AuthLocaleProvider>
  );
}

async function AuthenticatedAppContent({
  path,
  locale,
}: {
  path: string;
  locale: AuthLocale;
}) {
  const t = (key: AuthMessageKey) => authMessage(locale, key);
  const supabase = await createSupabaseServerClient().catch(() => null);
  if (!supabase) return <AuthForm mode="login" locale={locale} />;
  const authResult = await supabase.auth.getUser().catch(() => null);
  if (!authResult) return <AuthForm mode="login" locale={locale} />;
  const {
    data: { user },
    error: authError,
  } = authResult;
  if (authError || !user) return <AuthForm mode="login" locale={locale} />;
  const { data: memberships, error: membershipError } = await supabase
    .from("organisation_members")
    .select("organisation_id,role")
    .eq("user_id", user.id)
    .eq("active", true);
  if (membershipError) throw new Error("Membership lookup failed");
  if (!memberships?.length) return <OnboardingForm />;
  const membership = memberships[0];
  const organisationId = membership.organisation_id;
  const [{ data: organisation }, { data: venuesData }, { data: closesData }] =
    await Promise.all([
      supabase
        .from("organisations")
        .select("id,name,currency,timezone")
        .eq("id", organisationId)
        .single(),
      supabase
        .from("venues")
        .select("id,name,timezone")
        .eq("organisation_id", organisationId)
        .order("name"),
      supabase
        .from("closing_sessions")
        .select(
          "id,venue_id,trading_date,status,version,expected_total_minor,accounted_total_minor,difference_minor",
        )
        .eq("organisation_id", organisationId)
        .order("trading_date", { ascending: false })
        .limit(50),
    ]);
  if (!organisation) return <OnboardingForm />;
  const venues = (venuesData ?? []) as Venue[];
  const closes = (closesData ?? []) as Close[];
  const activeKey =
    navigation.find(([, href]) => path === href)?.[0] ??
    (path.startsWith("/app/close/") ? "nav.nightlyClose" : "nav.command");
  const activeLabel = t(activeKey);

  let content: React.ReactNode;
  if (path === "/app/dashboard")
    content = await dashboard(supabase, organisationId, venues, closes, locale);
  else if (path === "/app/close") content = closeList(venues, closes, locale);
  else if (path === "/app/close/new")
    content = (
      <section className="panel">
        <CloseForm organisationId={organisationId} venues={venues} />
      </section>
    );
  else if (path.startsWith("/app/close/"))
    content = await closeDetail(
      supabase,
      organisationId,
      path.split("/").at(-1) ?? "",
      venues,
      locale,
    );
  else if (path === "/app/bookings")
    content = await bookings(supabase, organisationId, venues, locale);
  else if (path === "/app/planning")
    content = await planning(supabase, organisationId, venues, locale);
  else if (path === "/app/my-work")
    content = await myWork(supabase, organisationId, venues, user.id, locale);
  else if (path === "/app/suppliers")
    content = await suppliers(supabase, organisationId, locale);
  else if (path === "/app/products")
    content = await productsAndRecipes(supabase, organisationId, venues, locale);
  else if (path === "/app/imports/pos")
    content = (
      <PosImportWorkspace organisationId={organisationId} venues={venues} />
    );
  else if (path === "/app/mappings/pos")
    content = await posMappings(supabase, organisationId, venues, locale);
  else if (path === "/app/inventory")
    content = await inventoryCounts(supabase, organisationId, venues);
  else if (path === "/app/reconcile")
    content = await reconciliationWorkspace(supabase, organisationId, venues);
  else if (path === "/app/yield")
    content = await eventYield(supabase, organisationId, venues, locale);
  else if (path === "/app/compliance")
    content = await compliance(supabase, organisationId, venues, locale);
  else if (path === "/app/integrations") content = integrations(locale);
  else content = <HonestEmpty title={activeLabel} locale={locale} />;

  return (
    <div className="app-shell real-app">
      <aside>
        <Link href="/" className="brand">
          <span className="logo">N</span>
          <b>NightProfit</b>
        </Link>
        <div className="venue" aria-label={t("shell.currentOrganisation")}>
          <span>{organisation.name.slice(0, 2).toUpperCase()}</span>
          <div>
            <b>{organisation.name}</b>
            <small>
              {venues.length} {t("shell.venues")} · {organisation.currency}
            </small>
          </div>
        </div>
        <nav aria-label="NightProfit">
          {navigation.map(([key, href]) => (
            <Link
              key={href}
              href={href}
              className={path === href ? "active" : ""}
            >
              {t(key)}
            </Link>
          ))}
        </nav>
        <div className="aside-foot">
          <span>{t("shell.secureData")}</span>
          <p>{authEnumLabel(locale, membership.role)}</p>
        </div>
      </aside>
      <main className="app-main">
        <header className="topbar">
          <div>
            <b>{organisation.name}</b>
            <small>
              {venues.map((venue) => venue.name).join(" · ") ||
                t("shell.noVenue")}
            </small>
          </div>
          <div className="topbar-actions">
            <AuthLocaleSwitch />
            <form action="/api/auth/logout" method="post">
              <button className="ghost">{t("shell.logout")}</button>
            </form>
          </div>
        </header>
        <div className="content">
          <section className="hero-row">
            <div>
              <div className="eyebrow">{t("shell.live")}</div>
              <h1>{activeLabel}</h1>
              <p>{t("shell.scope")}</p>
            </div>
            {path === "/app/close" && (
              <Link className="primary" href="/app/close/new">
                {t("shell.newClose")}
              </Link>
            )}
          </section>
          {content}
        </div>
      </main>
    </div>
  );
}

async function posMappings(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organisationId: string,
  venues: Venue[],
  locale: AuthLocale,
) {
  if (!venues.length) return <HonestEmpty title={authMessage(locale,"nav.posMapping")} locale={locale} />;
  const [{ data: salesData }, { data: itemData }, { data: mappingData }] =
    await Promise.all([
      supabase
        .from("normalized_sales")
        .select("venue_id,pos_product_name,pos_category,quantity,gross_minor")
        .eq("organisation_id", organisationId),
      supabase
        .from("menu_items")
        .select("id,venue_id,name")
        .eq("organisation_id", organisationId)
        .order("name"),
      supabase
        .from("source_mappings")
        .select("venue_id,source_value,target_id,status")
        .eq("organisation_id", organisationId)
        .eq("connector_key", "pos_csv")
        .eq("source_type", "product")
        .eq("status", "confirmed"),
    ]);
  const sales = (salesData ?? []) as unknown as {
    venue_id: string;
    pos_product_name: string;
    pos_category: string | null;
    quantity: string;
    gross_minor: string;
  }[];
  const menuItems = (itemData ?? []) as unknown as {
    id: string;
    venue_id: string | null;
    name: string;
  }[];
  const mappings = (mappingData ?? []) as unknown as {
    venue_id: string;
    source_value: string;
    target_id: string;
  }[];
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase("nl-NL")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const workspaces = venues.map((venue) => {
    const venueItems = menuItems.filter((item) => item.venue_id === venue.id);
    const venueMappings = mappings.filter(
      (mapping) => mapping.venue_id === venue.id,
    );
    const grouped = new Map<
      string,
      { category: string | null; quantity: number; revenue: bigint }
    >();
    sales
      .filter((row) => row.venue_id === venue.id)
      .forEach((row) => {
        const current = grouped.get(row.pos_product_name) ?? {
          category: row.pos_category,
          quantity: 0,
          revenue: 0n,
        };
        current.quantity += Number(row.quantity);
        current.revenue += BigInt(row.gross_minor);
        grouped.set(row.pos_product_name, current);
      });
    const rows = [...grouped.entries()]
      .map(([sourceValue, totals]) => {
        const suggestion =
          venueItems.find(
            (item) => normalize(item.name) === normalize(sourceValue),
          ) ?? null;
        return {
          sourceValue,
          category: totals.category,
          quantity: String(totals.quantity),
          revenueMinor: totals.revenue.toString(),
          existingTargetId:
            venueMappings.find(
              (mapping) => mapping.source_value === sourceValue,
            )?.target_id ?? null,
          suggestedTargetId: suggestion?.id ?? null,
          confidenceBasisPoints: suggestion ? 10000 : 0,
          reasonCode: suggestion ? ("exact" as const) : ("manual" as const),
        };
      })
      .sort((left, right) =>
        BigInt(right.revenueMinor) > BigInt(left.revenueMinor) ? 1 : -1,
      );
    return {
      id: venue.id,
      name: venue.name,
      rows,
      menuItems: venueItems.map((item) => ({ id: item.id, name: item.name })),
    };
  });
  return (
    <PosMappingWorkspace organisationId={organisationId} venues={workspaces} />
  );
}

async function inventoryCounts(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organisationId: string,
  venues: Venue[],
) {
  const [
    { data: locationData },
    { data: productData },
    { data: countData },
    { data: movementData },
  ] = await Promise.all([
    supabase
      .from("stock_locations")
      .select("id,venue_id,name")
      .eq("organisation_id", organisationId)
      .eq("active", true)
      .order("name"),
    supabase
      .from("products")
      .select("id,name,category,package_quantity")
      .eq("organisation_id", organisationId)
      .order("category")
      .order("name"),
    supabase
      .from("stock_counts")
      .select("id,trading_date,count_type,status,location_id")
      .eq("organisation_id", organisationId)
      .order("counted_at", { ascending: false })
      .limit(50),
    supabase
      .from("stock_movements")
      .select(
        "id,venue_id,location_id,product_id,trading_date,movement_type,quantity",
      )
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);
  return (
    <InventoryCountWorkspace
      organisationId={organisationId}
      venues={venues}
      locations={
        (locationData ?? []) as unknown as {
          id: string;
          venue_id: string;
          name: string;
        }[]
      }
      products={
        (productData ?? []) as unknown as {
          id: string;
          name: string;
          category: string;
          package_quantity: string;
        }[]
      }
      counts={
        (countData ?? []) as unknown as {
          id: string;
          trading_date: string;
          count_type: string;
          status: string;
          location_id: string;
        }[]
      }
      movements={
        (movementData ?? []) as unknown as {
          id: string;
          venue_id: string;
          location_id: string;
          product_id: string;
          trading_date: string;
          movement_type: string;
          quantity: string;
        }[]
      }
    />
  );
}

async function reconciliationWorkspace(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organisationId: string,
  venues: Venue[],
) {
  const { data: runsData } = await supabase
    .from("reconciliation_runs")
    .select(
      "id,venue_id,trading_date,version,status,input_hash,data_completeness_basis_points,created_at",
    )
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false })
    .limit(30);
  const runs = (runsData ?? []) as unknown as {
    id: string;
    venue_id: string;
    trading_date: string;
    version: number;
    status: string;
    input_hash: string;
    data_completeness_basis_points: number;
    created_at: string;
  }[];
  const ids = runs.map((run) => run.id);
  const [
    { data: checksData },
    { data: summaryData },
    { data: resultData },
    { data: exceptionData },
    { data: productData },
    { data: locationData },
  ] = await Promise.all([
    ids.length
      ? supabase
          .from("reconciliation_readiness_checks")
          .select(
            "id,reconciliation_id,classification,title_nl,title_en,why_it_matters_nl,why_it_matters_en,financial_exposure_minor,resolution_path",
          )
          .eq("organisation_id", organisationId)
          .in("reconciliation_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .from("reconciliation_summaries")
          .select(
            "reconciliation_id,expected_gross_revenue_minor,recorded_gross_revenue_minor,revenue_variance_minor,beverage_cost_variance_minor,margin_impact_minor,result_hash",
          )
          .eq("organisation_id", organisationId)
          .in("reconciliation_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .from("reconciliation_product_results")
          .select(
            "reconciliation_id,product_id,location_id,actual_consumption,theoretical_consumption,variance_quantity,cost_variance_minor,evidence_confidence",
          )
          .eq("organisation_id", organisationId)
          .in("reconciliation_id", ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .from("reconciliation_exceptions")
          .select(
            "id,reconciliation_id,venue_id,exception_type,status,severity,financial_impact_minor,factual_description,suggested_actions",
          )
          .eq("organisation_id", organisationId)
          .in("reconciliation_id", ids)
          .order("financial_impact_minor", { ascending: false })
      : Promise.resolve({ data: [] }),
    supabase
      .from("products")
      .select("id,name")
      .eq("organisation_id", organisationId),
    supabase
      .from("stock_locations")
      .select("id,name")
      .eq("organisation_id", organisationId),
  ]);
  return (
    <ReconciliationWorkspace
      organisationId={organisationId}
      venues={venues}
      runs={runs}
      checks={
        (checksData ?? []) as unknown as {
          id: string;
          reconciliation_id: string;
          classification: string;
          title_nl: string;
          title_en: string;
          why_it_matters_nl: string;
          why_it_matters_en: string;
          financial_exposure_minor: string | null;
          resolution_path: string;
        }[]
      }
      summaries={
        (summaryData ?? []) as unknown as {
          reconciliation_id: string;
          expected_gross_revenue_minor: string;
          recorded_gross_revenue_minor: string;
          revenue_variance_minor: string;
          beverage_cost_variance_minor: string;
          margin_impact_minor: string;
          result_hash: string;
        }[]
      }
      productResults={
        (resultData ?? []) as unknown as {
          reconciliation_id: string;
          product_id: string;
          location_id: string;
          actual_consumption: string;
          theoretical_consumption: string;
          variance_quantity: string;
          cost_variance_minor: string | null;
          evidence_confidence: string;
        }[]
      }
      exceptions={
        (exceptionData ?? []) as unknown as {
          id: string;
          reconciliation_id: string;
          venue_id: string;
          exception_type: string;
          status: string;
          severity: string;
          financial_impact_minor: string | null;
          factual_description: string;
          suggested_actions: string[];
        }[]
      }
      productNames={Object.fromEntries(
        ((productData ?? []) as unknown as { id: string; name: string }[]).map(
          (row) => [row.id, row.name],
        ),
      )}
      locationNames={Object.fromEntries(
        ((locationData ?? []) as unknown as { id: string; name: string }[]).map(
          (row) => [row.id, row.name],
        ),
      )}
    />
  );
}

async function dashboard(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organisationId: string,
  venues: Venue[],
  closes: Close[],
  locale: AuthLocale,
) {
  const t=(key:AuthMessageKey)=>authMessage(locale,key);
  const today = new Date().toISOString().slice(0, 10);
  const dayStart = `${today}T00:00:00.000Z`,
    dayEnd = `${today}T23:59:59.999Z`;
  const [
    { data: deposits },
    { data: quotes },
    { data: discrepancies },
    { data: policies },
    { data: intervals },
    { data: shifts },
    { data: actions },
    { data: serviceOperations },
  ] = await Promise.all([
    supabase
      .from("booking_deposits")
      .select("id,status,amount_minor")
      .eq("organisation_id", organisationId)
      .in("status", ["created", "pending", "failed"]),
    supabase
      .from("booking_quotes")
      .select("id,expires_at,status")
      .eq("organisation_id", organisationId)
      .in("status", ["approved", "sent"]),
    supabase
      .from("contract_discrepancies")
      .select("id,status,financial_impact_minor")
      .eq("organisation_id", organisationId)
      .in("status", ["open", "reviewing", "disputed"]),
    supabase
      .from("compliance_policies")
      .select("id,expires_at")
      .eq("organisation_id", organisationId),
    supabase
      .from("demand_forecast_intervals")
      .select(
        "id,venue_id,expected_guests,expected_revenue_minor,required_staff,starts_at,ends_at",
      )
      .eq("organisation_id", organisationId)
      .gte("starts_at", dayStart)
      .lte("starts_at", dayEnd),
    supabase
      .from("shifts")
      .select(
        "id,venue_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor,status",
      )
      .eq("organisation_id", organisationId)
      .gte("starts_at", dayStart)
      .lte("starts_at", dayEnd)
      .not("status", "in", "(cancelled,rejected)"),
    supabase
      .from("operating_actions")
      .select(
        "id,title,rationale,why_it_matters,recommended_response,severity,status,due_at,expected_impact_minor,venue_id,evidence_completeness_basis_points,rank_score,action_type,service_operation_id",
      )
      .eq("organisation_id", organisationId)
      .in("status", ["open", "approved", "in_progress"])
      .order("rank_score", { ascending: false })
      .limit(20),
    supabase
      .from("service_operations")
      .select("id,venue_id,service_date,stage,status,demand_snapshot,staffing_snapshot,consumption_snapshot,inventory_snapshot,purchasing_snapshot,live_snapshot,outcome_snapshot,readiness_checks,missing_evidence,stale_reasons")
      .eq("organisation_id", organisationId)
      .order("service_date", { ascending: false })
      .order("version", { ascending: false })
      .limit(1),
  ]);
  const unexplained = closes.filter(
    (close) => BigInt(close.difference_minor) !== 0n,
  );
  const unapproved = closes.filter((close) =>
    ["draft", "reopened", "submitted"].includes(close.status),
  );
  const depositRows = (deposits ?? []) as unknown as {
    id: string;
    status: string;
    amount_minor: string;
  }[];
  const discrepancyRows = (discrepancies ?? []) as unknown as {
    id: string;
    status: string;
    financial_impact_minor: string;
  }[];
  const soon = Date.now() + 14 * 86400000;
  const expiringQuotes = (
    (quotes ?? []) as unknown as { id: string; expires_at: string }[]
  ).filter((row) => new Date(row.expires_at).getTime() < soon);
  const expiringPolicies = (
    (policies ?? []) as unknown as { id: string; expires_at: string | null }[]
  ).filter(
    (row) => row.expires_at && new Date(row.expires_at).getTime() < soon,
  );
  const intervalRows = (intervals ?? []) as unknown as {
    id: string;
    expected_guests: number;
    expected_revenue_minor: string;
    required_staff: number;
  }[];
  const shiftRows = (shifts ?? []) as unknown as {
    id: string;
    staff_id: string | null;
    starts_at: string;
    ends_at: string;
    break_minutes: number;
    hourly_cost_minor: string;
    status: string;
  }[];
  const expectedGuests = intervalRows.reduce(
    (sum, row) => sum + row.expected_guests,
    0,
  );
  const expectedRevenue = intervalRows.reduce(
    (sum, row) => sum + BigInt(row.expected_revenue_minor),
    0n,
  );
  const scheduledLabor = shiftRows.reduce((sum, row) => {
    const minutes = Math.max(
      0,
      Math.floor(
        (new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) /
          60000,
      ) - row.break_minutes,
    );
    return sum + (BigInt(row.hourly_cost_minor) * BigInt(minutes) + 30n) / 60n;
  }, 0n);
  const laborBps =
    expectedRevenue === 0n ? 0n : (scheduledLabor * 10000n) / expectedRevenue;
  const actionRows = (actions ?? []) as unknown as {
    id: string;
    title: string;
    rationale: string;
    severity: string;
    status: string;
    due_at: string | null;
    expected_impact_minor: string | null;
    why_it_matters: string | null;
    recommended_response: string | null;
    evidence_completeness_basis_points: number;
    rank_score: string;
    action_type: string;
  }[];
  const serviceOperation = ((serviceOperations ?? [])[0] ?? null) as unknown as {
    id: string;
    venue_id: string;
    service_date: string;
    stage: string;
    status: string;
    demand_snapshot: Record<string,unknown>;
    staffing_snapshot: Record<string,unknown>;
    consumption_snapshot: Record<string,unknown>;
    inventory_snapshot: Record<string,unknown>;
    purchasing_snapshot: Record<string,unknown>;
    live_snapshot: Record<string,unknown>;
    outcome_snapshot: Record<string,unknown>;
    readiness_checks: Array<Record<string,unknown>>;
    missing_evidence: string[];
    stale_reasons: string[];
  } | null;
  return (
    <>
      <ServiceAutopilot organisationId={organisationId} venues={venues.map(venue=>({id:venue.id,name:venue.name}))} initialOperation={serviceOperation} actions={actionRows} />
      <section className="morning-brief">
        <div>
          <span className="eyebrow">{t("dashboard.brief")} · {today}</span>
          <h2>
            {intervalRows.length
              ? `${expectedGuests} ${t("dashboard.expectedGuests")} ${euro(expectedRevenue,locale)} ${t("dashboard.revenue")}.`
              : t("dashboard.noForecast")}
          </h2>
          <p>
            {shiftRows.length
              ? `${shiftRows.length} ${t("dashboard.scheduledShifts")} · ${euro(scheduledLabor,locale)} ${t("dashboard.laborCosts")} · ${Number(laborBps) / 100}% ${t("dashboard.forecastShare")}.`
              : t("dashboard.planFromDemand")}
          </p>
        </div>
        <Link className="primary" href="/app/planning">
          {t("dashboard.openPlanning")}
        </Link>
      </section>
      <section className="metric-grid">
        <Metric
          href="/app/planning"
          label={t("dashboard.guestsToday")}
          value={String(expectedGuests)}
          detail={`${intervalRows.length} ${t("dashboard.demandIntervals")}`}
        />
        <Metric
          href="/app/planning"
          label={t("dashboard.scheduledLabor")}
          value={euro(scheduledLabor,locale)}
          detail={`${Number(laborBps) / 100}% ${t("dashboard.forecastShare")}`}
        />
        <Metric
          href="/app/close"
          label={t("dashboard.unexplainedClose")}
          value={euro(
            unexplained.reduce(
              (sum, row) => sum + BigInt(row.difference_minor),
              0n,
            ),locale
          )}
          detail={`${unexplained.length} ${t("dashboard.closes")}`}
        />
        <Metric
          href="/app/close"
          label={t("dashboard.notApproved")}
          value={String(unapproved.length)}
          detail={t("dashboard.notApprovedHelp")}
        />
        <Metric
          href="/app/bookings"
          label={t("dashboard.openDeposits")}
          value={euro(
            depositRows.reduce(
              (sum, row) => sum + BigInt(row.amount_minor),
              0n,
            ),locale
          )}
          detail={`${depositRows.length} ${t("dashboard.actions")}`}
        />
        <Metric
          href="/app/bookings"
          label={t("dashboard.expiringQuotes")}
          value={String(expiringQuotes.length)}
          detail={t("dashboard.withinTwoWeeks")}
        />
        <Metric
          href="/app/suppliers"
          label={t("dashboard.openDiscrepancies")}
          value={String(discrepancyRows.length)}
          detail={euro(
            discrepancyRows.reduce(
              (sum, row) => sum + BigInt(row.financial_impact_minor),
              0n,
            ),locale
          )}
        />
        <Metric
          href="/app/compliance"
          label={t("dashboard.expiringPolicies")}
          value={String(expiringPolicies.length)}
          detail={t("dashboard.reviewPolicy")}
        />
      </section>
      <section className="panel">
        <header>
          <div>
            <h3>{t("dashboard.queue")}</h3>
            <p>{t("dashboard.queueHelp")}</p>
          </div>
        </header>
        {!unapproved.length &&
        !depositRows.length &&
        !discrepancyRows.length &&
        !actionRows.length ? (
          <div className="empty-state">
            <h3>{t("dashboard.noActions")}</h3>
            <p>{t("dashboard.noActionsHelp")}</p>
          </div>
        ) : (
          <div className="record-list">
            {actionRows.map((row) => (
              <Link key={row.id} href="/app/alerts">
                <b>
                  <span className={`severity ${row.severity}`}>
                    {authEnumLabel(locale,row.severity)}
                  </span>{" "}
                  {row.title}
                </b>
                <span>{row.rationale}</span>
                <em>
                  {row.expected_impact_minor
                    ? euro(row.expected_impact_minor,locale)
                    : t("common.impactUnknown")}
                  {row.due_at ? <small>{t("common.before")} {date(row.due_at,locale)}</small> : null}
                </em>
              </Link>
            ))}
            {unapproved.slice(0, 5).map((row) => (
              <Link key={row.id} href={`/app/close/${row.id}`}>
                <b>Close {row.trading_date}</b>
                <span>
                  {authEnumLabel(locale,row.status)} ·{" "}
                  {venues.find((v) => v.id === row.venue_id)?.name}
                </span>
                <em>{t("common.open")} →</em>
              </Link>
            ))}
            {depositRows.slice(0, 3).map((row) => (
              <Link key={row.id} href="/app/bookings">
                <b>{t("dashboard.bookingDeposit")}</b>
                <span>
                  {authEnumLabel(locale,row.status)} · {euro(row.amount_minor,locale)}
                </span>
                <em>{t("common.open")} →</em>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}

async function planning(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organisationId: string,
  venues: Venue[],
  locale: AuthLocale,
) {
  const t=(key:AuthMessageKey)=>authMessage(locale,key);
  const exceptionResponses=await Promise.all(venues.map(venue=>supabase.rpc("get_workforce_exception_inbox" as "clock_out",{target_organisation_id:organisationId,target_venue_id:venue.id,target_reference_at:new Date().toISOString()} as never)));
  const exceptionFailure=exceptionResponses.find(response=>response.error)?.error;
  if(exceptionFailure)throw exceptionFailure;
  const [
    { data: departmentData },
    { data: roleData },
    { data: staffData },
    { data: intervalData },
    { data: shiftData },
    { data: proposalData },
    { data: requestData },
    { data: recipientData },
    { data: absenceData },
    { data: staffAvailabilityData },
    { data: qualificationData },
    { data: timeRecordData },
    { data: breakPlanData },
    { data: rosterTemplateData },
    { data: managerSwapData },
    { data: timeCorrectionData },
    { data: approvedLabourData },
    { data: workforceLearningData,error:workforceLearningError },
  ] = await Promise.all([
    supabase
      .from("departments")
      .select("id,venue_id,name")
      .eq("organisation_id", organisationId)
      .order("name"),
    supabase
      .from("operational_roles")
      .select(
        "id,department_id,name,hourly_cost_minor,minimum_staff,guests_per_staff",
      )
      .eq("organisation_id", organisationId)
      .order("name"),
    supabase
      .from("staff_profiles")
      .select("id,full_name,role_name,onboarding_status,contact_email,contact_phone,preferred_language,employment_status,invitation_state,effective_hourly_cost_minor,contracted_minutes_week,minimum_minutes_week,maximum_minutes_week,preferences")
      .eq("organisation_id", organisationId)
      .order("full_name"),
    supabase
      .from("demand_forecast_intervals")
      .select(
        "id,venue_id,starts_at,ends_at,expected_guests,expected_revenue_minor,required_staff",
      )
      .eq("organisation_id", organisationId)
      .order("starts_at", { ascending: false })
      .limit(30),
    supabase
      .from("shifts")
      .select(
        "id,venue_id,department_id,role_id,staff_id,starts_at,ends_at,break_minutes,hourly_cost_minor,status,revision,locked",
      )
      .eq("organisation_id", organisationId)
      .order("starts_at", { ascending: false })
      .limit(50),
    supabase
      .from("roster_proposals")
      .select("id,venue_id,objective,status,result_summary,created_at")
      .eq("organisation_id", organisationId)
      .in("status", ["current", "applied"])
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("availability_request_periods")
      .select("id,venue_id,starts_at,ends_at,deadline_at,status,created_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("availability_request_recipients")
      .select("id,request_id,staff_id,status,opened_at,submitted_at")
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("staff_absences")
      .select("id,venue_id,staff_id,starts_at,ends_at,absence_type,status,note")
      .eq("organisation_id", organisationId)
      .order("starts_at", { ascending: false })
      .limit(200),
    supabase
      .from("staff_availability")
      .select("staff_id,venue_id,starts_at,ends_at,availability,submitted_at,source")
      .eq("organisation_id", organisationId)
      .order("starts_at", { ascending: false })
      .limit(500),
    supabase
      .from("staff_role_qualifications")
      .select("staff_id,role_id,qualified_until")
      .eq("organisation_id", organisationId),
    supabase
      .from("time_records")
      .select("id,venue_id,staff_id,shift_id,clocked_in_at,clocked_out_at,break_minutes,status,approved_at")
      .eq("organisation_id", organisationId)
      .order("clocked_in_at", { ascending: false })
      .limit(200),
    supabase.from("shift_break_plans").select("id,venue_id,shift_id,starts_at,ends_at,status,revision").eq("organisation_id",organisationId).in("status",["planned","adjusted","taken","missed"]).order("starts_at",{ascending:false}).limit(200),
    supabase.from("roster_templates").select("id,venue_id,name,shift_pattern,active").eq("organisation_id",organisationId).eq("active",true).order("name"),
    supabase.from("swap_requests").select("id,venue_id,shift_id,requester_staff_id,candidate_staff_id,state,reason,cost_effect_minor,created_at").eq("organisation_id",organisationId).in("state",["requested","candidate_accepted"]).order("created_at"),
    supabase.from("time_corrections").select("id,venue_id,time_record_id,reason,original_values,proposed_values,status,created_at").eq("organisation_id",organisationId).eq("status","requested").order("created_at"),
    supabase.from("approved_labour_results").select("id,venue_id,trading_date,planned_minutes,worked_minutes,planned_cost_minor,actual_cost_minor,calculation_version,evidence,content_hash,calculated_at").eq("organisation_id",organisationId).order("calculated_at",{ascending:false}).limit(60),
    supabase.from("workforce_learning_results").select("id,venue_id,service_date,evidence_state,comparable_count,comparison_method,result,evidence_refs,calculation_version,content_hash,created_at").eq("organisation_id",organisationId).order("created_at",{ascending:false}).limit(30),
  ]);
  if(workforceLearningError)throw workforceLearningError;
  const departments = (departmentData ?? []) as unknown as {
    id: string;
    venue_id: string;
    name: string;
  }[];
  const roles = (roleData ?? []) as unknown as {
    id: string;
    department_id: string;
    name: string;
    hourly_cost_minor: string;
    minimum_staff: number;
    guests_per_staff: number;
  }[];
  const staff = (staffData ?? []) as unknown as {
    id: string;
    full_name: string;
    role_name: string;
    onboarding_status: string;
    contact_email: string | null;
    contact_phone:string|null;
    preferred_language:string;
    employment_status:string;
    invitation_state:string;
    effective_hourly_cost_minor: string | null;
    contracted_minutes_week: number | null;
    minimum_minutes_week:number|null;
    maximum_minutes_week: number | null;
    preferences: Record<string,unknown>;
  }[];
  const intervals = (intervalData ?? []) as unknown as {
    id: string;
    venue_id: string;
    starts_at: string;
    ends_at: string;
    expected_guests: number;
    expected_revenue_minor: string;
    required_staff: number;
  }[];
  const shifts = (shiftData ?? []) as unknown as {
    id: string;
    venue_id: string;
    department_id: string;
    role_id: string;
    staff_id: string | null;
    starts_at: string;
    ends_at: string;
    break_minutes: number;
    hourly_cost_minor: string;
    status: string;
    revision: number;
    locked: boolean;
  }[];
  const proposals = (proposalData ?? []) as unknown as {id:string;venue_id:string;objective:string;status:string;result_summary:{coverage_basis_points:number;unfilled_assignments:number;total_planned_minutes:number;planned_cost_minor:string;preferred_assignments:number;missing_evidence:string[]};created_at:string;approval_status:string;rationale:string;confidence_basis:string;execution_status:string;missing_data:string[]}[];
  const requests = (requestData ?? []) as unknown as {
    id: string;
    venue_id: string;
    starts_at: string;
    ends_at: string;
    deadline_at: string;
    status: string;
    created_at: string;
  }[];
  const recipients = (recipientData ?? []) as unknown as {
    id: string;
    request_id: string;
    staff_id: string;
    status: string;
    opened_at: string | null;
    submitted_at: string | null;
  }[];
  const absences = (absenceData ?? []) as unknown as {
    id: string;
    venue_id: string;
    staff_id: string;
    starts_at: string;
    ends_at: string;
    absence_type: string;
    status: string;
    note: string | null;
  }[];
  const staffAvailability = (staffAvailabilityData ?? []) as unknown as {staff_id:string;venue_id:string;starts_at:string;ends_at:string;availability:"available"|"preferred"|"preferably_not"|"unavailable";submitted_at:string|null;source:string}[];
  const qualifications = (qualificationData ?? []) as unknown as {staff_id:string;role_id:string;qualified_until:string|null}[];
  const timeRecords = (timeRecordData ?? []) as unknown as {id:string;venue_id:string;staff_id:string;shift_id:string|null;clocked_in_at:string;clocked_out_at:string|null;break_minutes:number;status:string;approved_at:string|null}[];
  const breakPlans=(breakPlanData??[]) as unknown as {id:string;venue_id:string;shift_id:string;starts_at:string;ends_at:string;status:string;revision:number}[];
  const rosterTemplates=(rosterTemplateData??[]) as unknown as {id:string;venue_id:string;name:string;shift_pattern:unknown[];active:boolean}[];
  const managerSwaps=(managerSwapData??[]) as unknown as {id:string;venue_id:string;shift_id:string;requester_staff_id:string;candidate_staff_id:string;state:string;reason:string|null;cost_effect_minor:string|null;created_at:string}[];
  const timeCorrections=(timeCorrectionData??[]) as unknown as {id:string;venue_id:string;time_record_id:string;reason:string;original_values:Record<string,unknown>;proposed_values:Record<string,unknown>;status:string;created_at:string}[];
  const approvedLabourResults=(approvedLabourData??[]) as unknown as {id:string;venue_id:string;trading_date:string;planned_minutes:number;worked_minutes:number;planned_cost_minor:string;actual_cost_minor:string;calculation_version:string;evidence:Record<string,unknown>;content_hash:string;calculated_at:string}[];
  const workforceExceptions=exceptionResponses.flatMap((response,index)=>((response.data??[]) as unknown as {action_key:string;exception_type:string;severity:string;rank_score:string;relevant_at:string;shift_id:string|null;staff_id:string|null;source_id:string;evidence:Record<string,unknown>;why_it_matters:string;recommended_action:string;resolution_condition:string}[]).map(item=>({...item,venue_id:venues[index]?.id??""})));
  const workforceLearning=(workforceLearningData??[]) as unknown as {id:string;venue_id:string;service_date:string;evidence_state:string;comparable_count:number;comparison_method:Record<string,unknown>;result:Record<string,unknown>;evidence_refs:Record<string,unknown>;calculation_version:string;content_hash:string;created_at:string}[];
  const departmentOptions = departments.map((row) => ({
    label: row.name,
    value: row.id,
  }));
  const roleOptions = roles.map((row) => ({ label: row.name, value: row.id }));
  const staffOptions = [
    { label: t("planning.openShift"), value: "open" },
    ...staff.map((row) => ({
      label: `${row.full_name} · ${row.role_name}`,
      value: row.id,
    })),
  ];
  return (
    <RosterBoard
      organisationId={organisationId}
      venues={venues.map((venue) => ({ id: venue.id, name: venue.name, timezone: venue.timezone }))}
      departments={departments}
      roles={roles}
      staff={staff}
      intervals={intervals}
      initialShifts={shifts}
      absences={absences}
      staffAvailability={staffAvailability}
      qualifications={qualifications}
      timeRecords={timeRecords}
      breakPlans={breakPlans}
      rosterTemplates={rosterTemplates}
      swaps={managerSwaps}
      timeCorrections={timeCorrections}
      approvedLabourResults={approvedLabourResults}
      workforceExceptions={workforceExceptions}
      workforceLearning={workforceLearning}
      proposals={proposals}
    />
  );
  /* The legacy form workspace remains below temporarily as a recovery reference,
     but is intentionally unreachable while the product roster is active. */
  return (
    <div className="workflow-stack">
      <section className="connected-flow">
        <span>{t("planning.demand")}</span>
        <b>→</b>
        <span>{t("planning.forecast")}</span>
        <b>→</b>
        <span>{t("planning.schedule")}</span>
        <b>→</b>
        <span>{t("planning.publish")}</span>
        <b>→</b>
        <span>{t("planning.hours")}</span>
        <b>→</b>
        <span>Close & Learn</span>
      </section>
      <div className="split-workspace">
        <AvailabilityManager
          organisationId={organisationId}
          venueTimezone={venues[0]?.timezone ?? "Europe/Amsterdam"}
          venues={venues.map((v) => ({ id: v.id, label: v.name }))}
          staff={staff.map((person) => ({
            id: person.id,
            label: `${person.full_name} · ${person.role_name}`,
          }))}
        />
        <RecordPanel
          title={t("planning.availabilityRequests")}
          empty={t("planning.noRequests")}
        >
          {requests.map((request) => {
            const rows = recipients.filter(
              (row) => row.request_id === request.id,
            );
            return (
              <div className="record-row" key={request.id}>
                <b>
                  {venues.find((v) => v.id === request.venue_id)?.name ||
                    t("common.venue")}{" "}
                  · {authEnumLabel(locale,request.status)}
                </b>
                <span>
                  {date(request.starts_at,locale)}–{date(request.ends_at,locale)}
                  <small>
                    {rows
                      .map(
                        (row) =>
                          `${staff.find((s) => s.id === row.staff_id)?.full_name || t("planning.employee")}: ${authEnumLabel(locale,row.status)}`,
                      )
                      .join(" · ")}
                  </small>
                </span>
                <em>
                  {rows.filter((row) => row.status === "submitted").length}/
                  {rows.length} {t("planning.submitted")}
                  <small>{t("availability.deadline")} {date(request.deadline_at,locale)}</small>
                </em>
              </div>
            );
          })}
        </RecordPanel>
      </div>
      <div className="split-workspace">
        <WorkflowForm
          endpoint="/api/planning"
          organisationId={organisationId}
          workflow="forecast"
          title={t("planning.forecastTitle")}
          submitLabel={t("planning.saveForecast")}
          fields={[
            {
              name: "venueId",
              label: t("common.venue"),
              type: "select",
              required: true,
              options: venueOptions(venues),
            },
            {
              name: "tradingDate",
              label: t("planning.tradingDate"),
              type: "date",
              required: true,
            },
            {
              name: "startsAt",
              label: t("planning.intervalStart"),
              type: "datetime-local",
              required: true,
            },
            {
              name: "endsAt",
              label: t("planning.intervalEnd"),
              type: "datetime-local",
              required: true,
            },
            {
              name: "expectedGuests",
              label: t("planning.expectedGuests"),
              type: "number",
              required: true,
            },
            {
              name: "expectedRevenue",
              label: t("planning.expectedRevenue"),
              required: true,
            },
            {
              name: "minimumStaff",
              label: t("planning.minimumStaff"),
              type: "number",
              required: true,
            },
            {
              name: "guestsPerStaff",
              label: t("planning.guestsPerStaff"),
              type: "number",
              required: true,
            },
            {
              name: "managerNote",
              label: t("planning.assumptions"),
              type: "textarea",
            },
          ]}
        />
        <RecordPanel
          title={t("planning.demandByInterval")}
          empty={t("planning.noForecast")}
        >
          {intervals.map((row) => (
            <div className="record-row" key={row.id}>
              <b>
                {new Date(row.starts_at).toLocaleString(authIntlLocale(locale), {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </b>
              <span>
                {row.expected_guests} {t("planning.guests")} · {row.required_staff} {t("planning.staffRequired")}
              </span>
              <em>{euro(row.expected_revenue_minor,locale)}</em>
            </div>
          ))}
        </RecordPanel>
      </div>
      {!departments.length ? (
        <div className="split-workspace">
          <WorkflowForm
            endpoint="/api/planning"
            organisationId={organisationId}
            workflow="department"
            title={t("planning.firstDepartment")}
            submitLabel={t("planning.addDepartment")}
            fields={[
              {
                name: "venueId",
                label: t("common.venue"),
                type: "select",
                required: true,
                options: venueOptions(venues),
              },
              {
                name: "name",
                label: t("planning.departmentName"),
                required: true,
                placeholder: t("planning.departmentPlaceholder"),
              },
            ]}
          />
          <div className="legal-note">
            {t("planning.departmentFirst")}
          </div>
        </div>
      ) : !roles.length ? (
        <WorkflowForm
          endpoint="/api/planning"
          organisationId={organisationId}
          workflow="role"
          title={t("planning.firstRole")}
          submitLabel={t("planning.addRole")}
          fields={[
            {
              name: "departmentId",
              label: t("planning.department"),
              type: "select",
              required: true,
              options: departmentOptions,
            },
            { name: "name", label: t("planning.roleName"), required: true },
            {
              name: "hourlyCost",
              label: t("planning.allInCost"),
              required: true,
            },
            {
              name: "minimumStaff",
              label: t("planning.minimumStaff"),
              type: "number",
              required: true,
            },
            {
              name: "guestsPerStaff",
              label: t("planning.guestsPerStaff"),
              type: "number",
              required: true,
            },
          ]}
        />
      ) : (
        <div className="split-workspace">
          <WorkflowForm
            endpoint="/api/planning"
            organisationId={organisationId}
            workflow="shift"
            title={t("planning.draftShift")}
            submitLabel={t("planning.addShift")}
            fields={[
              {
                name: "venueId",
                label: t("common.venue"),
                type: "select",
                required: true,
                options: venueOptions(venues),
              },
              {
                name: "departmentId",
                label: t("planning.department"),
                type: "select",
                required: true,
                options: departmentOptions,
              },
              {
                name: "roleId",
                label: t("planning.role"),
                type: "select",
                required: true,
                options: roleOptions,
              },
              {
                name: "staffId",
                label: t("planning.employee"),
                type: "select",
                required: true,
                options: staffOptions,
              },
              {
                name: "startsAt",
                label: t("planning.start"),
                type: "datetime-local",
                required: true,
              },
              {
                name: "endsAt",
                label: t("planning.end"),
                type: "datetime-local",
                required: true,
              },
              {
                name: "breakMinutes",
                label: t("planning.break"),
                type: "number",
                required: true,
              },
              { name: "hourlyCost", label: t("planning.hourlyCost"), required: true },
            ]}
          />
          <RecordPanel
            title={t("planning.roster")}
            empty={t("planning.noShifts")}
          >
            {shifts.map((row) => (
              <div className="record-row" key={row.id}>
                <b>
                  {staff.find((person) => person.id === row.staff_id)
                    ?.full_name || t("planning.openShift")}{" "}
                  ·{" "}
                  {roles.find((role) => role.id === row.role_id)?.name || t("planning.role")}
                </b>
                <span>
                  {new Date(row.starts_at).toLocaleString(authIntlLocale(locale), {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                  –
                  {new Date(row.ends_at).toLocaleTimeString(authIntlLocale(locale), {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <em>{authEnumLabel(locale,row.status)}</em>
              </div>
            ))}
          </RecordPanel>
        </div>
      )}
      <div className="split-workspace">
        <WorkflowForm
          endpoint="/api/planning"
          organisationId={organisationId}
          workflow="publish"
          title={t("planning.publishTitle")}
          submitLabel={t("planning.publishChecked")}
          fields={[
            {
              name: "venueId",
              label: t("common.venue"),
              type: "select",
              required: true,
              options: venueOptions(venues),
            },
            {
              name: "startsAt",
              label: t("availability.periodStart"),
              type: "datetime-local",
              required: true,
            },
            {
              name: "endsAt",
              label: t("availability.periodEnd"),
              type: "datetime-local",
              required: true,
            },
          ]}
        />
        <WorkflowForm
          endpoint="/api/planning"
          organisationId={organisationId}
          workflow="proposal"
          title={t("planning.explainableCheck")}
          submitLabel={t("planning.generateProposal")}
          fields={[
            {
              name: "venueId",
              label: t("common.venue"),
              type: "select",
              required: true,
              options: venueOptions(venues),
            },
            {
              name: "tradingDate",
              label: t("planning.tradingDate"),
              type: "date",
              required: true,
            },
          ]}
        />
      </div>
      <RecordPanel
        title={t("planning.governedProposals")}
        empty={t("planning.noProposals")}
      >
        {proposals.map((row) => (
          <div className="record-row" key={row.id}>
            <b>
              {authEnumLabel(locale,row.approval_status)} · {date(row.created_at,locale)}
            </b>
            <span>
              {row.rationale}
              <small>{row.confidence_basis}</small>
            </span>
            <em>
              {authEnumLabel(locale,row.execution_status)}
              {row.missing_data.length ? (
                <small>{row.missing_data.join(" ")}</small>
              ) : null}
            </em>
          </div>
        ))}
      </RecordPanel>
    </div>
  );
}

async function myWork(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organisationId: string,
  venues: Venue[],
  userId: string,
  locale: AuthLocale,
) {
  const t=(key:AuthMessageKey)=>authMessage(locale,key);
  const { data: profile } = await supabase
    .from("staff_profiles")
    .select("id,full_name")
    .eq("organisation_id", organisationId)
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (!profile)
    return (
      <section className="panel">
        <div className="empty-state">
          <h2>{t("myWork.profileRequired")}</h2>
          <p>{t("myWork.profileHelp")}</p>
        </div>
      </section>
    );
  const staff = profile as unknown as { id: string; full_name: string };
  const [
    { data: shiftData },
    { data: responseData },
    { data: timeData },
    { data: availabilityData },
    { data: absenceData },
    { data: swapData },
  ] = await Promise.all([
    supabase
      .from("shifts")
      .select("id,venue_id,starts_at,ends_at,break_minutes,status")
      .eq("organisation_id", organisationId)
      .eq("staff_id", staff.id)
      .gte("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(14),
    supabase
      .from("shift_responses")
      .select("shift_id,response")
      .eq("organisation_id", organisationId)
      .eq("staff_id", staff.id),
    supabase
      .from("time_records")
      .select(
        "id,venue_id,clocked_in_at,clocked_out_at,break_minutes,status,approved_at",
      )
      .eq("organisation_id", organisationId)
      .eq("staff_id", staff.id)
      .order("clocked_in_at", { ascending: false })
      .limit(14),
    supabase
      .from("staff_availability")
      .select("id,starts_at,ends_at,availability")
      .eq("organisation_id", organisationId)
      .eq("staff_id", staff.id)
      .gte("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(14),
    supabase.from("staff_absences").select("id,venue_id,starts_at,ends_at,absence_type,status,note").eq("organisation_id",organisationId).eq("staff_id",staff.id).order("starts_at",{ascending:false}).limit(20),
    supabase.from("swap_requests").select("id,venue_id,shift_id,requester_staff_id,candidate_staff_id,state,reason,manager_reason,cost_effect_minor,created_at").eq("organisation_id",organisationId).or(`requester_staff_id.eq.${staff.id},candidate_staff_id.eq.${staff.id}`).order("created_at",{ascending:false}).limit(20),
  ]);
  const shifts = (shiftData ?? []) as unknown as {
    id: string;
    venue_id: string;
    starts_at: string;
    ends_at: string;
    break_minutes: number;
    status: string;
  }[];
  const responses = (responseData ?? []) as unknown as {
    shift_id: string;
    response: string;
  }[];
  const records = (timeData ?? []) as unknown as {
    id: string;
    venue_id: string;
    clocked_in_at: string;
    clocked_out_at: string | null;
    break_minutes: number;
    status: string;
    approved_at: string | null;
  }[];
  const availability = (availabilityData ?? []) as unknown as {
    id: string;
    starts_at: string;
    ends_at: string;
    availability: string;
  }[];
  const ownAbsences=(absenceData??[]) as unknown as {id:string;venue_id:string;starts_at:string;ends_at:string;absence_type:string;status:string;note:string|null}[];
  const swaps=(swapData??[]) as unknown as {id:string;venue_id:string;shift_id:string;requester_staff_id:string;candidate_staff_id:string;state:string;reason:string|null;manager_reason:string|null;cost_effect_minor:string|null;created_at:string}[];
  const candidateResults=await Promise.all(shifts.filter(shift=>shift.status==="published").map(async shift=>{const {data}=await supabase.rpc("eligible_swap_candidates" as "clock_out",{target_organisation_id:organisationId,target_shift_id:shift.id} as never);return[shift.id,(data??[]) as unknown as {staff_id:string;full_name:string}[]] as const}));
  const swapCandidates=new Map(candidateResults);
  const {data:eligibleOfferData}=await supabase.rpc("eligible_open_shift_offers" as "clock_out",{target_organisation_id:organisationId} as never);
  const eligibleOffers=(eligibleOfferData??[]) as unknown as {offer_id:string;venue_id:string;shift_id:string;starts_at:string;ends_at:string;break_minutes:number;role_name:string;closes_at:string}[];
  const openRecord = records.find((record) => !record.clocked_out_at);
  const next = shifts[0];
  return (
    <div className="workflow-stack employee-work">
      <section className="morning-brief">
        <div>
          <div className="eyebrow">{t("myWork.eyebrow")} · {staff.full_name}</div>
          <h2>
            {next
              ? `${t("myWork.nextShift")} ${new Date(next.starts_at).toLocaleString(authIntlLocale(locale), { weekday: "long", hour: "2-digit", minute: "2-digit" })}`
              : t("myWork.noNextShift")}
          </h2>
          <p>{t("myWork.privateHelp")}</p>
        </div>
        <span className="status">
          {openRecord ? t("myWork.clockedIn") : t("myWork.notClockedIn")}
        </span>
      </section>
      {openRecord ? (
        <div className="workflow-stack"><WorkflowForm
          endpoint="/api/workforce"
          organisationId={organisationId}
          workflow="clock_out"
          title={t("myWork.activeShift")}
          submitLabel={t("myWork.clockOut")}
          fields={[
            {name:"idempotencyKey",label:"",type:"hidden",defaultValue:crypto.randomUUID()},
            {
              name: "timeRecordId",
              label: t("myWork.timeRecord"),
              type: "select",
              required: true,
              options: [
                {
                  label: `${t("myWork.started")} ${new Date(openRecord.clocked_in_at).toLocaleTimeString(authIntlLocale(locale), { hour: "2-digit", minute: "2-digit" })}`,
                  value: openRecord.id,
                },
              ],
            },
          ]}
        /><div className="split-workspace"><WorkflowForm endpoint="/api/workforce" organisationId={organisationId} workflow="start_break" title={locale==="nl"?"Pauze":"Break"} submitLabel={locale==="nl"?"Start pauze":"Start break"} fields={[{name:"idempotencyKey",label:"",type:"hidden",defaultValue:crypto.randomUUID()},{name:"timeRecordId",label:t("myWork.timeRecord"),type:"select",required:true,options:[{label:t("myWork.activeShift"),value:openRecord.id}]}]}/><WorkflowForm endpoint="/api/workforce" organisationId={organisationId} workflow="end_break" title={locale==="nl"?"Lopende pauze":"Active break"} submitLabel={locale==="nl"?"Beëindig pauze":"End break"} fields={[{name:"idempotencyKey",label:"",type:"hidden",defaultValue:crypto.randomUUID()},{name:"timeRecordId",label:t("myWork.timeRecord"),type:"select",required:true,options:[{label:t("myWork.activeShift"),value:openRecord.id}]}]}/></div></div>
      ) : next ? (
        <WorkflowForm
          endpoint="/api/workforce"
          organisationId={organisationId}
          workflow="clock_in"
          title={t("myWork.attendance")}
          submitLabel={t("myWork.clockIn")}
          fields={[
            {name:"idempotencyKey",label:"",type:"hidden",defaultValue:crypto.randomUUID()},
            {
              name: "venueId",
              label: t("common.venue"),
              type: "select",
              required: true,
              options: venueOptions(
                venues.filter((v) => v.id === next.venue_id),
              ),
            },
            {
              name: "shiftId",
              label: t("myWork.shift"),
              type: "select",
              required: true,
              options: [
                {
                  label: new Date(next.starts_at).toLocaleString(authIntlLocale(locale)),
                  value: next.id,
                },
              ],
            },
          ]}
        />
      ) : null}
      <section className="mobile-roster" aria-label={t("myWork.upcomingSchedule")}>
        {shifts.length ? (
          shifts.map((shift) => (
            <article key={shift.id}>
              <div>
                <b>
                  {new Date(shift.starts_at).toLocaleDateString(authIntlLocale(locale), {
                    weekday: "long",
                    day: "numeric",
                    month: "short",
                  })}
                </b>
                <span>
                  {new Date(shift.starts_at).toLocaleTimeString(authIntlLocale(locale), {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                  –
                  {new Date(shift.ends_at).toLocaleTimeString(authIntlLocale(locale), {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {t("myWork.break")} {shift.break_minutes} min
                </span>
              </div>
              <em>
                {authEnumLabel(locale,responses.find((r) => r.shift_id === shift.id)?.response || shift.status)}
              </em>
              {!responses.some((r) => r.shift_id === shift.id) &&
              shift.status === "published" ? (
                <WorkflowForm
                  endpoint="/api/workforce"
                  organisationId={organisationId}
                  workflow="respond"
                  title={t("myWork.confirmShift")}
                  submitLabel={t("myWork.saveResponse")}
                  fields={[
                    {
                      name: "venueId",
                      label: t("common.venue"),
                      type: "select",
                      required: true,
                      options: [
                        {
                          label:
                            venues.find((v) => v.id === shift.venue_id)?.name ||
                            t("common.venue"),
                          value: shift.venue_id,
                        },
                      ],
                    },
                    {
                      name: "shiftId",
                      label: t("myWork.shift"),
                      type: "select",
                      required: true,
                      options: [
                        {
                          label: new Date(shift.starts_at).toLocaleString(
                            authIntlLocale(locale),
                          ),
                          value: shift.id,
                        },
                      ],
                    },
                    {
                      name: "staffId",
                      label: t("planning.employee"),
                      type: "select",
                      required: true,
                      options: [{ label: staff.full_name, value: staff.id }],
                    },
                    {
                      name: "response",
                      label: t("myWork.response"),
                      type: "select",
                      required: true,
                      options: [
                        { label: t("myWork.accept"), value: "accepted" },
                        { label: t("myWork.reject"), value: "rejected" },
                      ],
                    },
                    { name: "reason", label: t("myWork.rejectReason") },
                  ]}
                />
              ) : null}
            </article>
          ))
        ) : (
          <div className="empty-state">
            <p>{t("myWork.noShifts")}</p>
          </div>
        )}
      </section>
      {shifts.filter(shift=>(swapCandidates.get(shift.id)?.length??0)>0).map(shift=><WorkflowForm key={`swap-${shift.id}`} endpoint="/api/workforce" organisationId={organisationId} workflow="request_swap" title={locale==="nl"?`Ruil dienst ${new Date(shift.starts_at).toLocaleString("nl-NL")}`:`Swap shift ${new Date(shift.starts_at).toLocaleString("en-GB")}`} submitLabel={locale==="nl"?"Ruil voorstellen":"Propose swap"} fields={[{name:"shiftId",label:"",type:"hidden",defaultValue:shift.id},{name:"candidateStaffId",label:locale==="nl"?"Geschikte collega":"Eligible colleague",type:"select",required:true,options:(swapCandidates.get(shift.id)??[]).map(candidate=>({label:candidate.full_name,value:candidate.staff_id}))},{name:"reason",label:locale==="nl"?"Reden":"Reason",type:"textarea",required:true},{name:"idempotencyKey",label:"",type:"hidden",defaultValue:crypto.randomUUID()}]}/>)}
      {swaps.filter(swap=>swap.candidate_staff_id===staff.id&&swap.state==="requested").map(swap=><section className="panel" key={swap.id}><h3>{locale==="nl"?"Ruilverzoek van collega":"Colleague swap request"}</h3><p>{swap.reason}</p><div className="split-workspace"><WorkflowForm endpoint="/api/workforce" organisationId={organisationId} workflow="respond_swap" title={locale==="nl"?"Instemmen":"Accept"} submitLabel={locale==="nl"?"Instemmen":"Accept"} fields={[{name:"swapId",label:"",type:"hidden",defaultValue:swap.id},{name:"decision",label:"",type:"hidden",defaultValue:"accept"}]}/><WorkflowForm endpoint="/api/workforce" organisationId={organisationId} workflow="respond_swap" title={locale==="nl"?"Afwijzen":"Decline"} submitLabel={locale==="nl"?"Afwijzen":"Decline"} fields={[{name:"swapId",label:"",type:"hidden",defaultValue:swap.id},{name:"decision",label:"",type:"hidden",defaultValue:"decline"}]}/></div></section>)}
      {swaps.length?<RecordPanel title={locale==="nl"?"Mijn ruilverzoeken":"My swap requests"} empty="">{swaps.map(swap=><div className="record-row" key={swap.id}><b>{authEnumLabel(locale,swap.state)}</b><span>{swap.reason??"—"}</span><em>{swap.manager_reason??""}</em></div>)}</RecordPanel>:null}
      {eligibleOffers.length?<RecordPanel title={locale==="nl"?"Geschikte open diensten":"Eligible open shifts"} empty="">{eligibleOffers.map(offer=><div className="record-row" key={offer.offer_id}><b>{offer.role_name} · {new Date(offer.starts_at).toLocaleString(authIntlLocale(locale))}</b><span>{locale==="nl"?"Je beschikbaarheid, kwalificatie, rust en uren zijn vooraf gecontroleerd.":"Your availability, qualification, rest and hours were pre-checked."}</span><WorkflowForm endpoint="/api/workforce" organisationId={organisationId} workflow="claim_open_shift" title={locale==="nl"?"Open dienst accepteren":"Accept open shift"} submitLabel={locale==="nl"?"Atomair accepteren":"Accept atomically"} fields={[{name:"offerId",label:"",type:"hidden",defaultValue:offer.offer_id},{name:"idempotencyKey",label:"",type:"hidden",defaultValue:crypto.randomUUID()}]}/></div>)}</RecordPanel>:null}
      <div className="split-workspace">
        <WorkflowForm endpoint="/api/workforce" organisationId={organisationId} workflow="request_leave" title={locale==="nl"?"Vrij vragen":"Request leave"} submitLabel={locale==="nl"?"Aanvraag indienen":"Submit request"} fields={[{name:"venueId",label:t("common.venue"),type:"select",required:true,options:venueOptions(venues)},{name:"startsAt",label:locale==="nl"?"Vanaf":"From",type:"datetime-local",required:true},{name:"endsAt",label:locale==="nl"?"Tot":"Until",type:"datetime-local",required:true},{name:"note",label:locale==="nl"?"Notitie (optioneel)":"Note (optional)",type:"textarea"}]}/>
        <WorkflowForm endpoint="/api/workforce" organisationId={organisationId} workflow="report_sickness" title={locale==="nl"?"Ziek melden":"Report sickness"} submitLabel={locale==="nl"?"Veilig melden":"Report securely"} fields={[{name:"venueId",label:t("common.venue"),type:"select",required:true,options:venueOptions(venues)},{name:"startsAt",label:locale==="nl"?"Vanaf":"From",type:"datetime-local",required:true},{name:"endsAt",label:locale==="nl"?"Geschat tot":"Expected until",type:"datetime-local",required:true},{name:"note",label:locale==="nl"?"Korte operationele notitie":"Short operational note",type:"textarea"}]}/>
      </div><RecordPanel title={locale==="nl"?"Aanvragen":"Requests"} empty={locale==="nl"?"Er zijn nog geen vrije dagen of ziekmeldingen.":"No leave or sickness requests."}>{ownAbsences.map(row=><div className="record-row" key={row.id}><b>{authEnumLabel(locale,row.absence_type)}</b><span>{date(row.starts_at,locale)}–{date(row.ends_at,locale)}</span><em>{authEnumLabel(locale,row.status)}</em></div>)}</RecordPanel>
      <div className="split-workspace">
        <RecordPanel
          title={t("myWork.availability")}
          empty={t("myWork.noAvailability")}
        >
          {availability.map((row) => (
            <div className="record-row" key={row.id}>
              <b>{authEnumLabel(locale,row.availability)}</b>
              <span>{new Date(row.starts_at).toLocaleString(authIntlLocale(locale))}</span>
              <em>
                {t("myWork.until")}{" "}
                {new Date(row.ends_at).toLocaleTimeString(authIntlLocale(locale), {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </em>
            </div>
          ))}
        </RecordPanel>
        <RecordPanel title={t("myWork.submittedHours")} empty={t("myWork.noHours")}>
          {records.map((row) => (
            <div className="record-row" key={row.id}>
              <b>{date(row.clocked_in_at,locale)}</b>
              <span>
                {authEnumLabel(locale,row.status)} · {t("myWork.break")} {row.break_minutes} min
              </span>
              <em>{row.approved_at ? t("myWork.approved") : t("myWork.pending")}</em>
            </div>
          ))}
        </RecordPanel>
      </div>
    </div>
  );
}

function Metric({
  href,
  label,
  value,
  detail,
}: {
  href: string;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Link href={href} className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail} →</small>
    </Link>
  );
}

function closeList(venues: Venue[], closes: Close[], locale:AuthLocale) {
  const t=(key:AuthMessageKey)=>authMessage(locale,key);
  return (
    <section className="panel">
      <header>
        <div>
          <h3>{t("close.listTitle")}</h3>
          <p>{t("close.listHelp")}</p>
        </div>
      </header>
      {!closes.length ? (
        <div className="empty-state">
          <h3>{t("close.emptyTitle")}</h3>
          <p>{t("close.emptyHelp")}</p>
          <Link className="primary" href="/app/close/new">
            {t("close.first")}
          </Link>
        </div>
      ) : (
        <div className="record-list">
          {closes.map((close) => (
            <Link key={close.id} href={`/app/close/${close.id}`}>
              <b>
                {close.trading_date} · v{close.version}
              </b>
              <span>
                {venues.find((v) => v.id === close.venue_id)?.name} ·{" "}
                {authEnumLabel(locale,close.status)}
              </span>
              <em>{euro(close.difference_minor,locale)} →</em>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

async function closeDetail(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organisationId: string,
  closeId: string,
  venues: Venue[],
  locale: AuthLocale,
) {
  const t=(key:AuthMessageKey)=>authMessage(locale,key);
  const [
    { data: close },
    { data: lines },
    { data: audit },
    { data: canApprove },
    { data: canReopen },
  ] = await Promise.all([
    supabase
      .from("closing_sessions")
      .select(
        "id,venue_id,trading_date,status,version,expected_total_minor,accounted_total_minor,difference_minor,reopened_reason",
      )
      .eq("organisation_id", organisationId)
      .eq("id", closeId)
      .single(),
    supabase
      .from("closing_lines")
      .select("id,line_type,expected_minor,actual_minor,metadata,created_at")
      .eq("organisation_id", organisationId)
      .eq("closing_session_id", closeId)
      .order("created_at"),
    supabase
      .from("audit_logs")
      .select("id,action,actor_id,created_at,after_summary")
      .eq("organisation_id", organisationId)
      .eq("entity_id", closeId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase.rpc("has_capability", {
      target_organisation_id: organisationId,
      target_venue_id: null,
      required_capability: "close.approve",
    }),
    supabase.rpc("has_capability", {
      target_organisation_id: organisationId,
      target_venue_id: null,
      required_capability: "close.reopen",
    }),
  ]);
  if (!close) return <HonestEmpty title={t("close.notFound")} locale={locale} />;
  const row = close as unknown as Close & { reopened_reason: string | null };
  const lineRows = (lines ?? []) as unknown as {
    id: string;
    line_type: string;
    expected_minor: string;
    actual_minor: string;
    metadata: { note?: string };
  }[];
  const expected = lineRows.reduce(
    (sum, line) => sum + BigInt(line.expected_minor),
    0n,
  );
  const actual = lineRows.reduce(
    (sum, line) => sum + BigInt(line.actual_minor),
    0n,
  );
  return (
    <div className="workflow-stack">
      <section className="detail-head">
        <div>
          <span className={`status ${row.status}`}>{authEnumLabel(locale,row.status)}</span>
          <h2>
            {row.trading_date} · {t("close.version")} {row.version}
          </h2>
          <p>
            {venues.find((v) => v.id === row.venue_id)?.name}
            {row.reopened_reason ? ` · ${t("close.reopened")}: ${row.reopened_reason}` : ""}
          </p>
        </div>
        <div className="money-summary">
          <span>
            {t("close.expected")} <b>{euro(expected,locale)}</b>
          </span>
          <span>
            {t("close.actual")} <b>{euro(actual,locale)}</b>
          </span>
          <span>
            {t("close.difference")} <b>{euro(actual - expected,locale)}</b>
          </span>
        </div>
      </section>
      <CloseWorkspace
        organisationId={organisationId}
        closeId={closeId}
        status={row.status}
        canApprove={Boolean(canApprove)}
        canReopen={Boolean(canReopen)}
      />
      <section className="panel">
        <header>
          <div>
            <h3>{t("close.amountLines")}</h3>
            <p>{t("close.amountHelp")}</p>
          </div>
        </header>
        {!lineRows.length ? (
          <div className="empty-state">
            <p>{t("close.noLines")}</p>
          </div>
        ) : (
          <div className="record-list">
            {lineRows.map((line) => (
              <div className="record-row" key={line.id}>
                <b>{authEnumLabel(locale,line.line_type)}</b>
                <span>{line.metadata.note || t("close.noNote")}</span>
                <em>
                  {euro(line.expected_minor,locale)} → {euro(line.actual_minor,locale)}
                </em>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel">
        <header>
          <div>
            <h3>{t("close.audit")}</h3>
            <p>{t("close.auditHelp")}</p>
          </div>
        </header>
        <div className="record-list">
          {(
            (audit ?? []) as unknown as {
              id: string;
              action: string;
              actor_id: string;
              created_at: string;
            }[]
          ).map((item) => (
            <div className="record-row" key={item.id}>
              <b>{authEnumLabel(locale,item.action)}</b>
              <span>{item.actor_id}</span>
              <em>{date(item.created_at,locale)}</em>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

async function bookings(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organisationId: string,
  venues: Venue[],
  locale: AuthLocale,
) {
  const t=(key:AuthMessageKey)=>authMessage(locale,key);
  const { data } = await supabase
    .from("booking_inquiries")
    .select(
      "id,venue_id,status,preferred_start,group_size,contact_name,occasion,budget_minor",
    )
    .eq("organisation_id", organisationId)
    .order("preferred_start");
  const rows = (data ?? []) as Inquiry[];
  const inquiryOptions=rows.map(row=>({label:`${row.contact_name} · ${row.group_size}`,value:row.id}));
  return (
    <div className="workflow-stack">
    <div className="split-workspace">
      <WorkflowForm
        organisationId={organisationId}
        workflow="booking_inquiry"
        title={t("bookings.new")}
        submitLabel={t("bookings.record")}
        fields={[
          {
            name: "venueId",
            label: t("common.venue"),
            type: "select",
            required: true,
            options: venueOptions(venues),
          },
          { name: "contactName", label: t("bookings.contactName"), required: true },
          {
            name: "contactEmail",
            label: t("auth.email"),
            type: "email",
            required: true,
          },
          {
            name: "preferredStart",
            label: t("bookings.preferredStart"),
            type: "datetime-local",
            required: true,
          },
          {
            name: "groupSize",
            label: t("bookings.groupSize"),
            type: "number",
            required: true,
          },
          { name: "budget", label: t("bookings.budget"), placeholder: locale==="nl"?"1500,00":"1500.00" },
          { name: "occasion", label: t("bookings.occasion") },
          {
            name: "source",
            label: t("bookings.source"),
            required: true,
            placeholder: t("bookings.sourcePlaceholder"),
          },
          {
            name: "preferences",
            label: t("bookings.preferences"),
            type: "textarea",
          },
        ]}
      />
      <RecordPanel title={t("bookings.pipeline")} empty={t("bookings.empty")}>
        {rows.map((row) => (
          <div className="record-row" key={row.id}>
            <b>
              {row.contact_name} · {row.group_size} {t("planning.guests")}
            </b>
            <span>
              {date(row.preferred_start,locale)} · {row.occasion || t("bookings.noOccasion")}{" "}
              · {authEnumLabel(locale,row.status)}
            </span>
            <em>
              {row.budget_minor ? euro(row.budget_minor,locale) : t("bookings.budgetUnknown")}
            </em>
          </div>
        ))}
      </RecordPanel>
    </div>
    {rows.length?<div className="split-workspace">
      <WorkflowForm organisationId={organisationId} workflow="booking_quote" title={locale==="nl"?"Offerte vastleggen":"Record quote"} submitLabel={locale==="nl"?"Offerte goedkeuren":"Approve quote"} fields={[
        {name:"inquiryId",label:locale==="nl"?"Aanvraag":"Inquiry",type:"select",required:true,options:inquiryOptions},
        {name:"subtotal",label:locale==="nl"?"Subtotaal":"Subtotal",required:true},{name:"vatBasisPoints",label:"VAT",type:"select",required:true,options:[{label:"21%",value:"2100"},{label:"9%",value:"900"}]},{name:"deposit",label:locale==="nl"?"Aanbetaling":"Deposit",required:true},{name:"expiresAt",label:locale==="nl"?"Geldig tot":"Expires",type:"datetime-local",required:true}
      ]}/>
      <WorkflowForm organisationId={organisationId} workflow="booking_transition" title={locale==="nl"?"Boeking verder brengen":"Advance booking"} submitLabel={locale==="nl"?"Fase opslaan":"Save stage"} fields={[
        {name:"inquiryId",label:locale==="nl"?"Aanvraag":"Inquiry",type:"select",required:true,options:inquiryOptions},{name:"status",label:locale==="nl"?"Nieuwe fase":"New stage",type:"select",required:true,options:["qualified","proposal","awaiting_deposit","confirmed","completed","lost","cancelled","expired"].map(value=>({label:authEnumLabel(locale,value),value}))},{name:"reason",label:locale==="nl"?"Reden":"Reason",type:"textarea",required:true}
      ]}/>
    </div>:null}
    </div>
  );
}

async function productsAndRecipes(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organisationId: string,
  venues: Venue[],
  locale: AuthLocale,
) {
  const t=(key:AuthMessageKey)=>authMessage(locale,key);
  const [
    { data: supplierData },
    { data: productData },
    { data: costData },
    { data: itemData },
    { data: priceData },
  ] = await Promise.all([
    supabase
      .from("suppliers")
      .select("id,name")
      .eq("organisation_id", organisationId)
      .order("name"),
    supabase
      .from("products")
      .select(
        "id,name,brand,category,sku,package_quantity,purchase_unit,serving_unit,supplier_id",
      )
      .eq("organisation_id", organisationId)
      .order("name"),
    supabase
      .from("product_cost_history")
      .select("product_id,net_cost_minor,vat_basis_points,effective_at")
      .eq("organisation_id", organisationId)
      .order("effective_at", { ascending: false }),
    supabase
      .from("menu_items")
      .select("id,venue_id,name,category,target_margin_basis_points")
      .eq("organisation_id", organisationId)
      .order("name"),
    supabase
      .from("menu_price_history")
      .select(
        "menu_item_id,gross_price_minor,direct_cost_snapshot_minor,margin_snapshot_basis_points,effective_at",
      )
      .eq("organisation_id", organisationId)
      .order("effective_at", { ascending: false }),
  ]);
  const suppliers = (supplierData ?? []) as unknown as {
    id: string;
    name: string;
  }[];
  const products = (productData ?? []) as unknown as {
    id: string;
    name: string;
    brand: string | null;
    category: string;
    sku: string | null;
    package_quantity: string;
    purchase_unit: string;
    serving_unit: string;
    supplier_id: string | null;
  }[];
  const costs = (costData ?? []) as unknown as {
    product_id: string;
    net_cost_minor: string;
    vat_basis_points: number;
    effective_at: string;
  }[];
  const items = (itemData ?? []) as unknown as {
    id: string;
    venue_id: string | null;
    name: string;
    category: string;
    target_margin_basis_points: number;
  }[];
  const prices = (priceData ?? []) as unknown as {
    menu_item_id: string;
    gross_price_minor: string;
    direct_cost_snapshot_minor: string;
    margin_snapshot_basis_points: number;
    effective_at: string;
  }[];
  const supplierOptions = [
    { label: t("products.noPreferredSupplier"), value: "" },
    ...suppliers.map((row) => ({ label: row.name, value: row.id })),
  ];
  const productOptions = products.map((row) => ({
    label: `${row.name} · ${row.serving_unit}`,
    value: row.id,
  }));
  return (
    <div className="workflow-stack">
      <section className="connected-flow">
        <span>{t("products.supplier")}</span>
        <b>→</b>
        <span>{t("products.productPrice")}</span>
        <b>→</b>
        <span>{t("products.recipeCost")}</span>
        <b>→</b>
        <span>{t("products.menuPrice")}</span>
        <b>→</b>
        <span>{t("products.marginSnapshot")}</span>
      </section>
      <div className="split-workspace">
        <WorkflowForm
          organisationId={organisationId}
          workflow="product"
          title={t("products.currentCost")}
          submitLabel={t("products.save")}
          fields={[
            {
              name: "supplierId",
              label: t("products.preferredSupplier"),
              type: "select",
              options: supplierOptions,
            },
            { name: "name", label: t("products.name"), required: true },
            { name: "brand", label: t("products.brand") },
            { name: "category", label: t("products.category"), required: true },
            { name: "sku", label: t("products.sku") },
            { name: "barcode", label: t("products.barcode") },
            {
              name: "packageQuantity",
              label: t("products.packageQuantity"),
              type: "number",
              required: true,
            },
            {
              name: "unitVolumeMl",
              label: t("products.volume"),
              type: "number",
            },
            {
              name: "purchaseUnit",
              label: t("products.purchaseUnit"),
              required: true,
              placeholder: t("products.purchaseUnitPlaceholder"),
            },
            {
              name: "servingUnit",
              label: t("products.servingUnit"),
              required: true,
              placeholder: t("products.servingUnitPlaceholder"),
            },
            { name: "netCost", label: t("products.netCost"), required: true },
            {
              name: "vatBasisPoints",
              label: t("products.vat"),
              type: "select",
              required: true,
              options: [
                { label: "9%", value: "900" },
                { label: "21%", value: "2100" },
                { label: "0%", value: "0" },
              ],
            },
            { name: "deposit", label: t("products.deposit"), placeholder: locale==="nl"?"0,00":"0.00" },
          ]}
        />
        <RecordPanel
          title={t("products.master")}
          empty={t("products.masterEmpty")}
        >
          {products.map((row) => {
            const cost = costs.find((c) => c.product_id === row.id);
            return (
              <div className="record-row" key={row.id}>
                <b>
                  {row.name}
                  {row.brand ? ` · ${row.brand}` : ""}
                </b>
                <span>
                  {row.category} · {row.package_quantity} {row.serving_unit} {t("products.per")}{" "}
                  {row.purchase_unit}
                  <small>
                    {row.sku || t("products.noSku")} ·{" "}
                    {suppliers.find((s) => s.id === row.supplier_id)?.name ||
                      t("products.noPreferredSupplier")}
                  </small>
                </span>
                <em>
                  {cost ? euro(cost.net_cost_minor,locale) : t("products.priceMissing")}
                  <small>
                    {cost
                      ? `${cost.vat_basis_points / 100}% ${t("products.vat")} · ${date(cost.effective_at,locale)}`
                      : ""}
                  </small>
                </em>
              </div>
            );
          })}
        </RecordPanel>
      </div>
      {products.length ? (
        <div className="split-workspace">
          <WorkflowForm
            organisationId={organisationId}
            workflow="menu_item"
            title={t("products.menuItemRecipe")}
            submitLabel={t("products.saveRecipe")}
            fields={[
              {
                name: "venueId",
                label: t("common.venue"),
                type: "select",
                required: true,
                options: venueOptions(venues),
              },
              { name: "name", label: t("products.menuItem"), required: true },
              { name: "category", label: t("products.category"), required: true },
              {
                name: "productId",
                label: t("products.component"),
                type: "select",
                required: true,
                options: productOptions,
              },
              {
                name: "quantity",
                label: t("products.recipeQuantity"),
                type: "number",
                required: true,
              },
              {
                name: "unit",
                label: t("products.exactUnit"),
                required: true,
              },
              {
                name: "wasteBasisPoints",
                label: t("products.waste"),
                type: "number",
                required: true,
              },
              {
                name: "grossPrice",
                label: t("products.grossPrice"),
                required: true,
              },
              {
                name: "vatBasisPoints",
                label: t("products.vat"),
                type: "select",
                required: true,
                options: [
                  { label: "9%", value: "900" },
                  { label: "21%", value: "2100" },
                ],
              },
              {
                name: "targetMarginBasisPoints",
                label: t("products.targetMargin"),
                type: "number",
                required: true,
              },
            ]}
          />
          <RecordPanel
            title={t("products.prices")}
            empty={t("products.noMenuItems")}
          >
            {items.map((row) => {
              const price = prices.find((p) => p.menu_item_id === row.id);
              return (
                <div className="record-row" key={row.id}>
                  <b>
                    {row.name} · {row.category}
                  </b>
                  <span>
                    {venues.find((v) => v.id === row.venue_id)?.name ||
                      t("products.allVenues")}
                    <small>
                      {t("products.margin")} {row.target_margin_basis_points / 100}%
                    </small>
                  </span>
                  <em>
                    {price ? euro(price.gross_price_minor,locale) : t("products.priceMissing")}
                    <small>
                      {price
                        ? `${t("products.cost")} ${euro(price.direct_cost_snapshot_minor,locale)} · ${t("products.actualMargin")} ${price.margin_snapshot_basis_points / 100}%`
                        : ""}
                    </small>
                  </em>
                </div>
              );
            })}
          </RecordPanel>
        </div>
      ) : (
        <div className="legal-note">
          {t("products.createFirst")}
        </div>
      )}
    </div>
  );
}

async function suppliers(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organisationId: string,
  locale: AuthLocale,
) {
  const t=(key:AuthMessageKey)=>authMessage(locale,key);
  const [{ data: supplierData }, { data: contracts }, { data: discrepancies }] =
    await Promise.all([
      supabase
        .from("suppliers")
        .select("id,name,email")
        .eq("organisation_id", organisationId)
        .order("name"),
      supabase
        .from("supplier_contracts")
        .select("id,name,status,start_date,end_date,notice_deadline")
        .eq("organisation_id", organisationId)
        .order("notice_deadline"),
      supabase
        .from("contract_discrepancies")
        .select(
          "id,discrepancy_type,status,financial_impact_minor,recommended_check",
        )
        .eq("organisation_id", organisationId)
        .order("created_at", { ascending: false }),
    ]);
  const rows = (supplierData ?? []) as Supplier[];
  const contractRows=(contracts??[]) as unknown as {id:string;name:string;status:string;notice_deadline:string|null}[];
  const discrepancyRows=(discrepancies??[]) as unknown as {id:string;discrepancy_type:string;status:string;financial_impact_minor:string;recommended_check:string}[];
  return (
    <div className="workflow-stack">
      <div className="split-workspace">
        <WorkflowForm
          organisationId={organisationId}
          workflow="supplier"
          title={t("suppliers.add")}
          submitLabel={t("suppliers.save")}
          fields={[
            { name: "name", label: t("suppliers.name"), required: true },
            { name: "contactEmail", label: t("suppliers.contactEmail"), type: "email" },
          ]}
        />
        <RecordPanel title={t("suppliers.title")} empty={t("suppliers.empty")}>
          {rows.map((row) => (
            <div className="record-row" key={row.id}>
              <b>{row.name}</b>
              <span>{row.email || t("suppliers.noEmail")}</span>
              <em>{t("suppliers.profile")} →</em>
            </div>
          ))}
        </RecordPanel>
      </div>
      {rows.length?<div className="split-workspace">
        <WorkflowForm organisationId={organisationId} workflow="supplier_contract" title={locale==="nl"?"Contract toevoegen":"Add contract"} submitLabel={locale==="nl"?"Contract opslaan":"Save contract"} fields={[
          {name:"supplierId",label:locale==="nl"?"leverancier":"Supplier",type:"select",required:true,options:rows.map(row=>({label:row.name,value:row.id}))},{name:"venueId",label:locale==="nl"?"vestiging (optioneel)":"Venue (optional)",type:"select",options:[{label:locale==="nl"?"Alle vestigingen":"All venues",value:""}]},{name:"name",label:locale==="nl"?"Contractnaam":"Contract name",required:true},{name:"startDate",label:locale==="nl"?"Startdatum":"Start date",type:"date",required:true},{name:"endDate",label:locale==="nl"?"Einddatum":"End date",type:"date"},{name:"noticeDeadline",label:locale==="nl"?"Opzegdeadline":"Notice deadline",type:"date"},{name:"automaticRenewal",label:locale==="nl"?"Automatische verlenging":"Automatic renewal",type:"select",required:true,options:[{label:locale==="nl"?"Nee":"No",value:"false"},{label:locale==="nl"?"Ja":"Yes",value:"true"}]},{name:"terms",label:locale==="nl"?"Kernvoorwaarden":"Core terms",type:"textarea",required:true}
        ]}/>
        {contractRows.length?<WorkflowForm organisationId={organisationId} workflow="contract_transition" title={locale==="nl"?"Contractstatus":"Contract status"} submitLabel={locale==="nl"?"Status opslaan":"Save status"} fields={[{name:"contractId",label:"Contract",type:"select",required:true,options:contractRows.map(row=>({label:row.name,value:row.id}))},{name:"status",label:locale==="nl"?"Nieuwe status":"New status",type:"select",required:true,options:["active","notice_due","renewing","terminated","expired"].map(value=>({label:authEnumLabel(locale,value),value}))},{name:"reason",label:locale==="nl"?"Reden":"Reason",type:"textarea",required:true}]}/>:null}
      </div>:null}
      <RecordPanel
        title={t("suppliers.contracts")}
        empty={t("suppliers.contractsEmpty")}
      >
        {(
          contractRows as unknown as {
            id: string;
            name: string;
            status: string;
            notice_deadline: string | null;
          }[]
        ).map((row) => (
          <div className="record-row" key={row.id}>
            <b>{row.name}</b>
            <span>{authEnumLabel(locale,row.status)}</span>
            <em>
              {row.notice_deadline
                ? `${t("suppliers.noticeDeadline")} ${date(row.notice_deadline,locale)}`
                : t("suppliers.noDeadline")}
            </em>
          </div>
        ))}
        {(
          discrepancyRows as unknown as {
            id: string;
            discrepancy_type: string;
            status: string;
            financial_impact_minor: string;
            recommended_check: string;
          }[]
        ).map((row) => (
          <div className="record-row" key={row.id}>
            <b>{t("suppliers.neutralVariance")}: {authEnumLabel(locale,row.discrepancy_type)}</b>
            <span>{row.recommended_check}</span>
            <em>
              {euro(row.financial_impact_minor,locale)} · {authEnumLabel(locale,row.status)}
            </em>
          </div>
        ))}
      </RecordPanel>
      {discrepancyRows.length?<WorkflowForm organisationId={organisationId} workflow="discrepancy_resolution" title={locale==="nl"?"Afwijking beoordelen":"Resolve discrepancy"} submitLabel={locale==="nl"?"Besluit opslaan":"Save decision"} fields={[{name:"discrepancyId",label:locale==="nl"?"Afwijking":"Discrepancy",type:"select",required:true,options:discrepancyRows.map(row=>({label:`${row.discrepancy_type} · ${euro(row.financial_impact_minor,locale)}`,value:row.id}))},{name:"status",label:"Status",type:"select",required:true,options:["reviewing","accepted","disputed","resolved","dismissed"].map(value=>({label:authEnumLabel(locale,value),value}))},{name:"resolution",label:locale==="nl"?"Onderbouwd besluit":"Supported decision",type:"textarea",required:true},{name:"creditReceived",label:locale==="nl"?"Ontvangen credit":"Credit received"},{name:"verifiedRecovered",label:locale==="nl"?"Geverifieerd teruggewonnen":"Verified recovered"}]}/>:null}
    </div>
  );
}

async function eventYield(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organisationId: string,
  venues: Venue[],
  locale: AuthLocale,
) {
  const t=(key:AuthMessageKey)=>authMessage(locale,key);
  const [{ data: scenarioData }, { data: eventData }] = await Promise.all([
    supabase
      .from("event_yield_scenarios")
      .select(
        "id,venue_id,event_id,scenario,revenue_low_minor,contribution_minor,break_even_revenue_minor,missing_data,created_at",
      )
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false }),
    supabase
      .from("events")
      .select("id,name,starts_at")
      .eq("organisation_id", organisationId),
  ]);
  const rows = (scenarioData ?? []) as unknown as Scenario[];
  const events = (eventData ?? []) as EventRow[];
  return (
    <div className="workflow-stack"><div className="split-workspace">
      <WorkflowForm
        organisationId={organisationId}
        workflow="event_yield"
        title={t("yield.baseScenario")}
        submitLabel={t("yield.calculate")}
        fields={[
          {
            name: "venueId",
            label: t("common.venue"),
            type: "select",
            required: true,
            options: venueOptions(venues),
          },
          { name: "name", label: t("yield.eventName"), required: true },
          {
            name: "startsAt",
            label: t("planning.start"),
            type: "datetime-local",
            required: true,
          },
          {
            name: "attendance",
            label: t("yield.attendance"),
            type: "number",
            required: true,
          },
          { name: "ticketRevenue", label: t("yield.ticketRevenue"), required: true },
          { name: "barRevenue", label: t("yield.barRevenue"), required: true },
          { name: "staffing", label: t("yield.staffing"), required: true },
          { name: "security", label: t("yield.security"), required: true },
          { name: "entertainment", label: t("yield.entertainment"), required: true },
          { name: "stock", label: t("yield.stock"), required: true },
          { name: "otherCosts", label: t("yield.otherCosts"), required: true },
        ]}
      />
      <RecordPanel title={t("yield.scenarios")} empty={t("yield.empty")}>
        {rows.map((row) => (
          <div className="record-row" key={row.id}>
            <b>
              {events.find((event) => event.id === row.event_id)?.name ||
                t("yield.event")}{" "}
              · {row.scenario}
            </b>
            <span>
              {t("yield.revenue")} {euro(row.revenue_low_minor,locale)} · break-even{" "}
              {euro(row.break_even_revenue_minor,locale)}
            </span>
            <em>
              {t("yield.contribution")} {euro(row.contribution_minor,locale)}
              <small>{t("yield.deterministic")}</small>
            </em>
          </div>
        ))}
      </RecordPanel>
    </div>{rows.length?<WorkflowForm organisationId={organisationId} workflow="event_outcome" title={locale==="nl"?"werkelijk resultaat":"Actual outcome"} submitLabel={locale==="nl"?"Resultaat vergelijken":"Compare outcome"} fields={[{name:"scenarioId",label:"Scenario",type:"select",required:true,options:rows.map(row=>({label:`${events.find(event=>event.id===row.event_id)?.name??"Event"} · ${row.scenario}`,value:row.id}))},{name:"actualAttendance",label:locale==="nl"?"werkelijke bezoekers":"Actual attendance",type:"number",required:true},{name:"actualRevenue",label:locale==="nl"?"werkelijke omzet":"Actual revenue",required:true},{name:"actualContribution",label:locale==="nl"?"werkelijke bijdrage":"Actual contribution",required:true}]}/>:null}</div>
  );
}

async function compliance(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  organisationId: string,
  venues: Venue[],
  locale: AuthLocale,
) {
  const t=(key:AuthMessageKey)=>authMessage(locale,key);
  const [{ data: staffData }, { data: incidentData }] = await Promise.all([
    supabase
      .from("staff_profiles")
      .select("id,full_name,role_name,onboarding_status,preferred_language")
      .eq("organisation_id", organisationId)
      .order("full_name"),
    supabase
      .from("staff_incidents")
      .select("id,venue_id,occurred_at,category,status,factual_record")
      .eq("organisation_id", organisationId)
      .order("occurred_at", { ascending: false }),
  ]);
  const staff = (staffData ?? []) as Staff[];
  const incidents = (incidentData ?? []) as unknown as IncidentRow[];
  return (
    <div className="workflow-stack">
      <div className="legal-note">{t("compliance.notice")}</div>
      <div className="split-workspace">
        <WorkflowForm
          organisationId={organisationId}
          workflow="staff_profile"
          title={t("compliance.limitedProfile")}
          submitLabel={t("compliance.createProfile")}
          fields={[
            { name: "fullName", label: t("compliance.fullName"), required: true },
            { name: "contactEmail", label: t("auth.email"), type: "email" },
            { name: "roleName", label: t("compliance.role"), required: true },
            { name: "engagementType", label: t("compliance.engagement"), required: true },
            {
              name: "preferredLanguage",
              label: t("compliance.preferredLanguage"),
              type: "select",
              required: true,
              options: [
                { label: t("language.nl"), value: "nl" },
                { label: t("language.en"), value: "en" },
              ],
            },
            {
              name: "startDate",
              label: t("compliance.startDate"),
              type: "date",
              required: true,
            },
          ]}
        />
        <RecordPanel
          title={t("compliance.onboarding")}
          empty={t("compliance.noProfiles")}
        >
          {staff.map((row) => (
            <div className="record-row" key={row.id}>
              <b>{row.full_name}</b>
              <span>
                {row.role_name} · {row.preferred_language.toUpperCase()}
              </span>
              <em>{authEnumLabel(locale,row.onboarding_status)}</em>
            </div>
          ))}
        </RecordPanel>
      </div>
      {staff.length?<WorkflowForm organisationId={organisationId} workflow="staff_transition" title={locale==="nl"?"Onboardingbesluit":"Onboarding decision"} submitLabel={locale==="nl"?"Status opslaan":"Save status"} fields={[{name:"staffId",label:locale==="nl"?"medewerker":"Employee",type:"select",required:true,options:staff.map(row=>({label:row.full_name,value:row.id}))},{name:"status",label:"Status",type:"select",required:true,options:["in_progress","review_required","cleared","expired","suspended","rejected"].map(value=>({label:authEnumLabel(locale,value),value}))},{name:"reason",label:locale==="nl"?"Reden":"Reason",type:"textarea",required:true}]}/>:null}
      <div className="split-workspace">
        <WorkflowForm
          organisationId={organisationId}
          workflow="incident"
          title={t("compliance.recordIncident")}
          submitLabel={t("compliance.saveIncident")}
          fields={[
            {
              name: "venueId",
              label: t("common.venue"),
              type: "select",
              required: true,
              options: venueOptions(venues),
            },
            {
              name: "occurredAt",
              label: t("compliance.occurredAt"),
              type: "datetime-local",
              required: true,
            },
            { name: "category", label: t("products.category"), required: true },
            {
              name: "factualRecord",
              label: t("compliance.factualRecord"),
              type: "textarea",
              required: true,
            },
            { name: "witnesses", label: t("compliance.witnesses"), type: "textarea" },
            { name: "actions", label: t("compliance.actions"), type: "textarea" },
          ]}
        />
        <RecordPanel
          title={t("compliance.incidents")}
          empty={t("compliance.noIncidents")}
        >
          {incidents.map((row) => (
            <div className="record-row" key={row.id}>
              <b>
                {row.category} · {date(row.occurred_at,locale)}
              </b>
              <span>{row.factual_record}</span>
              <em>{authEnumLabel(locale,row.status)}</em>
            </div>
          ))}
        </RecordPanel>
      </div>
      {incidents.some(row=>row.status==="draft")?<WorkflowForm organisationId={organisationId} workflow="incident_finalize" title={locale==="nl"?"incident definitief maken":"Finalize incident"} submitLabel={locale==="nl"?"Definitief vastleggen":"Finalize record"} fields={[{name:"incidentId",label:"incident",type:"select",required:true,options:incidents.filter(row=>row.status==="draft").map(row=>({label:`${row.category} · ${date(row.occurred_at,locale)}`,value:row.id}))},{name:"reason",label:locale==="nl"?"Reden voor finaliseren":"Reason for finalization",type:"textarea",required:true}]}/>:null}
    </div>
  );
}

function integrations(locale:AuthLocale) {
  const t=(key:AuthMessageKey)=>authMessage(locale,key);
  const configured = (name: string) => Boolean(process.env[name]);
  const rows = [
    [
      t("integrations.supabase"),
      configured("NEXT_PUBLIC_SUPABASE_URL") &&
        configured("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
      t("integrations.supabaseHelp"),
    ],
    [
      t("integrations.stripe"),
      configured("STRIPE_SECRET_KEY") && configured("STRIPE_WEBHOOK_SECRET"),
      t("integrations.stripeHelp"),
    ],
    [
      t("integrations.openai"),
      configured("OPENAI_API_KEY"),
      t("integrations.openaiHelp"),
    ],
    [
      t("integrations.email"),
      configured("RESEND_API_KEY"),
      t("integrations.emailHelp"),
    ],
    [
      t("integrations.cron"),
      configured("CRON_SECRET"),
      t("integrations.cronHelp"),
    ],
    [t("integrations.csv"), true, t("integrations.csvHelp")],
  ];
  return (
    <section className="panel">
      <div className="record-list">
        {rows.map(([label, ok, detail]) => (
          <div className="record-row" key={String(label)}>
            <b>{label}</b>
            <span>{detail}</span>
            <em className={ok ? "ok" : "warn"}>
              {ok ? t("integrations.configured") : t("integrations.required")}
            </em>
          </div>
        ))}
      </div>
    </section>
  );
}

function RecordPanel({
  title,
  empty,
  children,
}: {
  title: string;
  empty: string;
  children: React.ReactNode;
}) {
  const list = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(list) && list.length === 0;
  return (
    <section className="panel record-panel">
      <header>
        <div>
          <h3>{title}</h3>
        </div>
      </header>
      {isEmpty ? (
        <div className="empty-state">
          <p>{empty}</p>
        </div>
      ) : (
        <div className="record-list">{list}</div>
      )}
    </section>
  );
}
function HonestEmpty({ title,locale }: { title: string;locale:AuthLocale }) {
  const t=(key:AuthMessageKey)=>authMessage(locale,key);
  return (
    <section className="panel">
      <div className="empty-state">
        <h2>{title}</h2>
        <p>{t("empty.unavailable")}</p>
      </div>
    </section>
  );
}
