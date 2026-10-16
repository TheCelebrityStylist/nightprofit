import { z } from "zod";

export const connectorKinds = [
  "pos", "payment", "ticketing", "reservation", "workforce", "accounting",
  "analytics", "advertising", "supplier", "computer_vision", "notification",
] as const;

export type ConnectorKind = (typeof connectorKinds)[number];
export type ConnectorState =
  | "disconnected"
  | "connecting"
  | "not_configured"
  | "authorization_required"
  | "connected"
  | "syncing"
  | "degraded"
  | "error"
  | "failed"
  | "disabled";

export const connectorStates = [
  "disconnected", "connecting", "connected", "degraded", "error",
  "not_configured", "authorization_required", "syncing", "failed", "disabled",
] as const satisfies readonly ConnectorState[];

export function normalizeLegacyConnectorState(state: ConnectorState): ConnectorState {
  if (state === "disconnected") return "not_configured";
  if (state === "connecting") return "syncing";
  if (state === "error") return "failed";
  return state;
}

export const providerErrorSchema = z.object({
  code: z.string().min(1),
  category: z.enum(["authentication", "authorization", "rate_limit", "validation", "provider", "network"]),
  retryable: z.boolean(),
  retryAfterSeconds: z.number().int().nonnegative().optional(),
  safeMessage: z.string().min(1),
});

export const syncPageSchema = z.object({
  cursorAfter: z.string().nullable(),
  hasMore: z.boolean(),
  records: z.array(z.object({
    externalId: z.string().nullable(),
    occurredAt: z.string().datetime().nullable(),
    sourceType: z.string().min(1),
    payload: z.record(z.string(), z.unknown()),
  })),
});

export interface ConnectorContext {
  organisationId: string;
  venueId: string | null;
  connectionId: string;
  correlationId: string;
}

export interface ProviderConnectionTest {
  authenticatedRequestSucceeded: boolean;
  providerAccountId: string | null;
  checkedAt: string;
  scopes: string[];
}

export interface ProviderNeutralConnector {
  readonly key: string;
  readonly kind: ConnectorKind;
  readonly minimumScopes: readonly string[];
  testConnection(context: ConnectorContext): Promise<ProviderConnectionTest>;
  pull(context: ConnectorContext, cursor: string | null): Promise<z.infer<typeof syncPageSchema>>;
  normalizeError(error: unknown): z.infer<typeof providerErrorSchema>;
}

export interface PreparedExternalAction {
  actionType: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  requiresApproval: true;
}

export function connectedState(test: ProviderConnectionTest): ConnectorState {
  return test.authenticatedRequestSucceeded ? "connected" : "failed";
}

export function exponentialBackoffSeconds(attempt: number, capSeconds = 3600): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new Error("attempt must be a positive integer");
  return Math.min(capSeconds, 2 ** (attempt - 1) * 30);
}
