import { describe, expect, it } from "vitest";
import {
  resolveExpiryWarningDays,
  resolveLowStockThreshold,
} from "../src/domain/thresholdResolver.js";

describe("threshold resolver", () => {
  it("uses global defaults when no overrides are present", () => {
    const input = {
      defaultLowStockThreshold: 10,
      defaultExpiryWarningDays: 7,
      categoryLowStockThreshold: null,
      categoryExpiryWarningDays: null,
      productLowStockThreshold: null,
      productExpiryWarningDays: null,
    };
    expect(resolveLowStockThreshold(input)).toBe(10);
    expect(resolveExpiryWarningDays(input)).toBe(7);
  });

  it("uses category values over globals", () => {
    const input = {
      defaultLowStockThreshold: 10,
      defaultExpiryWarningDays: 7,
      categoryLowStockThreshold: 3,
      categoryExpiryWarningDays: 2,
      productLowStockThreshold: null,
      productExpiryWarningDays: null,
    };
    expect(resolveLowStockThreshold(input)).toBe(3);
    expect(resolveExpiryWarningDays(input)).toBe(2);
  });

  it("uses product values over category and globals", () => {
    const input = {
      defaultLowStockThreshold: 10,
      defaultExpiryWarningDays: 7,
      categoryLowStockThreshold: 3,
      categoryExpiryWarningDays: 2,
      productLowStockThreshold: 1,
      productExpiryWarningDays: 0,
    };
    expect(resolveLowStockThreshold(input)).toBe(1);
    expect(resolveExpiryWarningDays(input)).toBe(0);
  });
});
