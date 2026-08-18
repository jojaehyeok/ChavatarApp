// PriceChart.tsx의 회귀선 계산과 동일한 로직 — 화면 표시(PriceChart)와 저장(CarEvaluationSheet)
// 양쪽에서 같은 숫자가 나오도록 하나로 뺐다(따로 두면 나중에 둘이 어긋날 수 있어서).
type Listing = { mileage: number; priceManwon: number };

function quadFit(points: { x: number; y: number }[]) {
  let S0 = 0, S1 = 0, S2 = 0, S3 = 0, S4 = 0, T0 = 0, T1 = 0, T2 = 0;
  for (const { x, y } of points) {
    const x2 = x * x, x3 = x2 * x, x4 = x2 * x2;
    S0 += 1; S1 += x; S2 += x2; S3 += x3; S4 += x4;
    T0 += y; T1 += x * y; T2 += x2 * y;
  }
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const M = [[S0, S1, S2], [S1, S2, S3], [S2, S3, S4]];
  const D = det3(M);
  if (Math.abs(D) < 1e-9) return null;
  const a = det3([[T0, S1, S2], [T1, S2, S3], [T2, S3, S4]]) / D;
  const b = det3([[S0, T0, S2], [S1, T1, S3], [S2, T2, S4]]) / D;
  const c = det3([[S0, S1, T0], [S1, S2, T1], [S2, S3, T2]]) / D;
  return (x: number) => a + b * x + c * x * x;
}

export function computePriceEstimate(
  listings: Listing[],
  targetMileage: number | undefined,
  depreciationPct: number | undefined,
): {
  rangeLow: number; rangeHigh: number;
  depLow: number | null; depHigh: number | null;
} | null {
  const points = listings
    .filter((l) => l.mileage > 0 && l.priceManwon > 0)
    .map((l) => ({ x: l.mileage / 10000, y: l.priceManwon }));

  if (points.length < 4 || targetMileage == null || targetMileage <= 0) return null;

  const predict = quadFit(points);
  if (!predict) return null;

  const tx = targetMileage / 10000;
  const targetY = Math.max(0, predict(tx));
  const residuals = points.map((p) => p.y - predict(p.x));
  const meanSq = residuals.reduce((s, r) => s + r * r, 0) / residuals.length;
  const stdev = Math.sqrt(meanSq);
  const margin = Math.max(stdev * 0.5, targetY * 0.03);
  const rangeLow = Math.round((targetY - margin) / 10) * 10;
  const rangeHigh = Math.round((targetY + margin) / 10) * 10;

  const hasDep = !!depreciationPct && depreciationPct > 0;
  const depFactor = hasDep ? 1 - depreciationPct! / 100 : 1;
  const depLow = hasDep ? Math.round((rangeLow * depFactor) / 10) * 10 : null;
  const depHigh = hasDep ? Math.round((rangeHigh * depFactor) / 10) * 10 : null;

  return { rangeLow, rangeHigh, depLow, depHigh };
}
