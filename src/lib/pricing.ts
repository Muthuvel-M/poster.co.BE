/** Shared poster pricing — keep in sync with poster.co/src/lib/poster-sizes.ts */

export type PosterSize = "A4" | "A5" | "A6";

export const SIZE_PRICE: Record<PosterSize, number> = {
  A4: 40,
  A5: 25,
  A6: 20,
};

export const SHIPPING_THRESHOLD = 499;
export const SHIPPING_CHARGE = 80;
export const FREE_A6_THRESHOLD = 199;

export type SizeCounts = Record<PosterSize, number>;

function a4ComboCost(n: number): number {
  if (n <= 0) return 0;
  const dp = Array.from({ length: n + 1 }, () => Infinity);
  dp[0] = 0;
  for (let i = 1; i <= n; i++) {
    dp[i] = Math.min(dp[i]!, dp[i - 1]! + SIZE_PRICE.A4);
    if (i >= 2) dp[i] = Math.min(dp[i]!, dp[i - 2]! + 70);
    if (i >= 3) dp[i] = Math.min(dp[i]!, dp[i - 3]! + 109);
  }
  return dp[n]!;
}

export function priceFromCounts(counts: SizeCounts): {
  subtotal: number;
  shipping: number;
  total: number;
} {
  let a4 = Math.max(0, counts.A4 | 0);
  let a5 = Math.max(0, counts.A5 | 0);
  let a6 = Math.max(0, counts.A6 | 0);
  const a6InCart = a6;
  let cost = 0;

  while (a4 >= 1 && a5 >= 1 && a6 >= 1) {
    cost += 69;
    a4 -= 1;
    a5 -= 1;
    a6 -= 1;
  }
  while (a5 >= 1 && a6 >= 1) {
    cost += 39;
    a5 -= 1;
    a6 -= 1;
  }
  cost += a4ComboCost(a4);
  cost += a5 * SIZE_PRICE.A5;
  cost += a6 * SIZE_PRICE.A6;

  if (cost > FREE_A6_THRESHOLD && a6InCart >= 1) {
    cost = Math.max(0, cost - SIZE_PRICE.A6);
  }

  const shipping = cost >= SHIPPING_THRESHOLD ? 0 : SHIPPING_CHARGE;
  return { subtotal: cost, shipping, total: cost + shipping };
}

export function priceOrderLines(
  lines: { size: PosterSize; qty: number }[],
): { subtotal: number; shipping: number; total: number } {
  const counts: SizeCounts = { A4: 0, A5: 0, A6: 0 };
  for (const line of lines) {
    counts[line.size] += line.qty;
  }
  return priceFromCounts(counts);
}
