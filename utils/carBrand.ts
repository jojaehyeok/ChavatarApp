// 차량명(제조사가 안 적혀있어도 모델명만으로) 브랜드를 추정하는 로직.
// cavior 웹(lib/carBrand.ts)과 동일한 규칙 — 로고는 자체 호스팅 없이
// carvior.store에 이미 있는 정적 파일(public/brand-logos)을 원격 이미지로 그대로 씀.
export interface BrandRule {
  pattern: RegExp;
  slug: string;
  label: string;
}

export const BRAND_RULES: BrandRule[] = [
  { pattern: /테슬라|tesla/i, slug: 'tesla', label: '테슬라' },
  { pattern: /벤츠|벤즈|mercedes|메르세데스|\b(?:[CES]\s?\d{3}|GL[ABCES]|CLA|CLS)\b/i, slug: 'mercedes-benz', label: '벤츠' },
  { pattern: /현대|hyundai|아반떼|소나타|그랜저|투싼|싼타페|팰리세이드|코나|캐스퍼|베뉴|아이오닉|스타렉스|포터|넥쏘|벨로스터/i, slug: 'hyundai', label: '현대' },
  { pattern: /기아|\bkia\b|\bk[3-9]\b|모닝|레이|셀토스|스포티지|쏘렌토|카니발|모하비|스팅어|니로|\bev[369]\b/i, slug: 'kia', label: '기아' },
  { pattern: /\bbmw\b|\b[1-8]\s?시리즈|\bx[1-7]\b|\bm[2-8]\b|\bi[347]\b|\bix\b/i, slug: 'bmw', label: 'BMW' },
  { pattern: /아우디|audi|\ba[1-8]\b|\bq[2-8]\b|\btt\b|\br8\b|e-?tron/i, slug: 'audi', label: '아우디' },
  { pattern: /제네시스|genesis|\bg[789]0\b|\bgv(60|70|80)\b/i, slug: 'genesis', label: '제네시스' },
  { pattern: /쉐보레|쉐비|chevrolet|스파크|말리부|트랙스|트레일블레이저|이쿼녹스|콜로라도|카마로/i, slug: 'chevrolet', label: '쉐보레(GM대우)' },
  { pattern: /르노|renault|\bsm[3-6]\b|\bqm[3-6]\b|\bxm3\b|클리오|아르카나|트위지/i, slug: 'renault', label: '르노코리아(삼성)' },
  { pattern: /쌍용|ssangyong|kg\s?모빌리티|\bkgm\b|렉스턴|티볼리|코란도|무쏘|액티언|카이런|체어맨|토레스/i, slug: 'ssangyong', label: 'KGM(쌍용)' },
  { pattern: /폭스바겐|volkswagen|\bvw\b|골프|제타|파사트|티구안|투아렉|아테온|폴로/i, slug: 'volkswagen', label: '폭스바겐' },
  { pattern: /토요타|도요타|toyota|캠리|코롤라|프리우스|라브4|시에나|아발론|하이랜더/i, slug: 'toyota', label: '토요타' },
  { pattern: /렉서스|lexus|\bes\d{3}\b|\bis\d{3}\b|\brx\d{3}\b|\bnx\d{3}\b|\bls\d{3}\b|\block?x\d{3}\b/i, slug: 'lexus', label: '렉서스' },
  { pattern: /포르쉐|porsche|\b911\b|카이엔|파나메라|박스터|카이맨|마칸|타이칸/i, slug: 'porsche', label: '포르쉐' },
  { pattern: /볼보|volvo|\bxc(40|60|90)\b|\bs(60|90)\b|\bv(60|90)\b/i, slug: 'volvo', label: '볼보' },
  { pattern: /랜드로버|land.?rover|디스커버리|레인지로버|프리랜더|이보크|벨라/i, slug: 'land-rover', label: '랜드로버' },
  { pattern: /지프|\bjeep\b|랭글러|체로키|컴패스|레니게이드/i, slug: 'jeep', label: '지프' },
  { pattern: /포드|\bford\b|익스플로러|머스탱|포커스|몬데오/i, slug: 'ford', label: '포드' },
  { pattern: /혼다|honda|시빅|어코드|cr-?v|파일럿|오딧세이/i, slug: 'honda', label: '혼다' },
  { pattern: /닛산|nissan|알티마|맥시마|로그|무라노|패스파인더|리프/i, slug: 'nissan', label: '닛산' },
  { pattern: /미니쿠퍼|\bmini\b|컨트리맨|클럽맨/i, slug: 'mini', label: '미니' },
  { pattern: /인피니티|infiniti/i, slug: 'infiniti', label: '인피니티' },
  { pattern: /폴스타|polestar/i, slug: 'polestar', label: '폴스타' },
];

export function detectBrand(text: string | null | undefined): BrandRule | null {
  if (!text) return null;
  return BRAND_RULES.find((r) => r.pattern.test(text)) ?? null;
}

// carvior.store에 배포된 정적 로고 파일 URL (앱 번들에 이미지 추가 없이 원격으로 사용)
export function brandLogoUrl(text: string | null | undefined): string | null {
  const slug = detectBrand(text)?.slug;
  return slug ? `https://carvior.store/brand-logos/${slug}.png` : null;
}
