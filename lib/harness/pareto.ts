import type { Mode } from "../types";

/**
 * HarnessPro §4.3 candidate filtering + representative selection.
 *   1. drop candidates below the performance floor (the parent/seed pass rate)
 *   2. drop Pareto-dominated candidates (h' ≺ h: no worse on both, strictly better on one)
 *   3. per mode m pick argmin J_m(h) = α_m·d_perf(h)² + β_m·d_cost(h)²
 * with d_perf = (Pmax − PR)/(Pmax − Pmin) and d_cost = (C − Cmin)/(Cmax − Cmin).
 */
export interface Point {
  id: string;
  pass: number; // higher is better
  cost: number; // lower is better (USD per episode)
}

export type Weights = Record<Mode, { alpha: number; beta: number }>;

/** HarnessPro Appendix A: (α, β) = (1,2) lite, (1,1) medium, (2,1) heavy, fixed across epochs. */
export const MODE_WEIGHTS: Weights = {
  lite: { alpha: 1, beta: 2 },
  medium: { alpha: 1, beta: 1 },
  heavy: { alpha: 2, beta: 1 },
};

/** Optional wider spread: on small fronts the paper's weights often pick one "knee" point for all modes. */
export const SPREAD_WEIGHTS: Weights = {
  lite: { alpha: 1, beta: 10 },
  medium: { alpha: 1, beta: 1 },
  heavy: { alpha: 10, beta: 1 },
};

export function dominates(a: Point, b: Point): boolean {
  return a.pass >= b.pass && a.cost <= b.cost && (a.pass > b.pass || a.cost < b.cost);
}

export function paretoFilter<T extends Point>(points: T[], floor: number): T[] {
  const eligible = points.filter((p) => p.pass >= floor - 1e-9);
  return eligible.filter((p) => !eligible.some((q) => q !== p && dominates(q, p)));
}

export function selectModes<T extends Point>(front: T[], weights = MODE_WEIGHTS): Record<Mode, T> | null {
  if (front.length === 0) return null;
  const passes = front.map((p) => p.pass);
  const costs = front.map((p) => p.cost);
  const [pMin, pMax, cMin, cMax] = [Math.min(...passes), Math.max(...passes), Math.min(...costs), Math.max(...costs)];
  // Minimum meaningful ranges: plain min-max normalization would turn a $0.004 gap
  // (noise on small validation sets) into the full cost axis.
  const pRange = Math.max(pMax - pMin, 0.05);
  const cRange = Math.max(cMax - cMin, 0.1 * cMax, 1e-9);

  const pick = (m: Mode): T => {
    const { alpha, beta } = weights[m];
    let best = front[0];
    let bestJ = Infinity;
    for (const p of front) {
      const dPerf = (pMax - p.pass) / pRange;
      const dCost = (p.cost - cMin) / cRange;
      const j = alpha * dPerf ** 2 + beta * dCost ** 2;
      // Tie-break: lite prefers cheaper; medium/heavy prefer stronger.
      const better = j < bestJ - 1e-12 || (Math.abs(j - bestJ) <= 1e-12 && (m === "lite" ? p.cost < best.cost : p.pass > best.pass));
      if (better) {
        best = p;
        bestJ = j;
      }
    }
    return best;
  };

  return { lite: pick("lite"), medium: pick("medium"), heavy: pick("heavy") };
}
