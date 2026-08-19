// ---------------------------------------------------------------------
// invoices.js — 계산서함: 세금계산서 PDF/이미지 업로드 → 자동 인식(PDF.js
// 텍스트 추출 또는 Tesseract.js OCR) → 목록 관리 → 공사명별로 모아
// 기존 정산서 화면(index.html)의 "외주·자재비" 표로 자동 생성.
//
// shared-utils.js(계산/포맷/테마/저장된 정산서 저장소 헬퍼)를 그대로
// 재사용하고, settlement.js와 동일한 이벤트 위임·포커스 유지·다크모드·
// 폴더 연결(File System Access API) 패턴을 따른다.
//
// ES 모듈로 로드된다(<script type="module">) — pdfjs-dist를 CDN에서
// import하기 위함. 모듈 스코프 자체가 격리되어 있으므로 settlement.js처럼
// 즉시실행함수(IIFE)로 다시 감쌀 필요는 없다.
// ---------------------------------------------------------------------

import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/build/pdf.worker.min.mjs';

// 일부 PDF 생성기는 한글 폰트를 임베드하지 않고 Adobe 표준 CJK 폰트(CID
// 폰트)만 참조한다 — 이 경우 pdf.js가 별도 CMap 리소스 없이는 텍스트를
// 올바르게 추출하지 못한다(리뷰 중 테스트 PDF로 재현됨: 라벨/숫자가 전혀
// 읽히지 않고 "임베드 텍스트 없음"으로 오판되어 불필요하게 OCR로 폴백함).
// pdfjs-dist 배포판에 포함된 cmaps 리소스를 CDN에서 함께 가리키도록 지정해
// 이 경우도 정상적으로 텍스트를 추출하게 한다.
var PDFJS_CMAP_URL = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.6.82/cmaps/';

var SettlementShared = window.SettlementShared;
var round = SettlementShared.round;
var calcVat = SettlementShared.calcVat;
var calcTotal = SettlementShared.calcTotal;
var parseNumber = SettlementShared.parseNumber;
var formatNumber = SettlementShared.formatNumber;
var formatBizRegNo = SettlementShared.formatBizRegNo;
var escapeAttr = SettlementShared.escapeAttr;

var INVOICES_STATE_KEY = 'settlement-invoices-state';
var state = null;

// 처리 중인 계산서 id 집합. 의도적으로 state(=localStorage)에는 저장하지
// 않는 런타임 전용 값이다 — 새로고침 중에 "인식 중" 상태만 영원히 남아
// 재시도조차 못하게 되는 것을 막기 위해, 저장되는 값은 항상
// parseMethod:'failed'(=미인식) 상태로 시작하고, "지금 처리 중"이라는
// 표시만 이 변수로 화면에 얹는다.
var processingIds = {};

var TEXT_MIN_LENGTH = 20;
var INVOICE_EXT_RE = /\.(pdf|jpe?g|png|webp|heic)$/i;
var IMAGE_EXT_RE = /^(jpe?g|png|webp|heic)$/i;
var WORK_TYPE_KEYWORDS = [
  '철근', '콘크리트', '형틀', '골조', '토공', '조적', '미장', '방수', '타일',
  '도장', '창호', '유리', '전기', '설비', '소방', '통신', '판넬', '경량', '석공', '조경'
];

// ---------------------------------------------------------------------
// invoicesState 저장/복원
// ---------------------------------------------------------------------
function createEmptyInvoicesState() {
  return { invoices: [], invoicesNextId: 1 };
}

function normalizeInvoicesState(parsed) {
  var empty = createEmptyInvoicesState();
  if (!parsed || typeof parsed !== 'object') return empty;
  return {
    invoices: Array.isArray(parsed.invoices) ? parsed.invoices : empty.invoices,
    invoicesNextId: parsed.invoicesNextId || empty.invoicesNextId
  };
}

function loadInvoicesState() {
  try {
    var raw = localStorage.getItem(INVOICES_STATE_KEY);
    if (raw) return normalizeInvoicesState(JSON.parse(raw));
  } catch (e) {
    /* 손상된 데이터는 무시하고 빈 템플릿 사용 */
  }
  return createEmptyInvoicesState();
}

function saveInvoicesState() {
  try {
    localStorage.setItem(INVOICES_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    /* storage unavailable - 무시 */
  }
}

function findInvoice(id) {
  id = String(id);
  for (var i = 0; i < state.invoices.length; i++) {
    if (String(state.invoices[i].id) === id) return state.invoices[i];
  }
  return null;
}

// ---------------------------------------------------------------------
// extractFieldsFromText(text) — PDF 텍스트 경로와 OCR 경로가 모두 이
// 함수 하나를 거친다(추출 로직 이중화 방지, spec-v2-invoice.md 3.2).
// ---------------------------------------------------------------------
var BIZ_REG_RE = /\d{3}-\d{2}-\d{5}/g;
var DATE_RE = /(\d{4})[.\-/년]\s?(\d{1,2})[.\-/월]\s?(\d{1,2})일?/;

// 국세청 표준 서식 등 일부 세금계산서 PDF는 라벨을 인쇄할 때 글자 사이에
// 자간용 공백을 끼워 넣는다("공급가액" → "공  급  가  액"). 라벨 문자열을
// text.indexOf()로 통짜 검색하면 이런 경우 전혀 매치되지 않아 금액/라벨
// 인식이 통째로 실패한다(실사용 테스트로 재현됨). 아래 두 헬퍼는 라벨의
// 글자 하나하나 사이에 "공백 0개 이상"을 허용하는 느슨한 정규식을 만들어
// 이 문제를 해결한다. 다만 \s*를 무제한으로 허용하면 문서 전체에 흩어진
// 무관한 글자들까지 하나의 라벨로 잘못 묶일 위험이 있으므로, 글자 사이
// 공백 개수에 상한(LABEL_GAP_MAX)을 둔다.
var LABEL_GAP_MAX = 4;

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 라벨 문자열을 받아 "글자 사이에 공백 0~LABEL_GAP_MAX개 허용" 정규식의
// 소스 문자열(다른 정규식 안에 이어붙여 재사용할 수 있도록 소스만 반환)을
// 만든다.
function buildLooseLabelSource(label) {
  return String(label)
    .split('')
    .map(function (ch) { return escapeRegExp(ch); })
    .join('\\s{0,' + LABEL_GAP_MAX + '}');
}

function buildLooseLabelRegex(label, flags) {
  return new RegExp(buildLooseLabelSource(label), flags);
}

// text.indexOf(label) 대체용: 자간에 관대하게 라벨을 찾아 매치 위치와
// "실제로 매치된 문자열의 길이"(자간 때문에 label.length보다 길 수 있음)를
// 반환한다.
function findLooseLabel(text, label, fromIndex) {
  var haystack = fromIndex ? text.slice(fromIndex) : text;
  var m = buildLooseLabelRegex(label).exec(haystack);
  if (!m) return null;
  var offset = fromIndex || 0;
  return { index: offset + m.index, length: m[0].length };
}

function sliceBetween(text, startLabel, endLabel) {
  var start = findLooseLabel(text, startLabel);
  if (!start) return null;
  var from = start.index + start.length;
  var end = endLabel ? findLooseLabel(text, endLabel, from) : null;
  return end ? text.slice(from, end.index) : text.slice(from);
}

function extractBizRegNo(text, supplierBlock) {
  if (supplierBlock) {
    var m1 = supplierBlock.match(BIZ_REG_RE);
    if (m1 && m1.length) return { value: m1[0], ambiguous: false };
  }
  var all = text.match(BIZ_REG_RE);
  if (all && all.length) return { value: all[0], ambiguous: true };
  return { value: '', ambiguous: true };
}

// "상호" 라벨과 "(법인명)" 안내문구 사이에 공백/줄바꿈이 있어도 잡아내도록
// \s*를 둔다. 다만 정규식 한 방으로 "(법인명)"이 캡처되는 경우(레이아웃이
// 예상과 달라 위 조합이 안 맞는 경우)를 대비해, 라벨 뒤 텍스트를 토큰
// 단위로 훑으며 안내문구로 보이는 토큰은 건너뛰고 실제 값 토큰을 찾는
// 폴백 로직을 둔다. "(주)회사명"처럼 실제 상호가 괄호로 시작하는 경우는
// 정상적으로 캡처되어야 하므로, 토큰 전체를 괄호 여부만으로 배제하지 않고
// "(법인명)" 자체이거나 괄호를 벗겨냈을 때 "법인명"만 남거나 빈 값인
// 경우만 안내문구로 판정한다.
var VENDOR_LABEL_RE = new RegExp(
  buildLooseLabelSource('상호') + '\\s*(?:\\(\\s*' + buildLooseLabelSource('법인명') + '\\s*\\))?\\s*[:：]?\\s*'
);

// "주식회사 신풍중기 성명 임재기"처럼 회사명 자체에 공백이 포함되고, 그
// 뒤에 곧바로 "성명" 라벨(및 그 값)이 같은 줄에 이어 붙는 서식이 있다.
// 이 경우 공백 기준 토큰 하나만 집으면 "주식회사"만 잡고 "신풍중기"를
// 놓친다. "성명" 라벨이 (느슨한 매치 기준으로) rest 안에서 발견되면 그
// 라벨 앞까지의 텍스트 전체(첫 줄만, 공백 포함)를 회사명으로 채택한다.
// "성명" 라벨이 없는 서식(회사명이 한 토큰인 경우)에서는 이 분기가 그냥
// 매치되지 않으므로 기존 토큰 단위 로직으로 자연히 폴백한다(회귀 없음).
function extractVendor(supplierBlock) {
  if (!supplierBlock) return '';
  var labelMatch = supplierBlock.match(VENDOR_LABEL_RE);
  if (!labelMatch) return '';
  var rest = supplierBlock.slice(labelMatch.index + labelMatch[0].length);

  var nameLabelMatch = buildLooseLabelRegex('성명').exec(rest);
  if (nameLabelMatch && nameLabelMatch.index > 0) {
    var candidate = rest.slice(0, nameLabelMatch.index).split('\n')[0].trim();
    if (candidate) return candidate;
  }

  var tokenRe = /[^\s\n,，]{1,40}/g;
  var m;
  while ((m = tokenRe.exec(rest))) {
    var token = m[0];
    var stripped = token.replace(/^\(+/, '').replace(/\)+$/, '');
    if (token === '(법인명)' || stripped === '법인명' || !stripped) continue;
    return token;
  }
  return '';
}

// 발행일/작성일 라벨 우선 탐색(extractAmountNear와 동일한 패턴). 라벨을
// 못 찾으면 텍스트 전체에서 폴백 탐색하되, 연도/월/일 범위를 벗어나는
// 명백히 잘못된 값(예: "1904-07-08")은 무효로 처리해 빈 값을 반환한다.
var ISSUE_DATE_LABELS = ['작성일자', '작성일', '발행일자', '발행일'];

function isValidDateParts(y, mo, d) {
  y = Number(y);
  mo = Number(mo);
  d = Number(d);
  if (y < 2000 || y > 2035) return false;
  if (mo < 1 || mo > 12) return false;
  if (d < 1 || d > 31) return false;
  return true;
}

function formatDateMatch(m) {
  var mo = ('0' + m[2]).slice(-2);
  var d = ('0' + m[3]).slice(-2);
  return m[1] + '-' + mo + '-' + d;
}

function extractIssueDate(text) {
  for (var i = 0; i < ISSUE_DATE_LABELS.length; i++) {
    var label = ISSUE_DATE_LABELS[i];
    var found = findLooseLabel(text, label);
    if (!found) continue;
    var rest = text.slice(found.index + found.length, found.index + found.length + 60);
    var m = rest.match(DATE_RE);
    if (m && isValidDateParts(m[1], m[2], m[3])) return formatDateMatch(m);
  }

  // 라벨을 못 찾았거나 라벨 근처에서 유효한 날짜를 못 찾은 경우: 텍스트
  // 전체에서 폴백 탐색하되, 범위를 벗어나는 값은 건너뛰고 다음 후보를 찾는다.
  var g = new RegExp(DATE_RE.source, 'g');
  var gm;
  while ((gm = g.exec(text))) {
    if (isValidDateParts(gm[1], gm[2], gm[3])) return formatDateMatch(gm);
  }
  return '';
}

// 라벨 뒤 60자 슬라이스 대신, 줄 단위로 재구성된 텍스트에서 "라벨이 포함된
// 줄"과(값이 없으면) "바로 다음 줄"까지만 탐색 범위로 좁힌다 — 표 레이아웃이
// 평문으로 펼쳐질 때 다른 라벨/셀의 숫자가 섞여 들어오는 것을 막기 위함.
//
// (review-v3) 다만 "다음 줄의 첫 숫자"를 무조건 집는 것만으로는 부족하다:
// 국세청 전자세금계산서 표준 서식처럼 "년 월 일 공급가액 세액 비고" 같은
// 헤더 행 바로 아래에 값 행이 여러 컬럼으로 나뉘어 있으면, 다음 줄 첫
// 숫자가 "일(day)"이나 "년도" 같은 전혀 다른 컬럼 값일 수 있다(실제로
// "년 월 일 공급가액 세액 비고\n24 06 15 10,000,000 1,000,000" 형태로
// 재현됨 — 공급가액/세액 모두 "24"로 오인식). 값이 라벨과 같은 줄에 없을
// 때는 먼저 라벨 줄을 공백 기준으로 토큰화해 라벨이 몇 번째 토큰인지 찾고,
// 다음 줄도 같은 방식으로 토큰화해 같은 인덱스의 토큰을 우선 시도한다
// (표의 마지막 컬럼(비고 등)이 비어 있어 다음 줄 토큰 수가 더 적어지는
// 흔한 경우까지 커버하기 위해, 인덱스가 다음 줄 토큰 범위 안에만 들면
// 된다). 이 컬럼 매칭이 실패하면 기존처럼 다음 줄의 첫 숫자로 폴백한다.
// 공백 기준 토큰화(split(/\s+/))는 원래 배열 인덱스만 알려줄 뿐 각 토큰의
// 원문 내 위치를 알려주지 않는다. 라벨 자체가 자간 때문에 여러 토큰으로
// 쪼개져 있을 수 있으므로(예: "공  급  가  액" → 공/급/가/액 4토큰), 토큰의
// 시작 위치(offset)도 함께 계산해 "느슨한 라벨 매치가 어느 토큰(들)에서
// 시작하는지"를 찾을 수 있게 한다.
function tokenizeWithOffsets(line) {
  var tokens = [];
  var re = /\S+/g;
  var m;
  while ((m = re.exec(line))) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return tokens;
}

// (review-v4) amountAtColumnIndex는 헤더 줄을 \S+ 기준으로 토큰화해 "라벨이
// 몇 번째 토큰인가"로 컬럼 인덱스를 셌는데, 국세청 표준 서식처럼 헤더 행의
// 라벨들이 전부(공급가액뿐 아니라 세액/합계금액 등도) 자간으로 인쇄되는
// 경우 "찾고 있는 라벨보다 앞에 나오는" 다른 라벨이 자간 때문에 여러
// 토큰으로 쪼개지면서 인덱스가 부풀려져, 완전히 엉뚱한 컬럼(예: 세액 대신
// 일(day) 컬럼)을 짚는 재현 가능한 버그가 있었다(review-v4 테스트로 발견).
// 헤더에 흔히 함께 등장하는 금액 라벨들을 미리 "자간 없는 한 토큰"으로
// 붕괴시켜 두면, 그 앞에 몇 개의 라벨이 있든 토큰 개수가 실제 컬럼 개수와
// 일치하게 된다. 문자열 길이를 그대로 유지해야 이후 buildLooseLabelRegex가
// 원본 labelLine에서 찾은 matchStart 위치가 그대로 유효하므로, 공백을
// 삭제하지 않고 공백이 아닌 자리표시 문자(U+E000, 유니코드 사용자 영역 —
// 실제 텍스트에 나타날 일이 없고, 원시 NUL 문자와 달리 grep 등 텍스트
// 도구가 파일을 바이너리로 오인하지 않는다)로 치환한다.
var KNOWN_COLUMN_LABELS = ['공급가액', '세액', '부가세', '합계금액', '청구금액', '비고'];

function collapseKnownLabelGaps(line) {
  KNOWN_COLUMN_LABELS.forEach(function (lbl) {
    var re = buildLooseLabelRegex(lbl, 'g');
    line = line.replace(re, function (matched) { return matched.replace(/\s/g, ''); });
  });
  return line;
}

function amountAtColumnIndex(labelLine, label, valueLine) {
  var headerTokens = tokenizeWithOffsets(collapseKnownLabelGaps(labelLine));
  var labelMatch = buildLooseLabelRegex(label).exec(labelLine);
  var idx = -1;
  if (labelMatch) {
    var matchStart = labelMatch.index;
    for (var i = 0; i < headerTokens.length; i++) {
      if (matchStart >= headerTokens[i].start && matchStart < headerTokens[i].end) { idx = i; break; }
    }
    if (idx === -1) {
      // 매치 시작 지점이 토큰 사이 공백일 수 있음(라벨이 자간으로 쪼개진
      // 경우) - 매치 시작 지점 이후 첫 토큰을 사용한다.
      for (var j = 0; j < headerTokens.length; j++) {
        if (headerTokens[j].start >= matchStart) { idx = j; break; }
      }
    }
  }
  if (idx === -1) return null;
  var valueTokens = valueLine.split(/\s+/).filter(Boolean);
  if (idx >= valueTokens.length) return null;
  var m = valueTokens[idx].match(/[\d,]+/);
  return m ? m[0] : null;
}

// (실사용 원문 대응) 라벨 행과 값 행 사이에 빈 줄이 하나 이상 끼어 있는
// 서식이 있다("작성일자 공급가액 세액 수정사유 비고" 다음 줄이 빈 줄이고,
// 그다음에야 "2026-07-31 350,000 35,000 ..." 값 행이 나온 실제 사례로
// 재현됨). 또한 "합계금액"처럼 라벨 바로 다음에 값이 아니라 "이 금액을
// (청구) 함" 같은 고정 문구가 먼저 나오고, 몇 줄 더 지나야 숫자 단독 줄이
// 나오는 서식도 있다. 이를 위해 라벨 줄 다음의 "내용이 있는"(공백만 있거나
// 완전히 빈 줄은 건너뛴) 줄들을 최대 AMOUNT_SEARCH_MAX_LINES개까지 후보로
// 모으고, 아래 우선순위로 값을 채택한다:
//   1) 표 컬럼 인덱스 매칭(가장 가까운 후보부터) - 여러 컬럼이 한 줄에
//      섞여 있는 표 형태 값 행에 가장 신뢰도가 높다.
//   2) 컬럼 매칭이 모두 실패하면, 후보 줄 중 숫자(쉼표 포함)만으로 이루어진
//      단독 줄("385,000" 같은) - 사이에 낀 무관한 문구를 건너뛰고 채택.
//   3) 그것도 없으면 기존처럼 후보 줄에서 첫 숫자 패턴을 폴백으로 채택.
var AMOUNT_SEARCH_MAX_LINES = 5;

function isPureNumberLine(line) {
  return /^[\d,]+$/.test(line.trim());
}

function collectNonEmptyLineIndices(lines, fromIndex, maxCount) {
  var result = [];
  for (var i = fromIndex; i < lines.length && result.length < maxCount; i++) {
    if (lines[i].trim() !== '') result.push(i);
  }
  return result;
}

function extractAmountNear(text, labels) {
  var lines = text.split('\n');
  for (var i = 0; i < labels.length; i++) {
    var label = labels[i];
    var labelRe = buildLooseLabelRegex(label);
    for (var li = 0; li < lines.length; li++) {
      var found = labelRe.exec(lines[li]);
      if (!found) continue;

      // 라벨과 같은 줄에 숫자가 있으면 최우선으로 채택(기존 동작 유지).
      var scope = lines[li].slice(found.index + found[0].length);
      var sameLineMatch = scope.match(/[\d,]+/);
      if (sameLineMatch) return parseNumber(sameLineMatch[0]);

      var candidates = collectNonEmptyLineIndices(lines, li + 1, AMOUNT_SEARCH_MAX_LINES);
      var c;

      for (c = 0; c < candidates.length; c++) {
        var colValue = amountAtColumnIndex(lines[li], label, lines[candidates[c]]);
        if (colValue) return parseNumber(colValue);
      }

      for (c = 0; c < candidates.length; c++) {
        if (isPureNumberLine(lines[candidates[c]])) {
          return parseNumber(lines[candidates[c]].trim());
        }
      }

      for (c = 0; c < candidates.length; c++) {
        var fallbackMatch = lines[candidates[c]].match(/[\d,]+/);
        if (fallbackMatch) return parseNumber(fallbackMatch[0]);
      }

      break; // 라벨은 찾았지만 근처에 숫자 후보가 전혀 없음 - 이 라벨은 포기
    }
  }
  return null;
}

function extractWorkType(text) {
  for (var i = 0; i < WORK_TYPE_KEYWORDS.length; i++) {
    if (text.indexOf(WORK_TYPE_KEYWORDS[i]) !== -1) return WORK_TYPE_KEYWORDS[i];
  }
  return '';
}

function extractFieldsFromText(text) {
  text = text || '';
  var supplierBlock = sliceBetween(text, '공급자', '공급받는자');

  var bizRegResult = extractBizRegNo(text, supplierBlock);
  var vendor = extractVendor(supplierBlock) || extractVendor(text);
  var issueDate = extractIssueDate(text);
  var supplyAmount = extractAmountNear(text, ['공급가액']);
  var vat = extractAmountNear(text, ['세액', '부가세']);
  var total = extractAmountNear(text, ['합계금액', '청구금액']);
  var workType = extractWorkType(text);

  var amountsPresent = supplyAmount !== null && vat !== null && total !== null;
  var amountsConsistent = amountsPresent && (supplyAmount + vat === total);

  var missingRequired = !issueDate || !vendor || !bizRegResult.value || !supplyAmount;

  var resolvedSupply = supplyAmount || 0;
  var resolvedVat = vat !== null ? vat : calcVat(resolvedSupply);
  var resolvedTotal = total !== null ? total : calcTotal(resolvedSupply, resolvedVat);

  var needsReview = missingRequired || bizRegResult.ambiguous || !amountsConsistent;

  // "공란 삭제": 필수 필드(발행일/거래처/사업자등록번호/공급가액) 4개 중
  // 3개 이상이 비어있거나 0이면 인식이 사실상 실패한 것으로 보고, 호출부
  // (processOneFile)에서 isTaxInvoiceDocument가 false일 때와 동일하게
  // 목록에 행을 추가하지 않도록 이 플래그를 넘긴다. 최소 2개 이상 필드가
  // 채워졌다면(=emptyRequiredCount <= 2) 정상적으로 목록에 남겨 needsReview로
  // 사용자가 확인하게 둔다.
  var requiredFieldValues = [issueDate, vendor, bizRegResult.value, supplyAmount];
  var emptyRequiredCount = requiredFieldValues.filter(function (v) { return !v; }).length;
  var recognitionFailed = emptyRequiredCount >= 3;

  return {
    issueDate: issueDate,
    vendor: vendor,
    workType: workType,
    bizRegNo: formatBizRegNo(bizRegResult.value),
    supplyAmount: resolvedSupply,
    vat: resolvedVat,
    total: resolvedTotal,
    needsReview: needsReview,
    recognitionFailed: recognitionFailed
  };
}

// ---------------------------------------------------------------------
// PDF.js / Tesseract.js 인식 파이프라인
// ---------------------------------------------------------------------
function buildTextFromItems(items) {
  var lines = [];
  var currentY = null;
  var currentLine = [];

  // PDF.js 텍스트 아이템의 transform은 [scaleX, skewX, skewY, scaleY, x, y]
  // 형태다(transform[4]가 x좌표, transform[5]가 y좌표). 같은 줄(y좌표
  // 그룹) 안에서는 원래 배열 순서가 아니라 x좌표 오름차순으로 정렬한 뒤
  // 이어붙여야, 표 레이아웃에서 좌우 순서가 뒤섞이지 않는다.
  //
  // (review-v3) 단순히 str을 이어붙이기(join('')) 만으로는 부족하다: 표
  // 형태 서식(예: 실제 전자세금계산서의 "년/월/일/공급가액/세액/비고" 컬럼)은
  // 각 셀이 PDF 안에서 서로 다른 텍스트 아이템으로 분리되어 있고, 셀과 셀
  // 사이에는 공백 문자가 전혀 포함되어 있지 않은 경우가 흔하다(공백은 시각적
  // 여백일 뿐 텍스트가 아님). 이 경우 join('')은 "공급가액"과 그 옆 셀의
  // 숫자를 공백 없이 그대로 붙여버리고, 값 행에서도 여러 컬럼의 숫자가
  // 전부 한 덩어리로 이어져(예: "24"+"06"+"15"+"10,000,000"+"1,000,000"
  // → "240615" + "10,000,000" + "1,000,000") extractAmountNear가 완전히
  // 엉뚱한 거대한 숫자를 뽑아내는 재현 가능한 버그로 이어진다(테스트 PDF로
  // 재현됨). 같은 줄 안에서 인접한 두 아이템 사이에 실제 시각적 간격(이전
  // 아이템의 오른쪽 끝 x좌표보다 다음 아이템의 x좌표가 일정 폭 이상 떨어져
  // 있음)이 있으면 그 사이에 공백 한 칸을 끼워 넣어 셀 경계를 보존한다.
  // 진짜 한 단어가 폰트/서브셋 문제로 아이템이 쪼개진 경우는 보통 글자끼리
  // 거의 붙어있거나 겹치므로(간격이 0에 가깝거나 음수), 작은 임계값(1pt)
  // 이하의 간격에는 공백을 넣지 않아 그런 경우까지 잘못 갈라놓지 않는다.
  var CELL_GAP_THRESHOLD = 1;

  function flushLine() {
    if (currentLine.length) {
      currentLine.sort(function (a, b) { return a.x - b.x; });
      var text = '';
      var prevEnd = null;
      currentLine.forEach(function (it) {
        if (prevEnd !== null && it.x - prevEnd > CELL_GAP_THRESHOLD) text += ' ';
        text += it.str;
        prevEnd = it.x + (it.width || 0);
      });
      lines.push(text);
    }
    currentLine = [];
  }

  items.forEach(function (item) {
    var y = item.transform ? item.transform[5] : null;
    var x = item.transform ? item.transform[4] : 0;
    if (currentY === null || (y !== null && Math.abs(y - currentY) > 2)) {
      flushLine();
      currentY = y;
    }
    currentLine.push({ x: x, width: item.width || 0, str: item.str });
    if (item.hasEOL) {
      flushLine();
      currentY = null;
    }
  });
  flushLine();
  return lines.join('\n');
}

// Tesseract.js 워커는 파일이 실제로 있을 때만 지연 생성한다(첫 이미지/
// 스캔PDF 처리 시점에 1회 초기화). 언어 데이터(kor.traineddata 등, 수 MB)를
// 그때 CDN에서 내려받는다.
var tesseractWorkerPromise = null;
function getTesseractWorker() {
  if (!tesseractWorkerPromise) {
    if (typeof Tesseract === 'undefined') {
      return Promise.reject(new Error('Tesseract.js를 불러오지 못했습니다.'));
    }
    tesseractWorkerPromise = Tesseract.createWorker(['kor', 'eng']);
  }
  return tesseractWorkerPromise;
}

async function recognizeImage(imageSource) {
  var worker = await getTesseractWorker();
  var result = await worker.recognize(imageSource);
  return (result && result.data && result.data.text) || '';
}

// isTaxInvoiceDocument(text) — 추출된 텍스트가 세금계산서인지, 거래명세표/
// 거래명세서 등 다른 서식인지 판별한다. 세금계산서가 아니라고 판정된 파일은
// extractFieldsFromText()로 넘기지 않고 조용히 무시한다(processOneFile 참고).
//
// 텍스트가 사실상 비어있는 경우(추출/OCR 자체가 실패한 경우)는 이 함수가
// 다루는 대상이 아니다 — 호출하는 쪽에서 TEXT_MIN_LENGTH 기준으로 걸러낸
// 뒤에만 이 함수를 사용해야 한다(기존의 "빈 텍스트 → 확인 필요" 처리를
// 그대로 유지하기 위함).
function isTaxInvoiceDocument(text) {
  text = text || '';
  if (buildLooseLabelRegex('거래명세표').test(text) || buildLooseLabelRegex('거래명세서').test(text)) return false;
  if (buildLooseLabelRegex('세금계산서').test(text)) return true;
  var hasSupplierLabel = buildLooseLabelRegex('공급자').test(text);
  var hasVatLabel = buildLooseLabelRegex('세액').test(text) || buildLooseLabelRegex('부가세').test(text);
  return hasSupplierLabel && hasVatLabel;
}

// 텍스트가 판별하기에 충분한 분량인지(=extractPdfInvoiceData의 OCR 폴백
// 기준과 동일한 TEXT_MIN_LENGTH 임계값을 재사용).
function hasSubstantialText(text) {
  return !!text && text.replace(/\s/g, '').length >= TEXT_MIN_LENGTH;
}

async function extractPdfInvoiceData(file) {
  var arrayBuffer = await file.arrayBuffer();
  var pdf = await pdfjsLib.getDocument({
    data: arrayBuffer,
    cMapUrl: PDFJS_CMAP_URL,
    cMapPacked: true
  }).promise;
  var page = await pdf.getPage(1);
  var textContent = await page.getTextContent();
  var text = buildTextFromItems(textContent.items);

  if (text.replace(/\s/g, '').length >= TEXT_MIN_LENGTH) {
    if (!isTaxInvoiceDocument(text)) return { skip: true };
    var fields = extractFieldsFromText(text);
    return Object.assign({}, fields, { parseMethod: 'pdf-text', rawText: text });
  }

  // 임베드 텍스트가 없는 스캔 PDF: 페이지를 캔버스에 렌더링한 뒤 OCR로 폴백.
  var viewport = page.getViewport({ scale: 2 });
  var canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  var ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: viewport }).promise;
  var ocrText = await recognizeImage(canvas);
  if (hasSubstantialText(ocrText) && !isTaxInvoiceDocument(ocrText)) return { skip: true };
  var ocrFields = extractFieldsFromText(ocrText);
  ocrFields.needsReview = true; // OCR 결과는 예외 없이 확인 필요로 강제
  return Object.assign({}, ocrFields, { parseMethod: 'ocr', rawText: ocrText });
}

async function extractImageInvoiceData(file) {
  var text = await recognizeImage(file);
  if (hasSubstantialText(text) && !isTaxInvoiceDocument(text)) return { skip: true };
  var fields = extractFieldsFromText(text);
  fields.needsReview = true;
  return Object.assign({}, fields, { parseMethod: 'ocr', rawText: text });
}

function getExtension(name) {
  var m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

async function processOneFile(file, invoiceId) {
  var ext = getExtension(file.name);
  var result = null;
  try {
    if (ext === 'pdf') {
      result = await extractPdfInvoiceData(file);
    } else if (IMAGE_EXT_RE.test(ext)) {
      result = await extractImageInvoiceData(file);
    }
  } catch (err) {
    result = null;
  }

  if (result && (result.skip || result.recognitionFailed)) {
    // 세금계산서 형식이 아닌 문서(거래명세표/거래명세서 등)로 판별되었거나
    // (result.skip), 형식은 맞지만 텍스트 품질이 나빠 필수 필드 대부분을
    // 못 뽑아 인식이 사실상 실패한 경우(result.recognitionFailed) 모두
    // 요구사항대로 조용히 무시한다 — 낙관적으로 추가해둔 임시 행과 저장된
    // 원본 blob을 제거할 뿐, 알림이나 콘솔 로그는 남기지 않는다.
    state.invoices = state.invoices.filter(function (r) { return String(r.id) !== String(invoiceId); });
    deleteStoredFile(invoiceId);
    return;
  }

  var row = findInvoice(invoiceId);
  if (!row) return;

  if (result) {
    row.issueDate = result.issueDate;
    row.vendor = result.vendor;
    row.workType = result.workType;
    row.bizRegNo = result.bizRegNo;
    row.supplyAmount = result.supplyAmount;
    row.vat = result.vat;
    row.total = result.total;
    row.parseMethod = result.parseMethod;
    row.needsReview = result.needsReview;
    row.rawText = result.rawText || '';
  } else {
    row.parseMethod = 'failed';
    row.needsReview = true;
  }
}

// 여러 파일을 한 번에 올렸을 때 순차 큐로 하나씩 처리한다(Tesseract 워커
// 동시 실행 시 리소스 경합 방지).
var processingQueue = Promise.resolve();

function enqueueFile(file, sourceInfo) {
  var invoiceId = state.invoicesNextId++;
  var row = {
    id: invoiceId,
    fileName: file.name,
    fileSource: sourceInfo.fileSource,
    issueDate: '',
    vendor: '',
    workType: '',
    bizRegNo: '',
    supplyAmount: 0,
    vat: 0,
    total: 0,
    projectName: '',
    parseMethod: 'failed',
    needsReview: true,
    rawText: '',
    linkedProjectRowId: null
  };
  state.invoices.push(row);
  processingIds[invoiceId] = true;
  saveInvoicesState();
  renderInvoiceTable();

  var storePromise = sourceInfo.fileSource === 'blob'
    ? storeFileBlob(invoiceId, file).catch(function () { /* 저장 실패해도 인식은 계속 진행 */ })
    : Promise.resolve();

  processingQueue = processingQueue
    .then(function () { return storePromise; })
    .then(function () { return processOneFile(file, invoiceId); })
    .catch(function (err) { console.error(err); })
    .then(function () {
      delete processingIds[invoiceId];
      saveInvoicesState();
      renderInvoiceTable();
    });

  return processingQueue;
}

async function retryRecognition(invoiceId) {
  var row = findInvoice(invoiceId);
  if (!row) return;
  var file = await resolveInvoiceFile(row);
  if (!file) {
    alert('원본 파일을 찾을 수 없어 다시 인식할 수 없습니다. 폴더를 다시 연결하거나 원본을 다시 업로드해주세요.');
    return;
  }
  processingIds[row.id] = true;
  renderInvoiceTable();
  processOneFile(file, row.id)
    .catch(function (err) { console.error(err); })
    .then(function () {
      delete processingIds[row.id];
      saveInvoicesState();
      renderInvoiceTable();
    });
}

// ---------------------------------------------------------------------
// IndexedDB: settlement-invoices-db
//   handles 스토어 — 연결한 계산서 폴더 핸들(FS Access API)
//   files 스토어   — fileSource:"blob" 계산서의 원본 바이트(업로드/폴백)
// ---------------------------------------------------------------------
var INV_DB_NAME = 'settlement-invoices-db';
var INV_DB_HANDLES_STORE = 'handles';
var INV_DB_FILES_STORE = 'files';
var INV_DB_FOLDER_KEY = 'dataFolder';

function openInvoicesDb() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(INV_DB_NAME, 1);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(INV_DB_HANDLES_STORE)) db.createObjectStore(INV_DB_HANDLES_STORE);
      if (!db.objectStoreNames.contains(INV_DB_FILES_STORE)) db.createObjectStore(INV_DB_FILES_STORE);
    };
    req.onsuccess = function () { resolve(req.result); };
    req.onerror = function () { reject(req.error); };
  });
}

function saveInvoiceFolderHandle(handle) {
  return openInvoicesDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(INV_DB_HANDLES_STORE, 'readwrite');
      tx.objectStore(INV_DB_HANDLES_STORE).put(handle, INV_DB_FOLDER_KEY);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

function loadInvoiceFolderHandle() {
  return openInvoicesDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(INV_DB_HANDLES_STORE, 'readonly');
      var req = tx.objectStore(INV_DB_HANDLES_STORE).get(INV_DB_FOLDER_KEY);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  });
}

function storeFileBlob(id, file) {
  return openInvoicesDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(INV_DB_FILES_STORE, 'readwrite');
      tx.objectStore(INV_DB_FILES_STORE).put(file, id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  });
}

function getStoredFile(id) {
  return openInvoicesDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(INV_DB_FILES_STORE, 'readonly');
      var req = tx.objectStore(INV_DB_FILES_STORE).get(id);
      req.onsuccess = function () { resolve(req.result || null); };
      req.onerror = function () { reject(req.error); };
    });
  }).catch(function () { return null; });
}

function deleteStoredFile(id) {
  return openInvoicesDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(INV_DB_FILES_STORE, 'readwrite');
      tx.objectStore(INV_DB_FILES_STORE).delete(id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { resolve(); };
    });
  }).catch(function () { /* 무시 */ });
}

// ---------------------------------------------------------------------
// 원본 파일 조회/열기
// ---------------------------------------------------------------------
var connectedInvoiceDirHandle = null;

function supportsFsAccess() {
  return typeof window.showDirectoryPicker === 'function';
}

async function resolveInvoiceFile(row) {
  if (row.fileSource === 'blob') {
    return getStoredFile(row.id);
  }
  if (row.fileSource === 'folder') {
    if (!connectedInvoiceDirHandle) return null;
    try {
      var perm = await connectedInvoiceDirHandle.requestPermission({ mode: 'read' });
      if (perm !== 'granted') return null;
      var fh = await connectedInvoiceDirHandle.getFileHandle(row.fileName);
      return await fh.getFile();
    } catch (e) {
      return null;
    }
  }
  return null;
}

function openFileInNewTab(file) {
  var url = URL.createObjectURL(file);
  window.open(url, '_blank');
  setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
}

async function viewOriginal(invoiceId) {
  var row = findInvoice(invoiceId);
  if (!row) return;

  if (row.fileSource === 'folder' && !connectedInvoiceDirHandle) {
    alert('먼저 "폴더 연결" 버튼으로 계산서 폴더를 연결해주세요.');
    return;
  }

  var file = await resolveInvoiceFile(row);
  if (!file) {
    if (row.fileSource !== 'missing') {
      row.fileSource = 'missing';
      saveInvoicesState();
      renderInvoiceTable();
    }
    alert('"' + row.fileName + '" 원본을 찾을 수 없습니다(파일 이동/삭제 또는 폴더 연결 해제로 추정됩니다). 인식된 값(발행일/거래처 등)은 그대로 보존되어 있으니, 폴더를 다시 연결하거나 같은 이름의 파일을 다시 업로드해 복구를 시도해주세요.');
    return;
  }
  openFileInNewTab(file);
}

// ---------------------------------------------------------------------
// 계산서 폴더 연결 (index.html의 데이터 폴더 연결과 동일한 UX 패턴을
// 재현하되, 완전히 독립된 IndexedDB를 사용하고 대상 확장자만 다르다)
// ---------------------------------------------------------------------
async function scanInvoiceDirHandle(dirHandle) {
  var entries = [];
  for await (const entry of dirHandle.values()) {
    if (entry.kind === 'file' && INVOICE_EXT_RE.test(entry.name)) entries.push(entry);
  }
  entries.sort(function (a, b) { return a.name.localeCompare(b.name); });
  return entries;
}

function knownFileNames() {
  var set = {};
  state.invoices.forEach(function (r) { set[r.fileName] = true; });
  return set;
}

async function importNewFilesFromFolder(dirHandle) {
  var entries = await scanInvoiceDirHandle(dirHandle);
  var known = knownFileNames();
  var newEntries = entries.filter(function (e) { return !known[e.name]; });

  if (!newEntries.length) {
    setFolderStatus('연결됨: ' + dirHandle.name + ' (새 파일 없음)');
    return;
  }
  setFolderStatus('연결됨: ' + dirHandle.name + ' (새 파일 ' + newEntries.length + '건 인식 중…)');
  for (var i = 0; i < newEntries.length; i++) {
    var file = await newEntries[i].getFile();
    enqueueFile(file, { fileSource: 'folder' });
  }
}

function useInvoiceDirHandle(dirHandle) {
  connectedInvoiceDirHandle = dirHandle;
  saveInvoiceFolderHandle(dirHandle).catch(function () { /* 저장 실패해도 이번 세션은 계속 사용 가능 */ });
  return importNewFilesFromFolder(dirHandle);
}

function onFolderError(err) {
  if (err && err.name === 'AbortError') return;
  if (err && err.name === 'PermissionDenied') {
    alert('폴더 접근 권한이 거부되었습니다.');
    return;
  }
  alert('폴더를 여는 데 실패했습니다: ' + (err && err.message ? err.message : err));
}

function connectFolder() {
  if (!supportsFsAccess()) {
    var fb = document.getElementById('folder-input-fallback');
    if (fb) fb.click();
    return;
  }
  var request = connectedInvoiceDirHandle
    ? connectedInvoiceDirHandle.requestPermission({ mode: 'read' }).then(function (perm) {
        if (perm !== 'granted') throw { name: 'PermissionDenied' };
        return connectedInvoiceDirHandle;
      })
    : window.showDirectoryPicker({ mode: 'read' });
  Promise.resolve(request).then(useInvoiceDirHandle).catch(onFolderError);
}

function pickNewFolder() {
  if (!supportsFsAccess()) {
    var fb = document.getElementById('folder-input-fallback');
    if (fb) fb.click();
    return;
  }
  window.showDirectoryPicker({ mode: 'read' }).then(useInvoiceDirHandle).catch(onFolderError);
}

function refreshFolder() {
  if (supportsFsAccess() && connectedInvoiceDirHandle) {
    // 페이지를 새로고침하면 핸들은 IndexedDB에서 복원되지만 읽기 권한은
    // 브라우저가 자동으로 유지해주지 않는다("prompt" 상태로 돌아감).
    // 권한 확인 없이 바로 values()를 호출하면 "The request is not allowed
    // by the user agent..." 오류가 난다 - 여기서 먼저 권한을 요청한다
    // (사용자의 클릭 이벤트 안에서 바로 호출해야 브라우저가 허용한다).
    connectedInvoiceDirHandle.requestPermission({ mode: 'read' }).then(function (perm) {
      if (perm !== 'granted') throw { name: 'PermissionDenied' };
      return importNewFilesFromFolder(connectedInvoiceDirHandle);
    }).catch(function (err) {
      if (err && err.name === 'PermissionDenied') {
        alert('폴더 접근 권한이 필요합니다. "폴더 연결" 버튼을 눌러 권한을 다시 허용해주세요.');
        return;
      }
      alert('폴더를 다시 읽는 데 실패했습니다: ' + (err && err.message ? err.message : err));
    });
  } else {
    connectFolder();
  }
}

function setFolderStatus(text) {
  var el = document.getElementById('folder-status');
  if (el) el.textContent = text;
}

function bindFolderFallbackInput() {
  var input = document.getElementById('folder-input-fallback');
  if (!input) return;
  input.addEventListener('change', function () {
    var files = Array.prototype.slice.call(input.files).filter(function (f) {
      return INVOICE_EXT_RE.test(f.name);
    });
    if (!input.files.length) return;
    var folderName = input.files[0].webkitRelativePath
      ? input.files[0].webkitRelativePath.split('/')[0]
      : '선택한 폴더';
    setFolderStatus('연결됨: ' + folderName + ' (이 브라우저는 폴더를 기억하지 못해 다음에 열 때 다시 선택해야 합니다)');
    var known = knownFileNames();
    files.filter(function (f) { return !known[f.name]; }).forEach(function (f) {
      enqueueFile(f, { fileSource: 'blob' });
    });
    input.value = '';
  });
}

function bindFolderButtons() {
  var connectBtn = document.getElementById('btn-connect-folder');
  var changeBtn = document.getElementById('btn-change-folder');
  var refreshBtn = document.getElementById('btn-refresh-folder');
  if (connectBtn) connectBtn.addEventListener('click', connectFolder);
  if (changeBtn) changeBtn.addEventListener('click', pickNewFolder);
  if (refreshBtn) refreshBtn.addEventListener('click', refreshFolder);
  bindFolderFallbackInput();
}

function tryReconnectFolder() {
  if (!supportsFsAccess()) return;
  loadInvoiceFolderHandle().then(function (handle) {
    if (!handle) return;
    return handle.queryPermission({ mode: 'read' }).then(function (perm) {
      connectedInvoiceDirHandle = handle;
      if (perm === 'granted') {
        return importNewFilesFromFolder(handle);
      }
      setFolderStatus('이전에 연결한 폴더: ' + handle.name + ' (다시 연결하려면 "폴더 연결" 버튼을 눌러주세요)');
    });
  }).catch(function () { /* 저장된 연결 정보가 없거나 접근할 수 없음 - 무시 */ });
}

// ---------------------------------------------------------------------
// 업로드 (드래그앤드롭 + 파일 선택 버튼)
// ---------------------------------------------------------------------
function handleFileList(fileList) {
  var files = Array.prototype.slice.call(fileList).filter(function (f) {
    return INVOICE_EXT_RE.test(f.name) || /^image\//.test(f.type) || f.type === 'application/pdf';
  });
  files.forEach(function (f) { enqueueFile(f, { fileSource: 'blob' }); });
}

function bindUpload() {
  var dropzone = document.getElementById('dropzone');
  var fileInput = document.getElementById('file-input');
  var pickBtn = document.getElementById('btn-pick-files');

  pickBtn.addEventListener('click', function (e) {
    e.stopPropagation();
    fileInput.click();
  });
  dropzone.addEventListener('click', function () { fileInput.click(); });
  dropzone.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  fileInput.addEventListener('change', function () {
    handleFileList(fileInput.files);
    fileInput.value = '';
  });

  ['dragenter', 'dragover'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.add('is-dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    dropzone.addEventListener(evt, function (e) {
      e.preventDefault();
      dropzone.classList.remove('is-dragover');
    });
  });
  dropzone.addEventListener('drop', function (e) {
    if (e.dataTransfer && e.dataTransfer.files) handleFileList(e.dataTransfer.files);
  });
}

// ---------------------------------------------------------------------
// 렌더링
// ---------------------------------------------------------------------
function statusBadgeHtml(row) {
  if (processingIds[row.id]) {
    return '<span class="badge badge-processing"><span class="badge-spinner" aria-hidden="true"></span>인식 중…</span>';
  }
  if (row.fileSource === 'missing') {
    return '<span class="badge badge-missing">원본 유실</span>';
  }
  if (row.needsReview) {
    return '<span class="badge badge-review">확인 필요</span>';
  }
  return '<span class="badge-ok">완료</span>';
}

function refreshStatusCell(tr, row) {
  var td = tr.children[9]; // 순번(0)~공사명(8) 다음 10번째 칸(index 9) = 상태
  if (td) td.innerHTML = statusBadgeHtml(row);
}

function updateUploadProgressText() {
  var el = document.getElementById('upload-progress');
  if (!el) return;
  var n = Object.keys(processingIds).length;
  el.textContent = n > 0 ? (n + '건 인식 중…') : '';
}

function renderInvoiceTable() {
  var tbody = document.getElementById('invoice-body');
  var filterSelect = document.getElementById('project-filter');
  var filter = filterSelect ? filterSelect.value : '';
  var rows = state.invoices.filter(function (r) { return !filter || r.projectName === filter; });

  var html = '';
  rows.forEach(function (row, idx) {
    html +=
      '<tr data-id="' + row.id + '">' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><input type="date" data-field="issueDate" value="' + escapeAttr(row.issueDate) + '"></td>' +
      '<td><input type="text" data-field="vendor" value="' + escapeAttr(row.vendor) + '"></td>' +
      '<td><input type="text" data-field="workType" value="' + escapeAttr(row.workType) + '"></td>' +
      '<td><input type="text" inputmode="numeric" maxlength="12" placeholder="000-00-00000" data-field="bizRegNo" value="' + escapeAttr(row.bizRegNo) + '"></td>' +
      '<td><input type="text" inputmode="numeric" data-money="true" data-field="supplyAmount" value="' + formatNumber(row.supplyAmount) + '"></td>' +
      '<td><input type="text" inputmode="numeric" data-money="true" data-field="vat" value="' + formatNumber(row.vat) + '"></td>' +
      '<td><input type="text" inputmode="numeric" data-money="true" data-field="total" value="' + formatNumber(row.total) + '"></td>' +
      '<td><input type="text" list="project-suggestions" data-field="projectName" placeholder="공사명 입력" value="' + escapeAttr(row.projectName) + '"></td>' +
      '<td>' + statusBadgeHtml(row) + '</td>' +
      '<td><div class="row-actions">' +
      '<button type="button" class="btn-row-action" data-action="view">원본</button>' +
      '<button type="button" class="btn-row-action" data-action="retry">재인식</button>' +
      '<button type="button" class="btn-row-action" data-action="rawtext">텍스트</button>' +
      '</div></td>' +
      '<td><button type="button" class="btn-row-action" data-action="delete" aria-label="삭제">삭제</button></td>' +
      '</tr>';
  });

  tbody.innerHTML = html || '<tr><td colspan="12" class="folder-empty">업로드된 계산서가 없습니다. 위에서 파일을 올리거나 폴더를 연결해보세요.</td></tr>';

  renderProjectFilterOptions();
  renderProjectSuggestions();
  renderGenerateSummary();
  updateUploadProgressText();
}

function renderProjectFilterOptions() {
  var select = document.getElementById('project-filter');
  if (!select) return;
  var names = {};
  state.invoices.forEach(function (r) { if (r.projectName) names[r.projectName] = true; });
  var sorted = Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'ko'); });
  var current = select.value;

  if (document.activeElement === select) return;

  var html = '<option value="">전체</option>';
  sorted.forEach(function (name) {
    html += '<option value="' + escapeAttr(name) + '">' + escapeAttr(name) + '</option>';
  });
  select.innerHTML = html;
  if (current === '' || sorted.indexOf(current) !== -1) select.value = current;
}

function renderProjectSuggestions() {
  var datalist = document.getElementById('project-suggestions');
  if (!datalist) return;
  var names = {};
  state.invoices.forEach(function (r) { if (r.projectName) names[r.projectName] = true; });
  SettlementShared.getSavedProjectNames().forEach(function (n) { names[n] = true; });
  var html = '';
  Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'ko'); }).forEach(function (name) {
    html += '<option value="' + escapeAttr(name) + '"></option>';
  });
  datalist.innerHTML = html;
}

function renderGenerateSummary() {
  var filterSelect = document.getElementById('project-filter');
  var summaryEl = document.getElementById('generate-summary');
  var filter = filterSelect ? filterSelect.value : '';
  if (!filter) {
    summaryEl.hidden = true;
    return;
  }
  var rows = state.invoices.filter(function (r) { return r.projectName === filter; });
  var supply = 0, vat = 0, total = 0;
  rows.forEach(function (r) {
    supply += Number(r.supplyAmount) || 0;
    vat += Number(r.vat) || 0;
    total += Number(r.total) || 0;
  });
  document.getElementById('gen-count').textContent = String(rows.length);
  document.getElementById('gen-supply').textContent = formatNumber(supply);
  document.getElementById('gen-vat').textContent = formatNumber(vat);
  document.getElementById('gen-total').textContent = formatNumber(total);
  summaryEl.hidden = false;
}

// ---------------------------------------------------------------------
// 목록 테이블 이벤트 위임(셀 수정 + 행 액션) — settlement.js와 동일하게
// <tbody> 하나에 input/click 리스너를 한 번씩만 등록한다.
// ---------------------------------------------------------------------
function bindInvoiceTableEvents() {
  var tbody = document.getElementById('invoice-body');

  tbody.addEventListener('input', function (e) {
    var target = e.target;
    var field = target.dataset.field;
    if (!field) return;
    var tr = target.closest('tr[data-id]');
    if (!tr) return;
    var row = findInvoice(tr.getAttribute('data-id'));
    if (!row) return;

    if (field === 'projectName' && row.projectName !== target.value && row.linkedProjectRowId) {
      // 이미 어떤 정산서에 반영된 계산서라도, 공사명을 다른 값으로 바꾸면
      // 그 연결은 "예전 공사명" 기준이므로 더 이상 유효하지 않다 — 풀어줘야
      // 새 공사명으로 "정산서 생성"할 때 이 계산서가 반영 대상에 포함된다.
      row.linkedProjectRowId = null;
    }

    if (target.dataset.money === 'true') {
      row[field] = parseNumber(target.value);
    } else if (field === 'bizRegNo') {
      var caret = target.selectionStart;
      var beforeLen = target.value.length;
      var formatted = formatBizRegNo(target.value);
      row.bizRegNo = formatted;
      target.value = formatted;
      var newCaret = caret + (formatted.length - beforeLen);
      if (newCaret < 0) newCaret = 0;
      if (newCaret > formatted.length) newCaret = formatted.length;
      try { target.setSelectionRange(newCaret, newCaret); } catch (e2) { /* 일부 브라우저 미지원 - 무시 */ }
    } else {
      row[field] = target.value;
    }

    // 공사명은 애초에 자동인식 대상이 아니므로, 이 필드를 채운 것만으로는
    // "자동인식 결과를 검수해서 확정했다"는 의미가 아니다 — needsReview에는
    // 영향을 주지 않는다. 그 외 필드는 사용자가 직접 고쳤다는 뜻이므로
    // needsReview를 내리고 parseMethod를 manual로 바꾼다.
    if (field !== 'projectName') {
      row.needsReview = false;
      row.parseMethod = 'manual';
      refreshStatusCell(tr, row);
    }

    saveInvoicesState();

    if (field === 'projectName' || field === 'supplyAmount' || field === 'vat' || field === 'total') {
      renderProjectFilterOptions();
      renderProjectSuggestions();
      renderGenerateSummary();
    }
  });

  tbody.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var tr = btn.closest('tr[data-id]');
    if (!tr) return;
    var id = tr.getAttribute('data-id');
    var action = btn.getAttribute('data-action');

    if (action === 'delete') {
      var row = findInvoice(id);
      var ok = confirm('"' + (row ? row.fileName : '이 계산서') + '" 항목을 목록에서 삭제할까요?\n(연결된 폴더의 원본 파일 자체는 삭제되지 않습니다)');
      if (!ok) return;
      deleteStoredFile(id);
      state.invoices = state.invoices.filter(function (r) { return String(r.id) !== String(id); });
      saveInvoicesState();
      renderInvoiceTable();
    } else if (action === 'view') {
      viewOriginal(id);
    } else if (action === 'retry') {
      retryRecognition(id);
    } else if (action === 'rawtext') {
      var r = findInvoice(id);
      // prompt()는 내용을 선택/복사하기 쉬워 진단용으로 쓴다(임시 기능).
      prompt('"' + (r ? r.fileName : '') + '"에서 추출된 텍스트 (Ctrl+A, Ctrl+C로 복사):', (r && r.rawText) || '(추출된 텍스트 없음)');
    }
  });
}

// ---------------------------------------------------------------------
// 공사명별 그룹핑 → 정산서 자동 생성 (spec-v2-invoice.md 3.4)
// ---------------------------------------------------------------------
function makeSubcontractRowFromInvoice(newId, invoice) {
  var row = SettlementShared.makeSubcontractRow(newId);
  row.workType = invoice.workType || '';
  row.issueDate = invoice.issueDate || '';
  row.vendor = invoice.vendor || '';
  row.bizRegNo = invoice.bizRegNo || '';
  row.supplyAmount = parseNumber(invoice.supplyAmount);
  // 계산서가 있다는 것 자체가 전자세금계산서 발행 근거이므로 true로 채운다.
  row.taxInvoiceIssued = true;
  // paidAmount는 makeSubcontractRow() 기본값(0)을 그대로 둔다 — 실제 결제
  // 여부와 무관하게 자동 생성 시에는 항상 0에서 시작해야 하는 규칙(spec 3.4).
  return row;
}

// 네이티브 confirm()은 2지선다만 가능하므로, "병합/새로만들기/취소" 3가지
// 선택지를 연쇄된 confirm() 두 단계로 구현한다: 1단계에서 권장 선택지인
// 병합을 우선 제시하고, 취소를 누르면 2단계에서 "새로 만들기"를 제시하며,
// 새로 만들기는 데이터 손실이 크므로 한 번 더 강하게 확인한다.
function promptMergeChoice(projectName, newCount) {
  var mergeOk = confirm(
    '"' + projectName + '"은 이미 생성된 정산서가 있습니다.\n' +
    '새로 필터된 계산서 ' + newCount + '건을 기존 정산서에 병합할까요?\n' +
    '(기존에 입력한 결제금액/계좌정보 등은 그대로 유지됩니다)\n\n' +
    '확인 = 병합(권장)   /   취소 = 다른 방법 선택'
  );
  if (mergeOk) return 'merge';

  var overwriteAsk = confirm(
    '병합 대신 "' + projectName + '" 정산서를 완전히 새로 만들까요?\n' +
    '기존에 입력한 결제금액/계좌정보 등 수정 내역이 모두 사라집니다.\n\n' +
    '확인 = 새로 만들기(기존 내용 삭제)   /   취소 = 아무 것도 하지 않음'
  );
  if (!overwriteAsk) return null;

  var finalConfirm = confirm(
    '정말 진행할까요? "' + projectName + '"의 기존 정산서 내용(결제금액/계좌정보 등)이 모두 삭제되고 새로 생성됩니다. 되돌릴 수 없습니다.'
  );
  return finalConfirm ? 'overwrite' : null;
}

function generateSettlementForProject(projectName) {
  if (!projectName) return;

  var invoicesForProject = state.invoices.filter(function (r) { return r.projectName === projectName; });
  var unlinkedInvoices = invoicesForProject.filter(function (r) { return !r.linkedProjectRowId; });

  var savedProjects = SettlementShared.loadSavedProjects();
  var existing = savedProjects[projectName];
  var mode;

  if (existing) {
    if (!unlinkedInvoices.length) {
      // 새로 반영할 계산서는 없지만, (이번 수정 이전 버전으로 처음 만들어진
      // 정산서라면) 자리표시로 남아있는 빈 행이 있을 수 있으니 그것만이라도
      // 정리해준다.
      var normalized = SettlementShared.normalizeState(existing);
      var cleaned = normalized.subcontract.filter(function (r) {
        return r.workType || r.issueDate || r.vendor || r.bizRegNo || r.supplyAmount;
      });
      if (cleaned.length !== normalized.subcontract.length) {
        normalized.subcontract = cleaned;
        SettlementShared.saveProjectByName(projectName, normalized);
        alert('"' + projectName + '"의 계산서는 이미 모두 정산서에 반영되어 있습니다. 남아있던 빈 행만 정리했습니다.');
      } else {
        alert('"' + projectName + '"의 계산서는 이미 모두 정산서에 반영되어 있습니다. 새로 추가된 계산서가 없습니다.');
      }
      return;
    }
    mode = promptMergeChoice(projectName, unlinkedInvoices.length);
    if (!mode) return;
  } else {
    if (!unlinkedInvoices.length) {
      alert('"' + projectName + '"으로 필터된 계산서가 없습니다.');
      return;
    }
    mode = 'create';
  }

  var targetState;
  var invoicesToLink = unlinkedInvoices;

  if (mode === 'merge') {
    targetState = SettlementShared.normalizeState(existing);
    // 이 정산서가 (이번 수정 이전 버전으로) 처음 자동 생성됐을 때 딸려온
    // 빈 자리표시 행이 남아있을 수 있다 — 병합 시점에도 제거해 정리한다.
    // 사용자가 실제로 입력하다 만 행까지 지우지 않도록, 모든 필드가
    // 비어있는 행만 대상으로 한다.
    targetState.subcontract = targetState.subcontract.filter(function (r) {
      return r.workType || r.issueDate || r.vendor || r.bizRegNo || r.supplyAmount;
    });
  } else {
    // create 또는 overwrite: 완전히 새로운 빈 정산서에서 시작한다.
    // createEmptyState()는 사용자가 수기로 입력할 때를 위해 빈 행을 하나
    // 기본으로 넣어두는데, 계산서로 자동 생성할 때는 그 자리표시 행이
    // 실제 데이터 행들 맨 앞에 빈 줄로 그대로 남아 헷갈리므로 비워둔다.
    targetState = SettlementShared.createEmptyState();
    targetState.subcontract = [];
    targetState.projectInfo.name = projectName;
    if (mode === 'overwrite') {
      // 기존에 반영됐던 계산서도 전부 다시 반영 대상이 되도록 링크를 초기화한다.
      invoicesForProject.forEach(function (r) { r.linkedProjectRowId = null; });
      invoicesToLink = invoicesForProject;
    }
  }

  invoicesToLink.forEach(function (inv) {
    var newId = targetState.subcontractNextId++;
    var row = makeSubcontractRowFromInvoice(newId, inv);
    targetState.subcontract.push(row);
    inv.linkedProjectRowId = row.id;
  });

  SettlementShared.saveProjectByName(projectName, targetState);
  saveInvoicesState();
  renderInvoiceTable();

  var resultEl = document.getElementById('generate-result');
  var actionLabel = mode === 'merge' ? '병합했습니다' : (mode === 'overwrite' ? '새로 생성했습니다(기존 내용 대체)' : '새로 생성했습니다');
  if (resultEl) {
    resultEl.innerHTML =
      '"' + escapeAttr(projectName) + '" 정산서에 계산서 ' + invoicesToLink.length + '건을 ' + actionLabel + '.<br>' +
      '<a href="index.html">정산서 작성 화면 열기</a> 후 "저장된 정산서 불러오기"에서 "' + escapeAttr(projectName) + '"를 선택하면 확인할 수 있습니다.' +
      '(결제금액은 항상 0에서 시작하니, 실제 지급을 확인하며 직접 입력해주세요.)';
  }
}

// ---------------------------------------------------------------------
// 공통 바인딩(날짜 피커/금액 콤마 포맷) — settlement.js와 동일한 패턴.
// ---------------------------------------------------------------------
function bindDatePickers() {
  document.addEventListener('click', function (e) {
    var el = e.target;
    if (el && el.tagName === 'INPUT' && el.type === 'date' && typeof el.showPicker === 'function') {
      try { el.showPicker(); } catch (err) { /* 미지원 브라우저이거나 이미 열려있음 - 무시 */ }
    }
  });
}

function bindMoneyFormatting() {
  document.addEventListener('focusin', function (e) {
    var el = e.target;
    if (el && el.tagName === 'INPUT' && el.dataset && el.dataset.money === 'true') {
      var n = parseNumber(el.value);
      el.value = n === 0 ? '' : String(n);
    }
  });
  document.addEventListener('focusout', function (e) {
    var el = e.target;
    if (el && el.tagName === 'INPUT' && el.dataset && el.dataset.money === 'true') {
      el.value = formatNumber(parseNumber(el.value));
    }
  });
}

// ---------------------------------------------------------------------
// 초기화
// ---------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', function () {
  state = loadInvoicesState();

  bindUpload();
  bindInvoiceTableEvents();
  bindFolderButtons();
  bindMoneyFormatting();
  bindDatePickers();

  var filterSelect = document.getElementById('project-filter');
  if (filterSelect) filterSelect.addEventListener('change', renderInvoiceTable);

  var generateBtn = document.getElementById('btn-generate');
  if (generateBtn) {
    generateBtn.addEventListener('click', function () {
      var filter = document.getElementById('project-filter').value;
      if (!filter) return;
      generateSettlementForProject(filter);
    });
  }

  var themeBtn = document.getElementById('theme-toggle');
  if (themeBtn) themeBtn.addEventListener('click', SettlementShared.toggleTheme);
  SettlementShared.updateThemeToggleIcon(document.documentElement.getAttribute('data-theme'));

  if (!supportsFsAccess()) {
    setFolderStatus('이 브라우저는 폴더 연결을 지원하지 않아 "폴더 연결" 버튼이 폴더 선택 창으로 대체됩니다.');
  }
  tryReconnectFolder();

  renderInvoiceTable();
});
