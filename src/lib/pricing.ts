/** Shared poster pricing — keep in sync with poster.co/src/lib/poster-sizes.ts */

export type PosterSize = "A4" | "A5" | "A6";

export const SIZE_PRICE: Record<PosterSize, number> = {
  A4: 40,
  A5: 25,
  A6: 20,
};

export type SizePriceMap = Record<PosterSize, number>;

export const SHIPPING_THRESHOLD = 499;
export const SHIPPING_CHARGE = 80;
export const FREE_A6_THRESHOLD = 199;

export const COMBO_MIXED = 69;
export const COMBO_MINI = 39;
export const A4_PACK_2 = 70;
export const A4_PACK_3 = 109;

export type ComboSettings = {
  shippingThreshold: number;
  shippingCharge: number;
  freeA6Threshold: number;
  comboMixed: number;
  comboMini: number;
  a4Pack2: number;
  a4Pack3: number;
};

export const DEFAULT_COMBO_SETTINGS: ComboSettings = {
  shippingThreshold: SHIPPING_THRESHOLD,
  shippingCharge: SHIPPING_CHARGE,
  freeA6Threshold: FREE_A6_THRESHOLD,
  comboMixed: COMBO_MIXED,
  comboMini: COMBO_MINI,
  a4Pack2: A4_PACK_2,
  a4Pack3: A4_PACK_3,
};

export type SizeCounts = Record<PosterSize, number>;

function a4ComboCost(
  n: number,
  prices: SizePriceMap,
  combos: ComboSettings,
): number {
  if (n <= 0) return 0;
  const dp = Array.from({ length: n + 1 }, () => Infinity);
  dp[0] = 0;
  for (let i = 1; i <= n; i++) {
    dp[i] = Math.min(dp[i]!, dp[i - 1]! + prices.A4);
    if (i >= 2) dp[i] = Math.min(dp[i]!, dp[i - 2]! + combos.a4Pack2);
    if (i >= 3) dp[i] = Math.min(dp[i]!, dp[i - 3]! + combos.a4Pack3);
  }
  return dp[n]!;
}

export function priceFromCounts(
  counts: SizeCounts,
  sizePrice: SizePriceMap = SIZE_PRICE,
  combos: ComboSettings = DEFAULT_COMBO_SETTINGS,
): {
  subtotal: number;
  shipping: number;
  total: number;
} {
  const prices: SizePriceMap = { ...SIZE_PRICE, ...sizePrice };
  let a4 = Math.max(0, counts.A4 | 0);
  let a5 = Math.max(0, counts.A5 | 0);
  let a6 = Math.max(0, counts.A6 | 0);
  const a6InCart = a6;
  let cost = 0;

  while (a4 >= 1 && a5 >= 1 && a6 >= 1) {
    cost += combos.comboMixed;
    a4 -= 1;
    a5 -= 1;
    a6 -= 1;
  }
  while (a5 >= 1 && a6 >= 1) {
    cost += combos.comboMini;
    a5 -= 1;
    a6 -= 1;
  }
  cost += a4ComboCost(a4, prices, combos);
  cost += a5 * prices.A5;
  cost += a6 * prices.A6;

  if (cost > combos.freeA6Threshold && a6InCart >= 1) {
    cost = Math.max(0, cost - prices.A6);
  }

  const shipping = cost >= combos.shippingThreshold ? 0 : combos.shippingCharge;
  return { subtotal: cost, shipping, total: cost + shipping };
}

export function priceOrderLines(
  lines: { size: PosterSize; qty: number }[],
  sizePrice: SizePriceMap = SIZE_PRICE,
  combos: ComboSettings = DEFAULT_COMBO_SETTINGS,
): { subtotal: number; shipping: number; total: number } {
  const counts: SizeCounts = { A4: 0, A5: 0, A6: 0 };
  for (const line of lines) {
    counts[line.size] += line.qty;
  }
  return priceFromCounts(counts, sizePrice, combos);
}

/** Allocate combo-adjusted subtotal across lines proportionally for invoice consistency. */
export function allocateLineTotals(
  lines: { size: PosterSize; qty: number }[],
  sizePrice: SizePriceMap,
  subtotal: number,
): { unitPrice: number; lineTotal: number }[] {
  const listTotals = lines.map((l) => {
    const unit = sizePrice[l.size] ?? SIZE_PRICE[l.size];
    return unit * l.qty;
  });
  const listSum = listTotals.reduce((a, b) => a + b, 0);
  if (listSum <= 0) {
    return lines.map(() => ({ unitPrice: 0, lineTotal: 0 }));
  }

  const allocated = listTotals.map((t) =>
    Math.round((t / listSum) * subtotal),
  );
  // Fix rounding drift on last line
  const drift =
    subtotal - allocated.reduce((a, b) => a + b, 0);
  if (allocated.length > 0) {
    allocated[allocated.length - 1]! += drift;
  }

  return lines.map((l, i) => {
    const lineTotal = Math.max(0, allocated[i]!);
    const unitPrice =
      l.qty > 0 ? Math.round(lineTotal / l.qty) : sizePrice[l.size];
    return { unitPrice, lineTotal };
  });
}
