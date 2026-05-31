export type ResolverInput = {
  productLowStockThreshold?: number | null;
  categoryLowStockThreshold?: number | null;
  defaultLowStockThreshold: number;
  productExpiryWarningDays?: number | null;
  categoryExpiryWarningDays?: number | null;
  defaultExpiryWarningDays: number;
};

export function resolveLowStockThreshold(input: ResolverInput): number {
  if (input.productLowStockThreshold !== null && input.productLowStockThreshold !== undefined) {
    return input.productLowStockThreshold;
  }
  if (input.categoryLowStockThreshold !== null && input.categoryLowStockThreshold !== undefined) {
    return input.categoryLowStockThreshold;
  }
  return input.defaultLowStockThreshold;
}

export function resolveExpiryWarningDays(input: ResolverInput): number {
  if (input.productExpiryWarningDays !== null && input.productExpiryWarningDays !== undefined) {
    return input.productExpiryWarningDays;
  }
  if (input.categoryExpiryWarningDays !== null && input.categoryExpiryWarningDays !== undefined) {
    return input.categoryExpiryWarningDays;
  }
  return input.defaultExpiryWarningDays;
}
