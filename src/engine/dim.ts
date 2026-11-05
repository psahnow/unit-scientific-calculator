// Dimension vectors: L M T I Θ N J + A (angle pseudo-dimension).

export const DIM_KEYS = ['L', 'M', 'T', 'I', 'K', 'N', 'J', 'A'] as const;
export type DimKey = (typeof DIM_KEYS)[number];
export type Dim = Record<DimKey, number>;

export const DIMLESS: Dim = { L: 0, M: 0, T: 0, I: 0, K: 0, N: 0, J: 0, A: 0 };

const r = (x: number) => Math.round(x * 1e9) / 1e9;

export function dim(partial: Partial<Dim>): Dim {
  return { ...DIMLESS, ...partial };
}
export function dimMul(a: Dim, b: Dim): Dim {
  const o = { ...DIMLESS };
  for (const k of DIM_KEYS) o[k] = r(a[k] + b[k]);
  return o;
}
export function dimDiv(a: Dim, b: Dim): Dim {
  const o = { ...DIMLESS };
  for (const k of DIM_KEYS) o[k] = r(a[k] - b[k]);
  return o;
}
export function dimPow(a: Dim, p: number): Dim {
  const o = { ...DIMLESS };
  for (const k of DIM_KEYS) o[k] = r(a[k] * p);
  return o;
}
export function dimEq(a: Dim, b: Dim): boolean {
  return DIM_KEYS.every((k) => Math.abs(a[k] - b[k]) < 1e-9);
}
/** Equal ignoring the angle pseudo-dimension. */
export function dimEqLoose(a: Dim, b: Dim): boolean {
  return DIM_KEYS.every((k) => k === 'A' || Math.abs(a[k] - b[k]) < 1e-9);
}
export const isDimless = (a: Dim) => dimEq(a, DIMLESS);
export const isDimlessLoose = (a: Dim) => dimEqLoose(a, DIMLESS);
export const isAngle = (a: Dim) => dimEq(a, dim({ A: 1 }));
export function dropAngle(a: Dim): Dim {
  return { ...a, A: 0 };
}
export function dimKey(a: Dim): string {
  return DIM_KEYS.map((k) => a[k]).join(',');
}

const NAMES: [Partial<Dim>, string][] = [
  [{}, 'dimensionless'],
  [{ L: 1 }, 'length'],
  [{ L: 2 }, 'area'],
  [{ L: 3 }, 'volume'],
  [{ M: 1 }, 'mass'],
  [{ T: 1 }, 'time'],
  [{ I: 1 }, 'current'],
  [{ K: 1 }, 'temperature'],
  [{ N: 1 }, 'amount'],
  [{ J: 1 }, 'luminous intensity'],
  [{ A: 1 }, 'angle'],
  [{ L: 1, T: -1 }, 'velocity'],
  [{ L: 1, T: -2 }, 'acceleration'],
  [{ M: 1, L: 1, T: -2 }, 'force'],
  [{ M: 1, L: -1, T: -2 }, 'pressure'],
  [{ M: 1, L: 2, T: -2 }, 'energy'],
  [{ M: 1, L: 2, T: -3 }, 'power'],
  [{ T: -1 }, 'frequency'],
  [{ A: 1, T: -1 }, 'angular velocity'],
  [{ M: 1, L: -3 }, 'density'],
  [{ L: 3, T: -1 }, 'flow rate'],
  [{ M: 1, L: -1, T: -1 }, 'dynamic viscosity'],
  [{ L: 2, T: -1 }, 'kinematic viscosity'],
  [{ I: 1, T: 1 }, 'charge'],
  [{ M: 1, L: 2, T: -3, I: -1 }, 'voltage'],
  [{ M: 1, L: 2, T: -3, I: -2 }, 'resistance'],
];

export function dimName(a: Dim): string {
  for (const [p, n] of NAMES) if (dimEq(a, dim(p))) return n;
  return 'quantity';
}
