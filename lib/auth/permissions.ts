import type { MemberRole } from "../supabase/types";
export type Permission = "billing:manage"|"team:manage"|"settings:write"|"close:create"|"close:approve"|"close:reopen"|"financial:read"|"data:export";
const rolePermissions: Record<MemberRole, readonly Permission[]> = {
  owner:["billing:manage","team:manage","settings:write","close:create","close:approve","close:reopen","financial:read","data:export"],
  administrator:["team:manage","settings:write","close:create","close:approve","financial:read","data:export"],
  manager:["close:create","financial:read"],
  bookkeeper:["close:approve","financial:read","data:export"],
  viewer:["financial:read"],
};
export const hasPermission = (role:MemberRole, permission:Permission) => rolePermissions[role].includes(permission);
