"use client";
import { useState } from "react";
import { useAuthLocale } from "./auth-locale";
import { authEnumLabel } from "../lib/i18n/authenticated";
type Venue = { id: string; name: string };
type Run = {
  id: string;
  venue_id: string;
  trading_date: string;
  version: number;
  status: string;
  input_hash: string;
  data_completeness_basis_points: number;
  created_at: string;
};
type Check = {
  id: string;
  reconciliation_id: string;
  classification: string;
  title_nl: string;
  title_en: string;
  why_it_matters_nl: string;
  why_it_matters_en: string;
  financial_exposure_minor: string | null;
  resolution_path: string;
};
type Summary = {
  reconciliation_id: string;
  expected_gross_revenue_minor: string;
  recorded_gross_revenue_minor: string;
  revenue_variance_minor: string;
  beverage_cost_variance_minor: string;
  margin_impact_minor: string;
  result_hash: string;
};
type ProductResult = {
  reconciliation_id: string;
  product_id: string;
  location_id: string;
  actual_consumption: string;
  theoretical_consumption: string;
  variance_quantity: string;
  cost_variance_minor: string | null;
  evidence_confidence: string;
};
type ExceptionRow = {
  id: string;
  reconciliation_id: string;
  venue_id: string;
  exception_type: string;
  status: string;
  severity: string;
  financial_impact_minor: string | null;
  factual_description: string;
  suggested_actions: string[];
};
export function ReconciliationWorkspace({
  organisationId,
  venues,
  runs,
  checks,
  summaries,
  productResults,
  exceptions,
  productNames,
  locationNames,
}: {
  organisationId: string;
  venues: Venue[];
  runs: Run[];
  checks: Check[];
  summaries: Summary[];
  productResults: ProductResult[];
  exceptions: ExceptionRow[];
  productNames: Record<string, string>;
  locationNames: Record<string, string>;
}) {
  const { t, intlLocale, locale } = useAuthLocale();
  const [venueId, setVenueId] = useState(venues[0]?.id ?? ""),
    [tradingDate, setTradingDate] = useState(
      new Date().toISOString().slice(0, 10),
    ),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const active =
      runs.find(
        (run) => run.venue_id === venueId && run.trading_date === tradingDate,
      ) ?? runs[0],
    activeChecks = active
      ? checks.filter((check) => check.reconciliation_id === active.id)
      : [],
    summary = active
      ? summaries.find((row) => row.reconciliation_id === active.id)
      : null,
    results = active
      ? productResults.filter((row) => row.reconciliation_id === active.id)
      : [],
    activeExceptions = active
      ? exceptions.filter((row) => row.reconciliation_id === active.id)
      : [];
  async function generate() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/reconciliation", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organisationId, venueId, tradingDate }),
      });
      (await response.json()) as { errorCode?: string };
      if (!response.ok) throw new Error(t("recon.failed"));
      location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("recon.failed"));
      setBusy(false);
    }
  }
  async function prepareClose() {
    if (!active) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/reconciliation/close", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            organisationId,
            venueId: active.venue_id,
            tradingDate: active.trading_date,
            reconciliationId: active.id,
          }),
        }),
        payload = (await response.json()) as {
          errorCode?: string;
          close?: { id?: string };
        };
      if (!response.ok || !payload.close?.id)
        throw new Error(t("recon.precloseFailed"));
      location.assign(`/app/close/${payload.close.id}`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t("recon.precloseFailed"),
      );
      setBusy(false);
    }
  }
  const euro = (minor: string | null) =>
    minor === null
      ? t("common.notCalculated")
      : new Intl.NumberFormat(intlLocale, {
          style: "currency",
          currency: "EUR",
        }).format(Number(BigInt(minor)) / 100);
  const unresolvedMaterial = activeExceptions.some(
    (row) =>
      ["material", "critical"].includes(row.severity) &&
      !["resolved", "dismissed"].includes(row.status),
  );
  return (
    <div className="workflow-stack">
      <section
        className="panel readiness"
        aria-labelledby="reconciliation-title"
      >
        <header>
          <div>
            <h3 id="reconciliation-title">{t("recon.title")}</h3>
            <p>{t("recon.help")}</p>
          </div>
        </header>
        <div className="count-context">
          <label>
            {t("common.venue")}
            <select
              value={venueId}
              onChange={(event) => setVenueId(event.target.value)}
            >
              {venues.map((venue) => (
                <option key={venue.id} value={venue.id}>
                  {venue.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("common.serviceDate")}
            <input
              type="date"
              value={tradingDate}
              onChange={(event) => setTradingDate(event.target.value)}
            />
          </label>
          <button
            className="primary"
            disabled={busy || !venueId}
            aria-busy={busy}
            onClick={() => void generate()}
          >
            {busy ? t("recon.checking") : t("recon.check")}
          </button>
        </div>
        {message ? (
          <p className="import-message" role="status" aria-live="polite">
            {message}
          </p>
        ) : null}
      </section>
      {active ? (
        <>
          <section className="panel">
            <header>
              <div>
                <h3>
                  {t("recon.version")} {active.version} · {authEnumLabel(locale, active.status)}
                </h3>
                <p>
                  {t("recon.completeness")}{" "}
                  {active.data_completeness_basis_points / 100}% ·{" "}
                  {t("recon.inputHash")} {active.input_hash.slice(0, 12)}…
                </p>
              </div>
            </header>
            {activeChecks.length ? (
              <div className="readiness-list">
                {activeChecks.map((check) => (
                  <a
                    href={check.resolution_path}
                    className={`readiness-row ${check.classification}`}
                    key={check.id}
                  >
                    <div>
                      <b>{locale === "nl" ? check.title_nl : check.title_en}</b>
                      <span>
                        {locale === "nl"
                          ? check.why_it_matters_nl
                          : check.why_it_matters_en}
                      </span>
                    </div>
                    <em>
                      {euro(check.financial_exposure_minor)} ·{" "}
                      {t("recon.resolve")} →
                    </em>
                  </a>
                ))}
              </div>
            ) : summary ? (
              <>
                <div className="reconciliation-summary">
                  <div>
                    <span>{t("recon.expectedGross")}</span>
                    <b>{euro(summary.expected_gross_revenue_minor)}</b>
                  </div>
                  <div>
                    <span>{t("recon.recordedGross")}</span>
                    <b>{euro(summary.recorded_gross_revenue_minor)}</b>
                  </div>
                  <div>
                    <span>{t("recon.revenueVariance")}</span>
                    <b>{euro(summary.revenue_variance_minor)}</b>
                  </div>
                  <div>
                    <span>{t("recon.beverageVariance")}</span>
                    <b>{euro(summary.beverage_cost_variance_minor)}</b>
                  </div>
                  <div>
                    <span>{t("recon.marginImpact")}</span>
                    <b>{euro(summary.margin_impact_minor)}</b>
                  </div>
                </div>
                <div className="preclose-action">
                  <div>
                    <b>
                      {unresolvedMaterial
                        ? t("recon.materialMissing")
                        : t("recon.ready")}
                    </b>
                    <span>
                      {unresolvedMaterial
                        ? t("recon.resolveFirst")
                        : t("recon.frozenEvidence")}
                    </span>
                  </div>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      unresolvedMaterial ||
                      active.status !== "calculated"
                    }
                    onClick={() => void prepareClose()}
                  >
                    {t("recon.prepare")}
                  </button>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <h3>{t("recon.inputReady")}</h3>
                <p>{t("recon.rerun")}</p>
              </div>
            )}
          </section>
          {activeExceptions.length ? (
            <section className="panel">
              <header>
                <div>
                  <h3>{t("recon.decisions")}</h3>
                  <p>{t("recon.decisionsHelp")}</p>
                </div>
              </header>
              <div className="exception-list">
                {activeExceptions.map((row) => (
                  <ExceptionDecision
                    key={row.id}
                    organisationId={organisationId}
                    row={row}
                  />
                ))}
              </div>
            </section>
          ) : null}
          {results.length ? (
            <section className="panel">
              <header>
                <div>
                  <h3>{t("recon.productVariance")}</h3>
                  <p>{t("recon.productVarianceHelp")}</p>
                </div>
              </header>
              <div className="record-list">
                {results
                  .sort(
                    (a, b) =>
                      Math.abs(Number(BigInt(b.cost_variance_minor ?? "0"))) -
                      Math.abs(Number(BigInt(a.cost_variance_minor ?? "0"))),
                  )
                  .map((row) => (
                    <div
                      className="record-row"
                      key={`${row.location_id}:${row.product_id}`}
                    >
                      <b>
                        {productNames[row.product_id] ?? "Product"}
                        <small>
                          {locationNames[row.location_id] ??
                            t("common.location")}
                        </small>
                      </b>
                      <span>
                        {t("recon.actual")} {row.actual_consumption} ·{" "}
                        {t("recon.theoretical")} {row.theoretical_consumption} ·{" "}
                        {t("recon.variance")} {row.variance_quantity}
                      </span>
                      <em>
                        {euro(row.cost_variance_minor)}
                        <small>
                          {row.evidence_confidence} {t("recon.evidence")}
                        </small>
                      </em>
                    </div>
                  ))}
              </div>
            </section>
          ) : null}
        </>
      ) : (
        <section className="panel">
          <div className="empty-state">
            <h3>{t("recon.noCheck")}</h3>
            <p>{t("recon.noCheckHelp")}</p>
          </div>
        </section>
      )}
    </div>
  );
}

function ExceptionDecision({
  organisationId,
  row,
}: {
  organisationId: string;
  row: ExceptionRow;
}) {
  const { t, locale } = useAuthLocale();
  const [action, setAction] = useState(
      row.suggested_actions[0] ?? "investigate",
    ),
    [reason, setReason] = useState(""),
    [pending, setPending] = useState(false),
    [status, setStatus] = useState(row.status),
    [error, setError] = useState("");
  async function submit() {
    setPending(true);
    setError("");
    const response = await fetch("/api/reconciliation/exceptions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        organisationId,
        venueId: row.venue_id,
        exceptionId: row.id,
        action,
        reason,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    (await response.json()) as { errorCode?: string };
    setPending(false);
    if (!response.ok) {
      setError(t("recon.decisionFailed"));
      return;
    }
    setStatus(
      action === "resolve" || action === "accept_within_tolerance"
        ? "resolved"
        : "in_review",
    );
    setReason("");
  }
  return (
    <article>
      <div>
        <span>
          {authEnumLabel(locale, row.severity)} · {authEnumLabel(locale, row.exception_type)}
        </span>
        <b>{row.factual_description}</b>
        <small>
          {t("recon.impact")}{" "}
          {row.financial_impact_minor ?? t("common.notCalculated")} ·{" "}
          {t("common.status")} {authEnumLabel(locale, status)}
        </small>
      </div>
      <select
        value={action}
        onChange={(event) => setAction(event.target.value)}
      >
        {row.suggested_actions.map((value) => (
          <option value={value} key={value}>
            {authEnumLabel(locale, value)}
          </option>
        ))}
      </select>
      <input
        aria-label={t("recon.reason")}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={t("recon.reasonPlaceholder")}
      />
      <button
        disabled={pending || reason.trim().length < 5}
        aria-busy={pending}
        onClick={() => void submit()}
      >
        {t("recon.recordDecision")}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </article>
  );
}
