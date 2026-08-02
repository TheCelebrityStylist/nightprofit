"use client";
import { useMemo, useState } from "react";
import { useAuthLocale } from "./auth-locale";
import { parseLocaleNumber } from "../lib/imports/locale-number";
import { authEnumLabel } from "../lib/i18n/authenticated";
type Venue = { id: string; name: string };
type Location = { id: string; venue_id: string; name: string };
type Product = {
  id: string;
  name: string;
  category: string;
  package_quantity: string;
};
type Count = {
  id: string;
  trading_date: string;
  count_type: string;
  status: string;
  location_id: string;
};
type Movement = {
  id: string;
  venue_id: string;
  location_id: string;
  product_id: string;
  trading_date: string;
  movement_type: string;
  quantity: string;
};
export function InventoryCountWorkspace({
  organisationId,
  venues,
  locations,
  products,
  counts,
  movements,
}: {
  organisationId: string;
  venues: Venue[];
  locations: Location[];
  products: Product[];
  counts: Count[];
  movements: Movement[];
}) {
  const { t, locale } = useAuthLocale();
  const [venueId, setVenueId] = useState(venues[0]?.id ?? ""),
    [locationId, setLocationId] = useState(
      locations.find((row) => row.venue_id === venues[0]?.id)?.id ?? "",
    ),
    [tradingDate, setTradingDate] = useState(
      new Date().toISOString().slice(0, 10),
    ),
    [countType, setCountType] = useState<"opening" | "closing">("opening"),
    [query, setQuery] = useState("");
  const [values, setValues] = useState<
      Record<string, { packages: number; units: number; fill: number }>
    >({}),
    [countId, setCountId] = useState<string | null>(null),
    [status, setStatus] = useState("draft"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const [movementType, setMovementType] = useState("receipt"),
    [movementProductId, setMovementProductId] = useState(""),
    [movementQuantity, setMovementQuantity] = useState(""),
    [movementNote, setMovementNote] = useState(""),
    [correctionOfId, setCorrectionOfId] = useState("");
  const venueLocations = locations.filter((row) => row.venue_id === venueId),
    visible = useMemo(
      () =>
        products
          .filter((product) =>
            (product.name + " " + product.category)
              .toLowerCase()
              .includes(query.toLowerCase()),
          )
          .slice(0, 30),
      [products, query],
    );
  const update = (
    id: string,
    key: "packages" | "units" | "fill",
    value: number,
  ) =>
    setValues((current) => ({
      ...current,
      [id]: {
        packages: current[id]?.packages ?? 0,
        units: current[id]?.units ?? 0,
        fill: current[id]?.fill ?? 0,
        [key]: Math.max(0, value),
      },
    }));
  async function call(body: Record<string, unknown>) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/inventory/counts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
        payload = (await response.json()) as {
          errorCode?: string;
          countId?: string;
          status?: string;
        };
      if (!response.ok) throw new Error(t("count.actionFailed"));
      if (payload.countId) setCountId(payload.countId);
      if (payload.status) setStatus(payload.status);
      setMessage(
        payload.status === "draft"
          ? t("count.draftSaved")
          : payload.status === "submitted"
            ? t("count.submitted")
            : t("count.posted"),
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : t("count.actionFailed"),
      );
    } finally {
      setBusy(false);
    }
  }
  const create = () => {
    const lines = Object.entries(values)
      .filter(([, value]) => value.packages || value.units || value.fill)
      .map(([product_id, value]) => ({
        product_id,
        packages: String(value.packages),
        complete_units: String(value.units),
        partial_basis_points: value.fill,
      }));
    if (!lines.length) {
      setMessage(t("count.atLeastOne"));
      return;
    }
    void call({
      action: "create",
      organisationId,
      venueId,
      locationId,
      tradingDate,
      countType,
      countedAt: new Date().toISOString(),
      notes: "",
      idempotencyKey: crypto.randomUUID(),
      lines,
    });
  };
  const correctionCandidates = movements.filter(
    (row) =>
      row.venue_id === venueId &&
      row.location_id === locationId &&
      (!movementProductId || row.product_id === movementProductId) &&
      row.movement_type !== "approved_correction",
  );
  async function postMovement() {
    if (
      !movementProductId ||
      !movementQuantity ||
      movementNote.trim().length < 3
    )
      return;
    const correctionReference =
      correctionOfId || correctionCandidates[0]?.id || null;
    if (movementType === "approved_correction" && !correctionReference) {
      setMessage(t("movement.failed"));
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const quantity = parseLocaleNumber(
        movementQuantity,
        locale === "nl" ? "nl-NL" : "en-US",
      );
      const response = await fetch("/api/inventory/counts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "movement",
          organisationId,
          venueId,
          locationId,
          productId: movementProductId,
          tradingDate,
          movementType,
          quantity,
          sourceId: crypto.randomUUID(),
          idempotencyKey: crypto.randomUUID(),
          note: movementNote,
          correctionOfId:
            movementType === "approved_correction" ? correctionReference : null,
        }),
      });
      (await response.json()) as { errorCode?: string };
      if (!response.ok) throw new Error(t("movement.failed"));
      setMovementQuantity("");
      setMovementNote("");
      setCorrectionOfId("");
      setMessage(t("movement.saved"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("movement.failed"));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workflow-stack">
      <section className="panel count-workspace" aria-labelledby="count-title">
        <header>
          <div>
            <h3 id="count-title">{t("count.title")}</h3>
            <p>{t("count.help")}</p>
          </div>
        </header>
        <div className="count-context">
          <label>
            {t("common.venue")}
            <select
              value={venueId}
              onChange={(event) => {
                const next = event.target.value;
                setVenueId(next);
                setLocationId(
                  locations.find((row) => row.venue_id === next)?.id ?? "",
                );
              }}
            >
              {venues.map((row) => (
                <option value={row.id} key={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("count.storage")}
            <select
              value={locationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {venueLocations.map((row) => (
                <option value={row.id} key={row.id}>
                  {row.name}
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
          <label>
            {t("count.moment")}
            <select
              value={countType}
              onChange={(event) =>
                setCountType(event.target.value as "opening" | "closing")
              }
            >
              <option value="opening">{t("count.opening")}</option>
              <option value="closing">{t("count.closing")}</option>
            </select>
          </label>
        </div>
        <label className="count-search">
          {t("count.search")}
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("count.searchPlaceholder")}
          />
        </label>
        <div className="count-products">
          {visible.map((product) => {
            const value = values[product.id] ?? {
              packages: 0,
              units: 0,
              fill: 0,
            };
            return (
              <article key={product.id}>
                <div>
                  <b>{product.name}</b>
                  <span>
                    {product.category} · {product.package_quantity}
                  </span>
                </div>
                <label>
                  {t("count.packages")}
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={value.packages}
                    onChange={(event) =>
                      update(product.id, "packages", Number(event.target.value))
                    }
                  />
                </label>
                <label>
                  {t("count.fullBottles")}
                  <div className="stepper">
                    <button
                      type="button"
                      aria-label={`${t("count.less")} ${product.name}`}
                      onClick={() =>
                        update(product.id, "units", value.units - 1)
                      }
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={value.units}
                      onChange={(event) =>
                        update(product.id, "units", Number(event.target.value))
                      }
                    />
                    <button
                      type="button"
                      aria-label={`${t("count.more")} ${product.name}`}
                      onClick={() =>
                        update(product.id, "units", value.units + 1)
                      }
                    >
                      +
                    </button>
                  </div>
                </label>
                <label>
                  {t("count.openBottle")}
                  <select
                    value={value.fill}
                    onChange={(event) =>
                      update(product.id, "fill", Number(event.target.value))
                    }
                  >
                    <option value="0">{t("count.none")}</option>
                    <option value="2500">25%</option>
                    <option value="5000">50%</option>
                    <option value="7500">75%</option>
                    <option value="10000">100%</option>
                  </select>
                </label>
              </article>
            );
          })}
        </div>
        <div className="count-footer">
          <span>
            {
              Object.values(values).filter(
                (value) => value.packages || value.units || value.fill,
              ).length
            }{" "}
            {t("count.counted")} · {t("common.status")} {authEnumLabel(locale,status)}
          </span>
          {!countId ? (
            <button
              className="primary"
              disabled={busy || !locationId}
              aria-busy={busy}
              onClick={create}
            >
              {t("count.saveDraft")}
            </button>
          ) : status === "draft" ? (
            <button
              className="primary"
              disabled={busy}
              aria-busy={busy}
              onClick={() =>
                void call({
                  action: "submit",
                  organisationId,
                  venueId,
                  countId,
                  idempotencyKey: crypto.randomUUID(),
                })
              }
            >
              {t("count.submit")}
            </button>
          ) : status === "submitted" ? (
            <button
              className="primary"
              disabled={busy}
              aria-busy={busy}
              onClick={() =>
                void call({
                  action: "post",
                  organisationId,
                  venueId,
                  countId,
                  idempotencyKey: crypto.randomUUID(),
                })
              }
            >
              {t("count.post")}
            </button>
          ) : null}
        </div>
        {message ? (
          <p className="import-message" role="status" aria-live="polite">
            {message}
          </p>
        ) : null}
      </section>
      <section className="panel workflow-card" aria-labelledby="movement-title">
        <header>
          <div>
            <h3 id="movement-title">{t("movement.title")}</h3>
            <p>{t("movement.help")}</p>
          </div>
        </header>
        <div className="workflow-fields">
          <label>
            {t("movement.type")}
            <select
              value={movementType}
              onChange={(event) => setMovementType(event.target.value)}
            >
              <option value="receipt">{t("movement.receipt")}</option>
              <option value="supplier_return">{t("movement.return")}</option>
              <option value="transfer_in">{t("movement.transferIn")}</option>
              <option value="transfer_out">{t("movement.transferOut")}</option>
              <option value="waste">{t("movement.waste")}</option>
              <option value="breakage">{t("movement.breakage")}</option>
              <option value="complimentary">
                {t("movement.complimentary")}
              </option>
              <option value="approved_correction">
                {t("movement.correction")}
              </option>
            </select>
          </label>
          <label>
            {t("movement.product")}
            <select
              value={movementProductId}
              onChange={(event) => setMovementProductId(event.target.value)}
            >
              <option value="">{t("movement.chooseProduct")}</option>
              {products.map((product) => (
                <option value={product.id} key={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("movement.quantity")}
            <input
              inputMode="decimal"
              value={movementQuantity}
              onChange={(event) => setMovementQuantity(event.target.value)}
            />
          </label>
          <label>
            {t("movement.note")}
            <input
              value={movementNote}
              maxLength={1000}
              placeholder={t("movement.notePlaceholder")}
              onChange={(event) => setMovementNote(event.target.value)}
            />
          </label>
        </div>
        <button
          type="button"
          className="primary"
          disabled={
            busy ||
            !locationId ||
            !movementProductId ||
            !movementQuantity ||
            movementNote.trim().length < 3
          }
          aria-busy={busy}
          onClick={() => void postMovement()}
        >
          {t("movement.save")}
        </button>
      </section>
      <section className="panel" aria-labelledby="count-history-title">
        <header>
          <div>
            <h3 id="count-history-title">{t("count.history")}</h3>
            <p>{t("count.historyHelp")}</p>
          </div>
        </header>
        <div className="record-list">
          {counts.map((row) => (
            <div className="record-row" key={row.id}>
              <b>
                {row.trading_date} · {authEnumLabel(locale,row.count_type)}
              </b>
              <span>
                {locations.find((location) => location.id === row.location_id)
                  ?.name ?? t("common.location")}
              </span>
              <em>{authEnumLabel(locale,row.status)}</em>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
