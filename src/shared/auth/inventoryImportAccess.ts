/** STS `users.id` values allowed to open Inventory Import UI. */
export const INVENTORY_IMPORT_ALLOWED_USER_IDS = new Set<number>([409]);

export function userIdMayAccessInventoryImport(userId: number | undefined): boolean {
  if (userId == null || !Number.isInteger(userId) || userId <= 0) return false;
  return INVENTORY_IMPORT_ALLOWED_USER_IDS.has(userId);
}
