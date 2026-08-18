import React from "react";
import { Dimensions, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";

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

export default function PriceChart({
  listings,
  targetMileage,
}: {
  listings: Listing[];
  targetMileage?: number;
}) {
  const points = listings
    .filter((l) => l.mileage > 0 && l.priceManwon > 0)
    .map((l) => ({ x: l.mileage / 10000, y: l.priceManwon }));

  if (points.length < 4) return null;

  const predict = quadFit(points);
  if (!predict) return null;

  const screenW = Dimensions.get("window").width;
  const W = screenW - 40;
  const H = 260;
  const PAD_L = 54, PAD_B = 26, PAD_T = 14, PAD_R = 14;

  const xs = points.map((p) => p.x);
  const maxX = Math.max(...xs, (targetMileage ?? 0) / 10000) * 1.08 || 1;
  const minX = 0;
  const ys = points.map((p) => p.y);
  const maxY = Math.max(...ys) * 1.08;
  const minY = 0;

  const sx = (x: number) => PAD_L + ((x - minX) / (maxX - minX)) * (W - PAD_L - PAD_R);
  const sy = (y: number) => H - PAD_B - ((y - minY) / (maxY - minY)) * (H - PAD_B - PAD_T);

  const curvePath = Array.from({ length: 41 }, (_, i) => {
    const x = minX + ((maxX - minX) * i) / 40;
    return `${i === 0 ? "M" : "L"}${sx(x)},${sy(Math.max(0, predict(x)))}`;
  }).join(" ");

  const residuals = points.map((p) => p.y - predict(p.x));
  const meanSq = residuals.reduce((s, r) => s + r * r, 0) / residuals.length;
  const stdev = Math.sqrt(meanSq);

  let targetY: number | null = null;
  let rangeLow = 0, rangeHigh = 0;
  if (targetMileage != null && targetMileage > 0) {
    const tx = targetMileage / 10000;
    targetY = Math.max(0, predict(tx));
    const margin = Math.max(stdev * 0.5, targetY * 0.03);
    rangeLow = Math.round((targetY - margin) / 10) * 10;
    rangeHigh = Math.round((targetY + margin) / 10) * 10;
  }

  const yTicks = 4;
  const yGrid = Array.from({ length: yTicks + 1 }, (_, i) => (maxY / yTicks) * i);

  return (
    <View style={{ paddingHorizontal: 20, marginBottom: 8 }}>
      {targetY != null && (
        <View style={{ marginBottom: 14 }}>
          <Text style={{ color: "#888", fontSize: 12, fontWeight: "700", marginBottom: 4 }}>
            내 차 예상시세 (무사고 기준)
          </Text>
          <Text style={{ color: "#fff", fontSize: 26, fontWeight: "900" }}>
            {rangeLow.toLocaleString()} ~ {rangeHigh.toLocaleString()}
            <Text style={{ fontSize: 15, color: "#888", fontWeight: "700" }}> 만원</Text>
          </Text>
        </View>
      )}
      <Svg width={W} height={H}>
        {yGrid.map((y, i) => (
          <React.Fragment key={i}>
            <Line x1={PAD_L} x2={W - PAD_R} y1={sy(y)} y2={sy(y)} stroke="#222" strokeWidth={1} />
            <SvgText x={PAD_L - 8} y={sy(y) + 4} fontSize={10} fill="#666" textAnchor="end">
              {y >= 10000 ? `${(y / 10000).toFixed(1)}억` : `${Math.round(y).toLocaleString()}`}
            </SvgText>
          </React.Fragment>
        ))}
        <Line x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} stroke="#333" strokeWidth={1} />
        {[0, maxX / 2, maxX].map((x, i) => (
          <SvgText key={i} x={sx(x)} y={H - PAD_B + 16} fontSize={10} fill="#666" textAnchor="middle">
            {Math.round(x * 10) / 10}만km
          </SvgText>
        ))}

        {points.map((p, i) => (
          <Circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={3} fill="#3a5fd9" opacity={0.55} />
        ))}

        <Path d={curvePath} fill="none" stroke="#5b8dff" strokeWidth={2.5} />

        {targetY != null && (
          <>
            <Line
              x1={sx(targetMileage! / 10000)}
              x2={sx(targetMileage! / 10000)}
              y1={sy(targetY)}
              y2={H - PAD_B}
              stroke="#5b8dff"
              strokeWidth={1}
              strokeDasharray="3,3"
            />
            <Circle cx={sx(targetMileage! / 10000)} cy={sy(targetY)} r={6} fill="#5b8dff" stroke="#000" strokeWidth={2} />
          </>
        )}
      </Svg>
    </View>
  );
}
