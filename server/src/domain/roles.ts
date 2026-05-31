export const USER_ROLES = ["admin", "manager", "store_keeper"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export function parseRole(value: string): UserRole | null {
  return USER_ROLES.includes(value as UserRole) ? (value as UserRole) : null;
}
