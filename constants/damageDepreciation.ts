// 사고감가표(사용자 제공 참고자료) 기준 — X(교환) 부위별 감가율(%).
// B(판금)는 감가 계산에서 제외, W(용접)는 이 값의 절반을 적용한다.
export const DEPRECIATION_RATES: Record<string, number> = {
  후드: 4,
  프론트펜더: 2,
  프론트패널: 4,
  인사이드패널: 2,
  "휠하우스(앞)": 6,
  필러패널A: 4,
  필러패널B: 4,
  필러패널C: 4,
  사이드실패널: 3,
  도어: 3,
  루프패널: 8,
  쿼터패널: 4,
  "휠하우스(뒤)": 5,
  트렁크플로어: 4,
  리어패널: 3,
  트렁크리드: 3,
  사이드멤버: 3,
  대쉬패널: 3,
  플로어패널: 4,
  패키지트레이: 3,
};

// CarEvaluationDamageChecker의 CHECK_POSITIONS(37개, index 0~36)와 1:1 대응되는 부위명.
// TODO: 실제 도면 확인 후 채워넣기 — 채워지기 전까지는 감가 계산에서 전부 제외됨(안전한 기본값).
export const PART_NAMES: (string | null)[] = new Array(37).fill(null);

// checkedDamages(진단 화면의 손상 체크 배열)를 받아 전체 감가율(%)을 계산.
// X=교환(전체 반영) / W=용접(절반 반영) / B=판금(반영 안 함).
export function computeDamageDepreciationPct(checkedDamages: string[][]): number {
  let total = 0;
  checkedDamages.forEach((symbols, i) => {
    const part = PART_NAMES[i];
    if (!part) return;
    const rate = DEPRECIATION_RATES[part];
    if (rate == null) return;
    const symbol = symbols?.[0];
    if (symbol === "X") total += rate;
    else if (symbol === "W") total += rate / 2;
    // symbol === "B" (판금) — 계상 제외
  });
  return total;
}
