export type Capability =
  | "organisation.manage" | "venues.manage" | "members.manage" | "billing.manage"
  | "close.create" | "close.submit" | "close.approve" | "close.reopen"
  | "bookings.manage" | "bookings.discount" | "suppliers.manage" | "invoices.confirm"
  | "events.manage" | "compliance.manage" | "reports.view" | "exports.create"
  | "evidence.view" | "planning.manage" | "planning.respond" | "time.manage"
  | "time.record" | "time.approve" | "workforce.manage" | "actions.manage" | "ai.propose"
  | "inventory.count" | "inventory.post" | "reconciliation.run";
