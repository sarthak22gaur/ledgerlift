// Sign-preserving log so a few outlier days don't flatten the scale; handles net-negative days and zero.
export function symlog(x: number): number {
  return Math.sign(x) * Math.log1p(Math.abs(x));
}

export function invSymlog(y: number): number {
  return Math.sign(y) * Math.expm1(Math.abs(y));
}

export type HeatmapScale = "linear" | "log";

export function buildScaleDomain(
  values: number[],
  isNet: boolean
): { rangeMin: number; rangeMax: number } {
  const hasData = values.length > 0;
  const dataMin = hasData ? Math.min(...values) : 0;
  const dataMax = hasData ? Math.max(...values) : 1;

  // Stretch the scale across this period's actual range so contrast is proportional, not anchored at zero.
  const flat = dataMin === dataMax;
  const netExtent = Math.max(Math.abs(dataMin), Math.abs(dataMax), 0.01);
  const rangeMin = isNet ? -netExtent : flat ? dataMin - 1 : dataMin;
  const rangeMax = isNet ? netExtent : dataMax;
  return { rangeMin, rangeMax };
}

export const EXPENSE_COLORS = ["#fecaca", "#f87171", "#dc2626", "#7f1d1d"] as const;
export const NET_COLORS = ["#dc2626", "#fca5a5", "#fee2e2", "#bbf7d0", "#16a34a"] as const;
