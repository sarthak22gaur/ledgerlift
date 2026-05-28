import { describe, it, expect } from "vitest";
import {
  formatCurrency,
  formatCompactCurrency,
  formatPercent,
} from "@/lib/currency";

describe("formatCurrency", () => {
  it("formats positive amounts", () => {
    expect(formatCurrency(1234.56)).toBe("$1,234.56");
  });

  it("formats negative amounts", () => {
    expect(formatCurrency(-49.99)).toBe("-$49.99");
  });

  it("formats zero", () => {
    expect(formatCurrency(0)).toBe("$0.00");
  });

  it("formats large amounts with commas", () => {
    expect(formatCurrency(1000000)).toBe("$1,000,000.00");
  });

  it("rounds to two decimals", () => {
    expect(formatCurrency(10.999)).toBe("$11.00");
  });
});

describe("formatCompactCurrency", () => {
  it("formats amounts under 1K normally", () => {
    expect(formatCompactCurrency(500)).toBe("$500.00");
  });

  it("formats thousands as K", () => {
    expect(formatCompactCurrency(1500)).toBe("$1.5K");
  });

  it("formats millions as M", () => {
    expect(formatCompactCurrency(2500000)).toBe("$2.5M");
  });

  it("formats billions as B", () => {
    expect(formatCompactCurrency(3000000000)).toBe("$3.0B");
  });

  it("handles negative amounts", () => {
    expect(formatCompactCurrency(-1500)).toBe("-$1.5K");
  });
});

describe("formatPercent", () => {
  it("formats decimal as percentage", () => {
    expect(formatPercent(0.156)).toBe("15.6%");
  });

  it("formats zero", () => {
    expect(formatPercent(0)).toBe("0.0%");
  });

  it("formats 1 as 100%", () => {
    expect(formatPercent(1)).toBe("100.0%");
  });
});
