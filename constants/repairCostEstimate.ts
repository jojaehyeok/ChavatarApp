// 사용자 제공 기준 — 정비/외관 실비 항목별 대략적인 비용(만원). 지역/업체별 차이가 있을 수 있음.
// 외판도색: 1판 기준, 국산차/수입차로 단가가 다름.
export const PAINT_COST_DOMESTIC = 10;
export const PAINT_COST_IMPORTED = 15;
export const WHEEL_COST_PER_UNIT = 10; // 휠 1짝당
export const SMART_KEY_COST = 15; // 스마트키가 아예 없을 때(재발급) 실비
export const TIRE_COST_PER_UNIT = 10; // 타이어 1개당(마모 심할 때)
export const TIRE_REPLACE_THRESHOLD_PCT = 20; // 이 % 이하면 교체 필요로 판단
export const INTERIOR_CLEANING_COST = 15; // 실내 크리닝+복원(차 전체 기준, 개수와 무관하게 1회)

// EnCarAPI가 돌려주는 제조사명(한글) 중 국산 브랜드 — 나머지는 전부 수입으로 판단.
const DOMESTIC_MANUFACTURERS = new Set([
  "현대", "기아", "제네시스", "쉐보레(GM대우)", "쉐보레", "GM대우",
  "르노코리아", "르노삼성", "삼성", "KG모빌리티", "쌍용",
]);

export function isDomesticManufacturer(manufacturer: string | undefined | null): boolean {
  if (!manufacturer) return true; // 모르면 국산 단가(더 저렴한 쪽)로 보수적으로 계산
  return DOMESTIC_MANUFACTURERS.has(manufacturer.trim());
}

export interface RepairCostInputs {
  manufacturer?: string | null;
  paintNeeded: number; // 외판도색 필요 판 수
  wheelScratch: number; // 휠 스크래치 개수
  smartKeyCount: number; // 스마트키 개수(0이면 재발급 필요로 판단)
  frontTirePct: number; // 앞타이어 마모 잔여율(%)
  backTirePct: number; // 뒷타이어 마모 잔여율(%)
  interiorCleaning: number; // 실내크리닝 필요 여부(개수로 관리하지만 0 초과면 1회 비용만 적용)
  glassLightDamage: number; // 유리/라이트 손상 개수 — 금액은 실비라 정액 계산 불가, 있다는 것만 표시
}

export interface RepairCostResult {
  totalWon: number; // 만원 단위, 정액 산정 가능한 항목 합계
  hasUnquantifiedItem: boolean; // 유리/라이트처럼 실비라 위 합계에 포함 못 한 항목이 있는지
  breakdown: string[]; // "외판도색 2판 -20만원" 처럼 사람이 읽을 수 있는 내역
}

export function computeFlatRepairDeduction(input: RepairCostInputs): RepairCostResult {
  const breakdown: string[] = [];
  let total = 0;

  if (input.paintNeeded > 0) {
    const rate = isDomesticManufacturer(input.manufacturer) ? PAINT_COST_DOMESTIC : PAINT_COST_IMPORTED;
    const cost = input.paintNeeded * rate;
    total += cost;
    breakdown.push(`외판도색 ${input.paintNeeded}판 -${cost}만원`);
  }
  if (input.wheelScratch > 0) {
    const cost = input.wheelScratch * WHEEL_COST_PER_UNIT;
    total += cost;
    breakdown.push(`휠 스크래치 ${input.wheelScratch}짝 -${cost}만원`);
  }
  if (input.smartKeyCount === 0) {
    total += SMART_KEY_COST;
    breakdown.push(`스마트키 없음 -${SMART_KEY_COST}만원`);
  }
  let tireCount = 0;
  if (input.frontTirePct <= TIRE_REPLACE_THRESHOLD_PCT) tireCount += 1;
  if (input.backTirePct <= TIRE_REPLACE_THRESHOLD_PCT) tireCount += 1;
  if (tireCount > 0) {
    const cost = tireCount * TIRE_COST_PER_UNIT;
    total += cost;
    breakdown.push(`타이어 마모(${tireCount}개) -${cost}만원`);
  }
  if (input.interiorCleaning > 0) {
    total += INTERIOR_CLEANING_COST;
    breakdown.push(`실내크리닝/복원 -${INTERIOR_CLEANING_COST}만원`);
  }
  const hasUnquantifiedItem = input.glassLightDamage > 0;
  if (hasUnquantifiedItem) {
    breakdown.push(`유리/라이트 손상 ${input.glassLightDamage}건 (실비, 별도 확인 필요)`);
  }

  return { totalWon: total, hasUnquantifiedItem, breakdown };
}
