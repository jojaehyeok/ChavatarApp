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

// CarEvaluationDamageChecker의 CHECK_POSITIONS(37개, index 0~36)와 1:1 대응되는 실제 부위명.
// cavior 웹 리포트(app/report/[id]/page.tsx의 PART_NAMES)와 동일한 원본(Flutter) 순서를 그대로 씀 —
// 좌표(앞→뒤, 좌측(운전석)→우측(조수석))로 대조해서 순서 일치 확인함.
export const PART_NAMES = [
  "운전석 앞휀더", "운전석 앞도어", "운전석 A필러", "운전석 사이드실 패널",
  "운전석 B필러", "운전석 뒷도어", "운전석 C필러", "운전석 쿼터패널",
  "후드", "루프패널", "트렁크 리드",
  "조수석 앞휀더", "조수석 A필러", "조수석 앞도어", "조수석 사이드실 패널",
  "조수석 B필러", "조수석 뒷도어", "조수석 C필러", "조수석 쿼터패널",
  "라디에이터 서포트", "프런트 패널",
  "운전석 인사이드 패널", "운전석 프런트 사이드멤버", "조수석 프런트 사이드멤버",
  "조수석 인사이드 패널", "운전석 프런트 휠하우스", "조수석 프런트 휠하우스",
  "크로스 멤버", "대쉬 패널", "플로어 패널", "패키지 트레이",
  "운전석 리어 휠하우스", "운전석 리어 사이드멤버", "트렁크 플로어 패널",
  "조수석 리어 사이드멤버", "조수석 리어 휠하우스", "리어 패널",
] as const;

// 위 PART_NAMES를 DEPRECIATION_RATES의 카테고리 키로 매핑. 사용자가 준 사고감가표에 없는
// 부위(라디에이터 서포트, 크로스 멤버)는 null로 두어 감가 계산에서 제외한다(추측 금지).
export const PART_CATEGORY: (string | null)[] = [
  "프론트펜더", "도어", "필러패널A", "사이드실패널",
  "필러패널B", "도어", "필러패널C", "쿼터패널",
  "후드", "루프패널", "트렁크리드",
  "프론트펜더", "필러패널A", "도어", "사이드실패널",
  "필러패널B", "도어", "필러패널C", "쿼터패널",
  null /* 라디에이터 서포트 */, "프론트패널",
  "인사이드패널", "사이드멤버", "사이드멤버",
  "인사이드패널", "휠하우스(앞)", "휠하우스(앞)",
  null /* 크로스 멤버 */, "대쉬패널", "플로어패널", "패키지트레이",
  "휠하우스(뒤)", "사이드멤버", "트렁크플로어",
  "사이드멤버", "휠하우스(뒤)", "리어패널",
];

// checkedDamages(진단 화면의 손상 체크 배열)를 받아 전체 감가율(%)을 계산.
// X=교환(전체 반영) / W=용접(절반 반영) / B=판금(반영 안 함).
export function computeDamageDepreciationPct(checkedDamages: string[][]): number {
  let total = 0;
  checkedDamages.forEach((symbols, i) => {
    const category = PART_CATEGORY[i];
    if (!category) return;
    const rate = DEPRECIATION_RATES[category];
    if (rate == null) return;
    const symbol = symbols?.[0];
    if (symbol === "X") total += rate;
    else if (symbol === "W") total += rate / 2;
    // symbol === "B" (판금) — 계상 제외
  });
  return total;
}
