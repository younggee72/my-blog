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
var INVOICE_EXT_RE = /\.(pdf|jpe?g|png|webp|heic|xlsx|xls)$/i;
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
  var invoices = Array.isArray(parsed.invoices) ? parsed.invoices : empty.invoices;
  // (v7) 홈택스 목록 기능 이전에 저장된 행에는 direction/approvalNo/blobKey/
  // sourceRow가 없다 — 모두 "매입, 승인번호 없음, 원본은 id 키"로 채워
  // 기존 동작과 똑같이 보이게 한다.
  invoices.forEach(function (r) {
    if (!r || typeof r !== 'object') return;
    if (r.direction !== 'sales' && r.direction !== 'purchase') r.direction = 'purchase';
    if (typeof r.approvalNo !== 'string') r.approvalNo = '';
    if (r.blobKey === undefined) r.blobKey = null;
    if (r.sourceRow === undefined) r.sourceRow = null;
  });
  return {
    invoices: invoices,
    invoicesNextId: parsed.invoicesNextId || empty.invoicesNextId
  };
}

function getDirection(row) {
  return row && row.direction === 'sales' ? 'sales' : 'purchase';
}

// 홈택스 목록에서 가져온 행인지(재인식 대상이 아님). 셀을 직접 고치면
// parseMethod가 'manual'로 바뀌므로 승인번호/원본 줄 번호로도 판단한다.
function isHometaxListRow(row) {
  return !!row && (row.parseMethod === 'hometax-list' || !!row.approvalNo || row.sourceRow != null);
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

// 엑셀 셀 값(문자열/숫자/날짜/수식결과/리치텍스트/하이퍼링크 등 ExcelJS가
// 반환할 수 있는 형태들)을 하나의 평문 문자열로 변환한다. 날짜는
// extractIssueDate가 기대하는 "YYYY-M-D" 계열 패턴(DATE_RE)에 맞도록
// YYYY-MM-DD로 포맷한다. 금액은 콤마 없는 raw 숫자일 수 있는데,
// extractAmountNear/amountAtColumnIndex가 쓰는 /[\d,]+/ 정규식은 콤마가
// 아예 없는 순수 숫자 문자열에도 정상적으로 매치되므로(콤마는 "있어도
// 되는" 문자일 뿐 필수가 아님) 별도 포맷 없이 String()으로 충분하다.
function excelCellValueToString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    var y = value.getFullYear();
    var mo = ('0' + (value.getMonth() + 1)).slice(-2);
    var d = ('0' + value.getDate()).slice(-2);
    return y + '-' + mo + '-' + d;
  }
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) {
      return value.richText.map(function (rt) { return rt.text || ''; }).join('');
    }
    if (value.formula !== undefined) {
      return excelCellValueToString(value.result);
    }
    if (value.text !== undefined) return String(value.text);
    return '';
  }
  return String(value);
}

// 워크시트 하나를 행 단위로 순회해 하나의 평문 텍스트로 합친다
// (extractExcelInvoiceData와 findInvoiceSheetText에서 공유).
//
// (review-v5) 병합 셀(예: "상호" 라벨 칸을 A8:B8로 병합)이 있으면 ExcelJS는
// 병합 범위 안의 "주인이 아닌" 칸(slave cell)도 cell.value로 주인 칸(master
// cell)과 동일한 값을 그대로 돌려준다(진짜로 각 칸에 중복 저장돼 있는 게
// 아니라 조회 시 위임되는 것). 이를 그대로 이어붙이면 "상호 상호
// 실제회사명"처럼 라벨이 중복돼, 텍스트 기반 추출기가 두 번째 "상호"를
// 값으로 오인하는 버그가 실제 테스트로 재현됐다. 병합 범위의 주인이 아닌
// 칸(cell.isMerged && cell.master !== cell)은 건너뛰어 한 번만 반영한다.
function worksheetToText(worksheet) {
  var lines = [];
  worksheet.eachRow({ includeEmpty: false }, function (row) {
    var cellTexts = [];
    row.eachCell({ includeEmpty: false }, function (cell) {
      if (cell.isMerged && cell.master !== cell) return;
      var str = excelCellValueToString(cell.value).trim();
      if (str) cellTexts.push(str);
    });
    if (cellTexts.length) lines.push(cellTexts.join(' '));
  });
  return lines.join('\n');
}

// extractExcelInvoiceData(file) — PDF/이미지와 나란한 엑셀(.xlsx) 추출
// 경로. ExcelJS로 워크북을 읽어 텍스트로 합친 뒤, 그 이후는 다른 경로와
// 완전히 동일하게 isTaxInvoiceDocument()로 세금계산서 여부를 가리고
// extractFieldsFromText() 하나로만 필드를 뽑는다(로직 이중화 금지,
// spec-v2-invoice.md 3.2).
//
// (review-v5) 처음에는 첫 워크시트만 읽었는데, 표지/요약 시트가 앞에 있고
// 실제 세금계산서 내용은 두 번째(또는 그 이후) 시트에 있는 실사용 파일로
// 재현되는 문제가 있었다 — 이 경우 첫 시트 텍스트는 세금계산서로 판별되지
// 않거나(짧아서) 내용이 통째로 비어, 파일이 조용히 "인식 실패"로 목록에서
// 사라져 사용자가 원인을 알 길이 없었다. 이제 모든 시트를 순서대로 훑어
// isTaxInvoiceDocument()로 "세금계산서로 보이는" 첫 시트를 찾아 그 시트의
// 텍스트를 사용한다. 어떤 시트도 세금계산서로 보이지 않으면(예: 진짜
// "거래명세표" 파일이거나 완전히 빈 워크북) 기존과 동일하게 첫 시트 텍스트로
// 폴백해 이후의 skip/미인식 판정 로직을 그대로 탄다(단일 시트 파일의 기존
// 동작은 100% 그대로 유지됨 — 그 경우 이 폴백이 곧 기존 동작 자체이므로).
function findInvoiceSheetText(workbook) {
  var worksheets = workbook.worksheets || [];
  for (var i = 0; i < worksheets.length; i++) {
    var text = worksheetToText(worksheets[i]);
    if (isTaxInvoiceDocument(text)) return text;
  }
  return worksheets.length ? worksheetToText(worksheets[0]) : '';
}

async function extractExcelInvoiceData(file) {
  var workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());

  // (v7) 홈택스 목록 판별을 단건 인식보다 먼저 한다 — 목록 텍스트에도
  // "세금계산서/공급자/세액"이 들어 있어 단건으로 잘못 합쳐질 수 있다.
  var hometax = detectHometaxInWorkbook((workbook.worksheets || []).map(function (ws) {
    return { name: ws.name, grid: worksheetToGrid(ws) };
  }), file.name);
  if (hometax.list) return { hometaxList: hometax.list };
  if (hometax.nearMiss) reportHometaxNearMiss(file.name);

  var text = findInvoiceSheetText(workbook);

  // PDF 텍스트 경로와 동일한 원칙: 세금계산서 형식이 아닌 것으로 판별되면
  // 조용히 무시한다. 엑셀 셀 텍스트는 항상 "임베드 텍스트"가 있는 것과
  // 동일한 신뢰도이므로(OCR 아님) OCR 폴백이나 needsReview 강제는 없다.
  if (hasSubstantialText(text) && !isTaxInvoiceDocument(text)) return { skip: true };
  var fields = extractFieldsFromText(text);
  return Object.assign({}, fields, { parseMethod: 'excel', rawText: text });
}

// extractXlsInvoiceData(file) — extractExcelInvoiceData(.xlsx/ExcelJS)와
// 나란한, 구버전 바이너리 엑셀(.xls) 경로. ExcelJS는 OOXML(.xlsx)만 읽을 수
// 있어 .xls는 읽지 못하므로, .xls만 별도로 SheetJS(전역 XLSX, invoices.html에
// CDN 추가)로 읽는다. 기존 .xlsx/ExcelJS 경로는 이 함수와 별개로 그대로
// 둔다(회귀 위험 최소화).
//
// 셀 값 변환은 excelCellValueToString을 그대로 재사용한다 — SheetJS도
// 날짜 셀은 cellDates:true 옵션으로 읽으면 ExcelJS와 동일하게 Date 인스턴스를
// 돌려주고, 문자열/숫자 셀은 excelCellValueToString의 마지막 String(value)
// 분기로 그대로 처리되므로 별도 변환 로직을 중복 작성할 필요가 없다.
//
// (review-v5 재발 방지) worksheetToText가 병합 셀의 "주인 아닌" 칸을
// 건너뛰어 라벨 중복을 막은 것과 같은 목적으로, SheetJS의 sheet['!merges']
// (각 {s:{r,c}, e:{r,c}})를 훑어 병합 범위의 왼쪽 위 칸이 아닌 좌표는 모두
// 건너뛰는 스킵 집합을 만든다. XLSX.utils.sheet_to_txt/sheet_to_csv 같은
// 내장 유틸은 병합 셀 처리 방식이 달라 같은 버그가 재발할 수 있으므로 쓰지
// 않고, worksheetToText와 동일한 원칙으로 셀을 직접 순회한다.
function buildXlsMergeSkipSet(sheet) {
  var skip = {};
  var merges = sheet['!merges'] || [];
  merges.forEach(function (m) {
    for (var r = m.s.r; r <= m.e.r; r++) {
      for (var c = m.s.c; c <= m.e.c; c++) {
        if (r === m.s.r && c === m.s.c) continue; // 병합 범위의 주인 칸(왼쪽 위) - 유지
        skip[r + ',' + c] = true;
      }
    }
  });
  return skip;
}

// SheetJS 워크시트(sheet) 하나를 worksheetToText와 같은 형태(행 단위,
// 셀은 공백으로 join, 행은 개행으로 join)의 평문 텍스트로 변환한다.
function xlsSheetToText(sheet) {
  var ref = sheet && sheet['!ref'];
  if (!ref) return '';
  var range = XLSX.utils.decode_range(ref);
  var skip = buildXlsMergeSkipSet(sheet);
  var lines = [];
  for (var r = range.s.r; r <= range.e.r; r++) {
    var cellTexts = [];
    for (var c = range.s.c; c <= range.e.c; c++) {
      if (skip[r + ',' + c]) continue;
      var cell = sheet[XLSX.utils.encode_cell({ r: r, c: c })];
      if (!cell) continue;
      var str = excelCellValueToString(cell.v).trim();
      if (str) cellTexts.push(str);
    }
    if (cellTexts.length) lines.push(cellTexts.join(' '));
  }
  return lines.join('\n');
}

// findInvoiceSheetText(ExcelJS workbook)와 같은 목적을 SheetJS API에 맞게
// 구현: 여러 시트 중 "세금계산서로 보이는" 첫 시트를 찾고, 없으면 첫 시트로
// 폴백한다(단일 시트 파일의 기존 동작과 동일하게 귀결).
function findXlsInvoiceSheetText(workbook) {
  var sheetNames = (workbook && workbook.SheetNames) || [];
  for (var i = 0; i < sheetNames.length; i++) {
    var text = xlsSheetToText(workbook.Sheets[sheetNames[i]]);
    if (isTaxInvoiceDocument(text)) return text;
  }
  return sheetNames.length ? xlsSheetToText(workbook.Sheets[sheetNames[0]]) : '';
}

// extractXlsInvoiceData(file) — .xls 전용 진입점. 이후 단계(세금계산서 여부
// 판별, 필드 추출)는 다른 세 경로(PDF/이미지/.xlsx)와 완전히 동일하게
// isTaxInvoiceDocument()/extractFieldsFromText() 하나로만 처리한다(로직
// 이중화 금지, spec-v2-invoice.md 3.2). parseMethod는 .xlsx와 동일하게
// 'excel'을 재사용한다(사용자에게는 "엑셀에서 읽음"이라는 같은 신뢰도로
// 노출하면 충분하고, xls/xlsx를 구분해 보여줄 필요가 없다).
async function extractXlsInvoiceData(file) {
  var workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });

  // (v7) 홈택스 목록 판별 먼저(extractExcelInvoiceData와 같은 이유).
  var hometax = detectHometaxInWorkbook(((workbook && workbook.SheetNames) || []).map(function (name) {
    return { name: name, grid: xlsSheetToGrid(workbook.Sheets[name]) };
  }), file.name);
  if (hometax.list) return { hometaxList: hometax.list };
  if (hometax.nearMiss) reportHometaxNearMiss(file.name);

  var text = findXlsInvoiceSheetText(workbook);

  if (hasSubstantialText(text) && !isTaxInvoiceDocument(text)) return { skip: true };
  var fields = extractFieldsFromText(text);
  return Object.assign({}, fields, { parseMethod: 'excel', rawText: text });
}

// ---------------------------------------------------------------------
// (v7) 홈택스 "전자(세금)계산서 목록조회(매출/매입)" 엑셀 일괄 불러오기
// (spec-v7-hometax.md 3.2~3.8). 파일 1개 = 계산서 여러 건.
// ---------------------------------------------------------------------

// 셀 값을 grid용 값으로: 숫자는 숫자로, Date는 Date로 두고(금액/날짜
// 파싱용), 나머지는 excelCellValueToString과 같은 규칙의 문자열로.
function gridCellValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value;
  if (typeof value === 'object' && value.formula !== undefined) return gridCellValue(value.result);
  if (typeof value === 'object' && value.sharedFormula !== undefined) return gridCellValue(value.result);
  return excelCellValueToString(value);
}

// ExcelJS 워크시트 → grid[r][c] (0부터, grid 행 번호 + 1 = 엑셀 행 번호).
// worksheetToText와 달리 빈 칸도 자리를 지켜 열 위치가 밀리지 않는다.
// 병합 범위의 주인 아닌 칸은 ''(review-v5 규칙)이고, 주인 좌표는
// grid.masterOf에 기억해 2줄 헤더(세로/가로 병합) 해석에 쓴다.
function worksheetToGrid(worksheet) {
  var grid = [];
  grid.masterOf = {};
  if (!worksheet) return grid;
  var rowCount = worksheet.rowCount || 0;
  var colCount = worksheet.columnCount || 0;
  for (var r = 1; r <= rowCount; r++) {
    var row = worksheet.getRow(r);
    var cells = [];
    for (var c = 1; c <= colCount; c++) {
      var cell = row.getCell(c);
      if (cell.isMerged && cell.master && cell.master !== cell) {
        grid.masterOf[(r - 1) + ',' + (c - 1)] = [cell.master.row - 1, cell.master.col - 1];
        cells.push('');
        continue;
      }
      cells.push(gridCellValue(cell.value));
    }
    grid.push(cells);
  }
  return grid;
}

// SheetJS 시트 → grid (xlsSheetToText와 같은 !ref 순회 + buildXlsMergeSkipSet).
function xlsSheetToGrid(sheet) {
  var grid = [];
  grid.masterOf = {};
  var ref = sheet && sheet['!ref'];
  if (!ref) return grid;
  var range = XLSX.utils.decode_range(ref);
  var skip = buildXlsMergeSkipSet(sheet);
  (sheet['!merges'] || []).forEach(function (m) {
    for (var mr = m.s.r; mr <= m.e.r; mr++) {
      for (var mc = m.s.c; mc <= m.e.c; mc++) {
        if (mr === m.s.r && mc === m.s.c) continue;
        grid.masterOf[mr + ',' + mc] = [m.s.r, m.s.c];
      }
    }
  });
  for (var r = 0; r <= range.e.r; r++) {
    var cells = [];
    for (var c = 0; c <= range.e.c; c++) {
      if (r < range.s.r || c < range.s.c || skip[r + ',' + c]) { cells.push(''); continue; }
      var cell = sheet[XLSX.utils.encode_cell({ r: r, c: c })];
      cells.push(cell ? gridCellValue(cell.v) : '');
    }
    grid.push(cells);
  }
  return grid;
}

function normHeader(s) {
  if (s === null || s === undefined) return '';
  if (s instanceof Date) return '';
  return String(s).replace(/\s+/g, '').replace(/（/g, '(').replace(/）/g, ')');
}

function cellIsEmpty(v) {
  return v === '' || v === null || v === undefined || (typeof v === 'string' && !v.trim());
}

var HOMETAX_HEADER_SCAN_ROWS = 30;

// 위쪽 30행 안에서 "승인번호"가 들어간 칸과 "공급가액"과 정확히 같은 칸이
// 함께 있는 첫 행을 헤더 행으로 본다. 승인번호만 있고 공급가액이 없는 행을
// 봤다면 nearMiss로 알린다(5장).
// 홈택스 화면/엑셀에 따라 승인번호 열이 없을 수도 있어, 공급가액 + 작성일자 +
// "…등록번호" 열이 함께 있는 행도 헤더 행으로 인정한다(이 경우 중복은
// 작성일자+상대방 사업자번호+공급가액+세액 조합으로 판단).
function findHometaxHeaderRow(grid) {
  var nearMiss = false;
  var max = Math.min(grid.length, HOMETAX_HEADER_SCAN_ROWS);
  for (var r = 0; r < max; r++) {
    var hasApproval = false, hasSupply = false, hasWriteDate = false, hasBizNo = false;
    (grid[r] || []).forEach(function (v) {
      var n = normHeader(v);
      if (n.indexOf('승인번호') !== -1) hasApproval = true;
      if (n === '공급가액') hasSupply = true;
      if (n === '작성일자' || n === '작성일') hasWriteDate = true;
      if (n.indexOf('등록번호') !== -1 && n.indexOf('품목') !== 0) hasBizNo = true;
    });
    if (hasSupply && (hasApproval || (hasWriteDate && hasBizNo))) {
      // 2줄 헤더: 이 줄에 "공급자/공급받는자" 묶음 제목이 있고 바로 아래 줄에
      // 하위 열 이름(등록번호/상호 …)이 있으면, 아래 줄을 헤더 행으로 쓴다
      // (세로 병합된 작성일자·공급가액 등은 buildHeaderNames가 위 줄에서 채움).
      var isGroupRow = (grid[r] || []).some(function (v) {
        var n = normHeader(v);
        return n === '공급자' || n === '공급받는자';
      });
      var nextHasSub = (grid[r + 1] || []).some(function (v) {
        var n = normHeader(v);
        return n === '등록번호' || n === '사업자등록번호' || n === '상호';
      });
      return { headerRow: isGroupRow && nextHasSub ? r + 1 : r, nearMiss: nearMiss };
    }
    // (review) 단건 전자세금계산서 양식도 위쪽에 "승인번호" 칸이 있으므로,
    // 같은 줄에 목록 머리글(작성일자/…등록번호)이 함께 있을 때만 nearMiss로 본다
    // — 아니면 평범한 단건 엑셀마다 "목록처럼 보이지만…" 경고가 뜬다.
    if (hasApproval && (hasWriteDate || hasBizNo)) nearMiss = true;
  }
  return { headerRow: -1, nearMiss: nearMiss };
}

// 헤더 행의 열 이름(정규화). 세로 병합으로 헤더 칸이 비어 있으면 병합
// 주인(위쪽 묶음 줄) 칸의 이름을 쓴다(예: "작성일자"가 4~5행 병합).
function buildHeaderNames(grid, headerRow) {
  var row = grid[headerRow] || [];
  var names = [];
  var originals = [];
  for (var c = 0; c < row.length; c++) {
    var v = row[c];
    if (cellIsEmpty(v)) {
      var m = grid.masterOf && grid.masterOf[headerRow + ',' + c];
      if (m && m[1] === c && grid[m[0]]) v = grid[m[0]][m[1]];
    }
    names.push(normHeader(v));
    originals.push(cellIsEmpty(v) ? '' : String(v).replace(/\s+/g, ' ').trim());
  }
  return { names: names, originals: originals };
}

// 헤더 바로 위 줄의 "공급자/공급받는자" 묶음 제목을 열별 그룹으로 기억한다.
function buildHeaderGroups(grid, headerRow, colCount) {
  var groups = [];
  for (var i = 0; i < colCount; i++) groups.push(null);
  if (headerRow < 1) return groups;
  var above = grid[headerRow - 1] || [];
  var r = headerRow - 1;
  var found = false;
  for (var c = 0; c < colCount; c++) {
    var n = normHeader(above[c]);
    var g = null;
    if (n.indexOf('공급받는자') !== -1) g = 'buyer';
    else if (n.indexOf('공급자') !== -1) g = 'supplier';
    if (!g) continue;
    found = true;
    groups[c] = g;
    var hasMerge = false;
    for (var c2 = c + 1; c2 < colCount; c2++) {
      var m = grid.masterOf && grid.masterOf[r + ',' + c2];
      if (m && m[0] === r && m[1] === c) { groups[c2] = g; hasMerge = true; }
    }
    if (!hasMerge) {
      // 병합 정보가 없으면 다음 제목 칸 전까지를 같은 묶음으로 본다.
      for (var c3 = c + 1; c3 < colCount; c3++) {
        if (!cellIsEmpty(above[c3]) || (grid.masterOf && grid.masterOf[r + ',' + c3])) break;
        groups[c3] = g;
      }
    }
  }
  return found ? groups : groups.map(function () { return null; });
}

function colLetter(c) {
  var s = '';
  c = c + 1;
  while (c > 0) {
    var m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

var HOMETAX_PAIRED_FIELDS = [
  { base: '상호', supplier: 'supplierName', buyer: 'buyerName', label: '상호' },
  { base: '대표자명', supplier: 'supplierCeo', buyer: 'buyerCeo', label: '대표자명' },
  { base: '종사업장번호', supplier: 'supplierSubNo', buyer: 'buyerSubNo', label: '종사업장번호' },
  { base: '주소', supplier: 'supplierAddr', buyer: 'buyerAddr', label: '주소' }
];

var HOMETAX_SIMPLE_FIELDS = [
  { key: 'writeDate', cands: ['작성일자', '작성일'] },
  { key: 'approvalNo', cands: ['승인번호'] },
  { key: 'issueDate', cands: ['발급일자'] },
  { key: 'sendDate', cands: ['전송일자'] },
  { key: 'supplyAmount', cands: ['공급가액'], exactOnly: true },
  { key: 'vat', cands: ['세액'], exactOnly: true },
  { key: 'total', cands: ['합계금액', '합계'] },
  { key: 'category', cands: ['전자세금계산서분류'] },
  { key: 'kind', cands: ['전자세금계산서종류'] },
  { key: 'issueType', cands: ['발급유형'] },
  { key: 'note', cands: ['비고'], exactOnly: true },
  { key: 'receiptType', cands: ['영수/청구구분', '영수청구구분'] },
  { key: 'itemName', cands: ['품목명'], item: true },
  { key: 'itemSpec', cands: ['품목규격'], item: true },
  { key: 'itemQty', cands: ['품목수량'], item: true },
  { key: 'itemPrice', cands: ['품목단가'], item: true },
  { key: 'itemSupply', cands: ['품목공급가액'], item: true },
  { key: 'itemVat', cands: ['품목세액'], item: true },
  { key: 'itemNote', cands: ['품목비고'], item: true },
  { key: 'itemDate', cands: ['품목일자'], item: true }
];

// 이름으로 열 찾기: 정확히 같은 열 먼저, 없으면 포함하는 열(exactOnly 제외).
// 품목 필드는 "품목" 접두사 열만, 그 외 필드는 "품목" 접두사 열을 보지 않는다.
function findHeaderCol(names, cands, opts) {
  opts = opts || {};
  var used = opts.used || {};
  function eligible(c) {
    var n = names[c];
    if (!n || used[c]) return false;
    var isItem = n.indexOf('품목') === 0;
    return opts.item ? isItem : !isItem;
  }
  for (var i = 0; i < cands.length; i++) {
    for (var c = 0; c < names.length; c++) {
      if (eligible(c) && names[c] === cands[i]) return c;
    }
  }
  if (opts.exactOnly) return -1;
  for (var j = 0; j < cands.length; j++) {
    for (var c2 = 0; c2 < names.length; c2++) {
      if (eligible(c2) && names[c2].indexOf(cands[j]) !== -1) return c2;
    }
  }
  return -1;
}

function mapHometaxColumns(names, groups) {
  var cols = {};
  var guessed = [];
  var guessedVendorCols = false;
  var used = {};

  HOMETAX_SIMPLE_FIELDS.forEach(function (f) {
    var c = findHeaderCol(names, f.cands, { exactOnly: f.exactOnly, item: f.item });
    if (c !== -1) cols[f.key] = c;
  });

  // 사업자등록번호: 접두사가 붙은 이름 먼저
  var s = findHeaderCol(names, ['공급자사업자등록번호', '공급자등록번호']);
  var b = findHeaderCol(names, ['공급받는자사업자등록번호', '공급받는자등록번호']);
  if (s === -1 || b === -1) {
    // 그냥 "등록번호"/"사업자등록번호"가 두 번 나오는 경우
    var plain = [];
    names.forEach(function (n, c) {
      if (n === '등록번호' || n === '사업자등록번호') plain.push(c);
    });
    var bySupplierGroup = plain.filter(function (c) { return groups[c] === 'supplier'; });
    var byBuyerGroup = plain.filter(function (c) { return groups[c] === 'buyer'; });
    if (s === -1 && bySupplierGroup.length) s = bySupplierGroup[0];
    if (b === -1 && byBuyerGroup.length) b = byBuyerGroup[0];
    var rest = plain.filter(function (c) { return c !== s && c !== b; });
    if ((s === -1 || b === -1) && rest.length) {
      if (s === -1 && b === -1) {
        if (rest.length >= 2) { s = rest[0]; b = rest[1]; }
      } else if (s === -1) {
        s = rest[0];
      } else {
        b = rest[0];
      }
      if (s !== -1 && b !== -1) {
        guessed.push('공급자/공급받는자 열을 순서로 추정했습니다(첫 번째 등록번호 = 공급자, 두 번째 = 공급받는자). 거래처가 맞는지 확인해주세요.');
        guessedVendorCols = true;
      }
    }
  }
  if (s !== -1) { cols.supplierBizNo = s; used[s] = true; }
  if (b !== -1) { cols.buyerBizNo = b; used[b] = true; }
  // 상대방 한 세트만 있는 목록(예: 매출 목록조회 화면의 "공급받는자등록번호
  // (종사업장 번호)", 상호, 대표자명 …)
  var singleSide = (s !== -1 && b === -1) ? 'supplier' : ((b !== -1 && s === -1) ? 'buyer' : null);

  HOMETAX_PAIRED_FIELDS.forEach(function (f) {
    // 1) 이름에 접두사가 있는 경우
    var sc = findHeaderCol(names, ['공급자' + f.base]);
    var bc = findHeaderCol(names, ['공급받는자' + f.base]);
    function isBase(c) {
      var n = names[c];
      return !!n && (n === f.base || (n.indexOf(f.base) === 0 && n.indexOf('공급') === -1));
    }
    // 2) 위치 규칙: 각 사업자등록번호 열 뒤, 다른 쪽 번호 열을 넘지 않는 첫 열
    if ((sc === -1 || bc === -1) && s !== -1 && b !== -1) {
      for (var c = 0; c < names.length; c++) {
        if (!isBase(c)) continue;
        if (s < b) {
          if (sc === -1 && c > s && c < b) sc = c;
          if (bc === -1 && c > b) bc = c;
        } else {
          if (bc === -1 && c > b && c < s) bc = c;
          if (sc === -1 && c > s) sc = c;
        }
      }
    }
    // 2-b) 한 세트만 있으면 그 번호 열 뒤의 첫 열(없으면 아무 위치의 첫 열)
    if (singleSide) {
      var only = singleSide === 'supplier' ? s : b;
      var picked = -1, anyCol = -1;
      for (var c1 = 0; c1 < names.length; c1++) {
        if (!isBase(c1)) continue;
        if (anyCol === -1) anyCol = c1;
        if (picked === -1 && c1 > only) picked = c1;
      }
      if (picked === -1) picked = anyCol;
      if (singleSide === 'supplier' && sc === -1) sc = picked;
      if (singleSide === 'buyer' && bc === -1) bc = picked;
    }
    // 3) 2줄 헤더 그룹 정보
    if (sc === -1 || bc === -1) {
      for (var c2 = 0; c2 < names.length; c2++) {
        if (!isBase(c2)) continue;
        if (sc === -1 && groups[c2] === 'supplier') sc = c2;
        if (bc === -1 && groups[c2] === 'buyer') bc = c2;
      }
    }
    if (sc !== -1) cols[f.supplier] = sc;
    if (bc !== -1) cols[f.buyer] = bc;
  });

  var missingRequired = [];
  if (cols.writeDate == null) missingRequired.push('작성일자');
  if (cols.vat == null) missingRequired.push('세액');
  if (cols.total == null) missingRequired.push('합계금액');
  if (!singleSide) {
    if (cols.supplierBizNo == null) missingRequired.push('공급자 사업자등록번호');
    if (cols.buyerBizNo == null) missingRequired.push('공급받는자 사업자등록번호');
  }

  return { cols: cols, missingRequired: missingRequired, guessed: guessed, guessedVendorCols: guessedVendorCols, singleSide: singleSide };
}

// 헤더 위쪽 제목/조회조건 셀 + 시트 이름으로 매출/매입 판별. 둘 다 있거나
// 둘 다 없으면 null. 파일 이름은 둘 다 없을 때만 마지막 보조 수단.
function directionFromText(text) {
  var s = text.indexOf('매출') !== -1;
  var p = text.indexOf('매입') !== -1;
  if (s && !p) return 'sales';
  if (p && !s) return 'purchase';
  if (s && p) return 'both';
  return null;
}

function detectDirection(grid, headerRowIndex, sheetName, fileName, singleSide) {
  var parts = [];
  for (var r = 0; r < headerRowIndex; r++) {
    (grid[r] || []).forEach(function (v) { if (!cellIsEmpty(v) && !(v instanceof Date)) parts.push(String(v)); });
  }
  parts.push(sheetName || '');
  var d = directionFromText(parts.join(' '));
  if (d === 'sales' || d === 'purchase') return d;
  // 상대방 한 세트만 있으면 헤더 이름으로 추정: 공급받는자 열만 → 매출,
  // 공급자 열만 → 매입.
  if (singleSide === 'buyer') return 'sales';
  if (singleSide === 'supplier') return 'purchase';
  if (d === 'both') return null;
  var f = directionFromText(String(fileName || ''));
  return f === 'sales' || f === 'purchase' ? f : null;
}

function parseListDate(v) {
  if (v instanceof Date) {
    var s0 = excelCellValueToString(v);
    var p0 = s0.split('-');
    return isValidDateParts(p0[0], p0[1], p0[2]) ? s0 : '';
  }
  if (cellIsEmpty(v)) return '';
  // (review) 날짜 서식이 빠져 엑셀 날짜 일련번호(예: 46222 = 2026-07-19)로만
  // 들어온 숫자 셀. 2000-01-01(36526)~2035-12-31(49674) 범위만 날짜로 본다.
  if (typeof v === 'number' && v >= 36526 && v <= 49674) {
    var dt = new Date(Math.round((v - 25569) * 86400000));
    var ys = String(dt.getUTCFullYear()), ms = String(dt.getUTCMonth() + 1), ds = String(dt.getUTCDate());
    return isValidDateParts(ys, ms, ds) ? formatDateMatch([null, ys, ms, ds]) : '';
  }
  var s = String(v).trim();
  var m = /^(\d{4})[.\-/]\s?(\d{1,2})[.\-/]\s?(\d{1,2})/.exec(s) || /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m || !isValidDateParts(m[1], m[2], m[3])) return '';
  return formatDateMatch(m);
}

// "123-45-67890\n0001"처럼 종사업장 번호가 한 셀에 같이 들어온 경우 앞의
// 사업자등록번호 10자리만 쓴다.
function bizNoFromCell(v) {
  var t = gridValueToText(v);
  if (!t) return '';
  var m = /(\d{3})\s*-?\s*(\d{2})\s*-?\s*(\d{5})/.exec(t);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  return formatBizRegNo(t);
}

function bizDigits(v) {
  return bizNoFromCell(v).replace(/\D/g, '');
}

function normApprovalNo(v) {
  if (cellIsEmpty(v)) return '';
  return String(v).replace(/[\s-]/g, '');
}

function gridValueToText(v) {
  if (v instanceof Date) return excelCellValueToString(v);
  if (cellIsEmpty(v)) return '';
  return String(v).trim();
}

// 시트 하나를 홈택스 목록으로 해석. 목록이 아니면 null, 승인번호만 보이고
// 공급가액 열이 없으면 { nearMiss: true }.
function detectHometaxList(grid, sheetName, fileName) {
  var hdr = findHometaxHeaderRow(grid);
  if (hdr.headerRow === -1) return hdr.nearMiss ? { nearMiss: true } : null;
  var headerRow = hdr.headerRow;
  var colCount = 0;
  grid.forEach(function (row) { if (row.length > colCount) colCount = row.length; });
  var header = buildHeaderNames(grid, headerRow);
  var groups = buildHeaderGroups(grid, headerRow, colCount);
  var mapping = mapHometaxColumns(header.names, groups);
  var cols = mapping.cols;
  if (cols.supplyAmount == null) return { nearMiss: true };
  if (cols.approvalNo == null && cols.writeDate == null) return { nearMiss: true };
  var hasApprovalCol = cols.approvalNo != null;

  // 같은 승인번호 여러 줄(품목 여러 개)은 1건으로 묶는다. 승인번호 열이 없으면
  // 작성일자+사업자번호+공급가액+세액 조합을 같은 계산서의 기준으로 쓴다.
  var invoices = [];
  var byNo = {};
  for (var r = headerRow + 1; r < grid.length; r++) {
    var row = grid[r] || [];
    var no, raw = '';
    if (hasApprovalCol) {
      raw = row[cols.approvalNo];
      no = normApprovalNo(raw);
      if (!no || !/\d/.test(no)) continue; // 합계 줄·빈 줄·안내 문구 줄
    } else {
      var d = parseListDate(row[cols.writeDate]);
      if (!d) continue; // 합계 줄·빈 줄·안내 문구 줄(작성일자가 없음)
      no = 'K|' + d + '|' + bizDigits(cols.supplierBizNo != null ? row[cols.supplierBizNo] : '') + '|' +
        bizDigits(cols.buyerBizNo != null ? row[cols.buyerBizNo] : '') + '|' +
        parseNumber(row[cols.supplyAmount]) + '|' + parseNumber(cols.vat != null ? row[cols.vat] : 0);
    }
    if (!byNo[no]) {
      byNo[no] = { approvalNo: hasApprovalCol ? no : '', approvalRaw: gridValueToText(raw), rows: [] };
      invoices.push(byNo[no]);
    }
    byNo[no].rows.push(r);
  }

  return {
    sheetName: sheetName || '',
    fileName: fileName || '',
    grid: grid,
    headerRow: headerRow,
    headerNames: header.names,
    headerOriginals: header.originals,
    groups: groups,
    cols: cols,
    missingRequired: mapping.missingRequired,
    guessed: mapping.guessed,
    guessedVendorCols: mapping.guessedVendorCols,
    singleSide: mapping.singleSide,
    hasApprovalCol: hasApprovalCol,
    detectedDirection: detectDirection(grid, headerRow, sheetName, fileName, mapping.singleSide),
    invoices: invoices
  };
}

function detectHometaxInWorkbook(sheets, fileName) {
  var nearMiss = false;
  for (var i = 0; i < sheets.length; i++) {
    var res = detectHometaxList(sheets[i].grid, sheets[i].name, fileName);
    if (res && !res.nearMiss) return { list: res, nearMiss: false };
    if (res && res.nearMiss) nearMiss = true;
  }
  return { list: null, nearMiss: nearMiss };
}

var HOMETAX_RAWTEXT_MAX = 1000;

// 파싱된 목록을 방향(매출/매입)에 맞춰 계산서함 행 모양(id 제외)으로 만든다.
function parseHometaxRows(parsed, direction) {
  var cols = parsed.cols;
  var grid = parsed.grid;
  var isSales = direction === 'sales';
  // 매입 → 공급자, 매출 → 공급받는자. 상대방 한 세트만 있는 목록이면 그 세트를 쓴다.
  var side = parsed.singleSide || (isSales ? 'buyer' : 'supplier');
  var nameKey = side === 'buyer' ? 'buyerName' : 'supplierName';
  var bizKey = side === 'buyer' ? 'buyerBizNo' : 'supplierBizNo';
  var missing = parsed.missingRequired.slice();
  var notes = [];
  if (cols[nameKey] == null) missing.push(side === 'buyer' ? '공급받는자 상호' : '공급자 상호');
  if (parsed.singleSide && ((parsed.singleSide === 'buyer') !== isSales)) {
    notes.push('이 목록에는 ' + (parsed.singleSide === 'buyer' ? '공급받는자' : '공급자') + ' 열만 있어, ' + directionLabel(direction) + '로 가져왔지만 거래처는 그 열의 값을 썼습니다. 맞는지 확인해주세요.');
  }

  function val(rowArr, key) {
    return cols[key] != null ? rowArr[cols[key]] : '';
  }

  var out = parsed.invoices.map(function (inv) {
    var first = grid[inv.rows[0]] || [];
    var supply = parseNumber(val(first, 'supplyAmount'));
    var vat = parseNumber(val(first, 'vat'));
    var total = cols.total != null ? parseNumber(val(first, 'total')) : calcTotal(supply, vat);
    var review = false;

    var itemNames = [];
    var itemSupplySum = 0, itemVatSum = 0, hasItemSupply = false;
    inv.rows.forEach(function (r) {
      var rowArr = grid[r] || [];
      var nm = gridValueToText(val(rowArr, 'itemName'));
      if (nm) itemNames.push(nm);
      if (cols.itemSupply != null && !cellIsEmpty(rowArr[cols.itemSupply])) {
        hasItemSupply = true;
        itemSupplySum += parseNumber(rowArr[cols.itemSupply]);
        itemVatSum += parseNumber(val(rowArr, 'itemVat'));
      }
    });
    if (supply === 0 && hasItemSupply && itemSupplySum !== 0) {
      supply = itemSupplySum;
      vat = itemVatSum;
      total = calcTotal(supply, vat);
      review = true;
    } else if (hasItemSupply && inv.rows.length > 1 && itemSupplySum !== supply) {
      review = true; // 첫 줄 금액과 품목 합이 다름
    }

    var issueDate = parseListDate(val(first, 'writeDate'));
    var vendor = gridValueToText(val(first, nameKey));
    var bizRegNo = bizNoFromCell(val(first, bizKey));
    var workText = itemNames.join(', ') || gridValueToText(val(first, 'note'));
    var workType = workText ? extractWorkType(workText) : '';

    var lines = [];
    inv.rows.forEach(function (r, idx) {
      var rowArr = grid[r] || [];
      if (inv.rows.length > 1) lines.push('[' + (r + 1) + '행]');
      parsed.headerOriginals.forEach(function (h, c) {
        if (!h) return;
        var t = gridValueToText(rowArr[c]);
        if (idx > 0 && !t) return;
        lines.push(h + ': ' + t);
      });
    });
    var rawText = lines.join('\n');
    if (rawText.length > HOMETAX_RAWTEXT_MAX) rawText = rawText.slice(0, HOMETAX_RAWTEXT_MAX);

    if (!issueDate || !vendor || !bizRegNo || !supply) review = true;
    if (calcTotal(supply, vat) !== total) review = true;
    if (parsed.guessedVendorCols) review = true;
    if (missing.length) review = true;
    if (notes.length) review = true;

    return {
      fileName: parsed.fileName,
      issueDate: issueDate,
      vendor: vendor,
      workType: workType,
      bizRegNo: bizRegNo,
      supplyAmount: supply,
      vat: vat,
      total: total,
      projectName: '',
      parseMethod: 'hometax-list',
      needsReview: review,
      rawText: rawText,
      linkedProjectRowId: null,
      direction: isSales ? 'sales' : 'purchase',
      approvalNo: inv.approvalNo,
      sourceRow: inv.rows[0] + 1
    };
  });
  return { rows: out, missing: missing, notes: notes };
}

function knownApprovalNos() {
  var set = {};
  state.invoices.forEach(function (r) {
    if (r.approvalNo) set[normApprovalNo(r.approvalNo)] = true;
  });
  return set;
}

// 자동 판별 실패 시 사용자가 매출/매입을 고를 때까지 메모리에만 둔다(저장 안 함).
var pendingHometaxImports = {};
var pendingHometaxSeq = 1;

function getHometaxDirectionChoice() {
  var el = typeof document !== 'undefined' ? document.getElementById('hometax-direction') : null;
  var v = el ? el.value : 'auto';
  return v === 'sales' || v === 'purchase' ? v : 'auto';
}

function directionLabel(d) {
  return d === 'sales' ? '매출' : '매입';
}

function importHometaxList(parsed, blobId, file, sourceInfo) {
  var fileSource = sourceInfo && sourceInfo.fileSource === 'folder' ? 'folder' : 'blob';
  var ctx = { parsed: parsed, blobId: fileSource === 'blob' ? blobId : null, fileSource: fileSource, fileName: file ? file.name : parsed.fileName };
  if (!parsed.invoices.length) {
    if (ctx.blobId != null) deleteStoredFile(ctx.blobId);
    showHometaxResult('<p>홈택스 목록 파일 \'' + escapeAttr(ctx.fileName) + '\'로 보이지만 계산서가 0건이라 아무 것도 추가하지 않았습니다.</p>' + hometaxMappingDetailsHtml(parsed));
    return;
  }
  var choice = getHometaxDirectionChoice();
  var detected = parsed.detectedDirection;
  var notes = [];
  if (choice !== 'auto') {
    if (detected && detected !== choice) {
      notes.push('파일 제목은 ' + (detected === 'sales' ? '매출로' : '매입으로') + ' 보이지만 선택하신 ' + (choice === 'sales' ? '매출로' : '매입으로') + ' 가져왔습니다.');
    }
    commitHometaxImport(ctx, choice, notes);
    return;
  }
  if (detected) {
    commitHometaxImport(ctx, detected, notes);
    return;
  }
  var pid = 'p' + (pendingHometaxSeq++);
  pendingHometaxImports[pid] = ctx;
  showHometaxResult(
    '<p><strong>\'' + escapeAttr(ctx.fileName) + '\'</strong>: 이 목록이 매출인지 매입인지 알 수 없습니다(계산서 ' + parsed.invoices.length + '건).</p>' +
    '<div class="hometax-choice">' +
    '<button type="button" class="btn-primary" data-hometax-pending="' + pid + '" data-hometax-choice="sales">매출로 가져오기</button>' +
    '<button type="button" class="btn-primary" data-hometax-pending="' + pid + '" data-hometax-choice="purchase">매입으로 가져오기</button>' +
    '<button type="button" class="btn-secondary" data-hometax-pending="' + pid + '" data-hometax-choice="cancel">취소</button>' +
    '</div>' + hometaxMappingDetailsHtml(parsed),
    pid
  );
}

function resolvePendingHometax(pid, choice) {
  var ctx = pendingHometaxImports[pid];
  if (!ctx) return;
  delete pendingHometaxImports[pid];
  var block = document.querySelector('[data-hometax-block="' + pid + '"]');
  if (block) block.remove();
  if (choice === 'cancel') {
    if (ctx.blobId != null) deleteStoredFile(ctx.blobId);
    showHometaxResult('<p>\'' + escapeAttr(ctx.fileName) + '\' 가져오기를 취소했습니다.</p>');
    return;
  }
  commitHometaxImport(ctx, choice === 'sales' ? 'sales' : 'purchase', []);
}

function commitHometaxImport(ctx, direction, notes) {
  var parsed = ctx.parsed;
  var built = parseHometaxRows(parsed, direction);
  var known = knownApprovalNos();
  var added = 0, skipped = 0, overlap = 0;

  function comboKey(r) {
    return [r.issueDate, String(r.bizRegNo || '').replace(/\D/g, ''), Number(r.supplyAmount) || 0, Number(r.vat) || 0].join('|');
  }
  var knownCombos = {};
  if (!parsed.hasApprovalCol) {
    state.invoices.forEach(function (e) { if (e.issueDate) knownCombos[comboKey(e)] = true; });
  }

  built.rows.forEach(function (r) {
    if (r.approvalNo) {
      if (known[r.approvalNo]) { skipped++; return; }
      known[r.approvalNo] = true;
    } else {
      // 승인번호 열이 없는 목록: 작성일자+상대방 사업자번호+공급가액+세액 조합으로 중복 판단
      var ck = comboKey(r);
      if (knownCombos[ck]) { skipped++; return; }
      knownCombos[ck] = true;
    }
    // 단건 PDF/엑셀로 이미 올린 같은 계산서일 수 있음(승인번호 없음) → 확인 필요만 표시
    var dup = !!r.approvalNo && state.invoices.some(function (e) {
      return !e.approvalNo && e.issueDate && e.issueDate === r.issueDate &&
        e.bizRegNo && e.bizRegNo === r.bizRegNo && Number(e.supplyAmount) === Number(r.supplyAmount);
    });
    if (dup) { r.needsReview = true; overlap++; }
    r.id = state.invoicesNextId++;
    r.fileSource = ctx.fileSource;
    r.fileName = ctx.fileName;
    r.blobKey = ctx.blobId;
    state.invoices.push(r);
    added++;
  });

  if (!added && ctx.blobId != null) deleteStoredFile(ctx.blobId);
  saveInvoicesState();
  renderInvoiceTable();

  notes = notes.concat(built.notes || []);
  if (!parsed.hasApprovalCol) notes.push('승인번호 열이 없는 목록이라 작성일자+사업자등록번호+공급가액+세액이 같은 항목을 중복으로 보았습니다.');
  var html = '<p><strong>홈택스 ' + directionLabel(direction) + ' 목록 \'' + escapeAttr(ctx.fileName) + '\'</strong>: 새로 추가 ' + added + '건, 중복 건너뜀 ' + skipped + '건</p>';
  notes.forEach(function (n) { html += '<p class="hometax-warn">' + escapeAttr(n) + '</p>'; });
  if (overlap) html += '<p class="hometax-warn">단건으로 올린 계산서와 겹칠 수 있는 항목 ' + overlap + '건(확인 필요 표시)</p>';
  if (built.missing.length) {
    html += '<p class="hometax-warn">이 목록에서 다음 열을 찾지 못했습니다: ' + escapeAttr(built.missing.join(', ')) + ' — 해당 값은 비어 있으니 직접 입력해주세요.</p>';
  }
  parsed.guessed.forEach(function (g) { html += '<p class="hometax-warn">' + escapeAttr(g) + '</p>'; });
  html += hometaxMappingDetailsHtml(parsed);
  showHometaxResult(html);
}

var HOMETAX_MAPPING_LABELS = [
  ['writeDate', '작성일자'], ['approvalNo', '승인번호'], ['supplierBizNo', '공급자 등록번호'],
  ['supplierName', '공급자 상호'], ['buyerBizNo', '공급받는자 등록번호'], ['buyerName', '공급받는자 상호'],
  ['supplyAmount', '공급가액'], ['vat', '세액'], ['total', '합계금액'], ['itemName', '품목명'], ['note', '비고']
];

function hometaxMappingDetailsHtml(parsed) {
  var parts = HOMETAX_MAPPING_LABELS.map(function (p) {
    var c = parsed.cols[p[0]];
    return p[1] + '=' + (c != null ? colLetter(c) + '열' : '없음');
  });
  return '<details class="hometax-details"><summary>찾은 열 보기</summary><p>시트: ' + escapeAttr(parsed.sheetName) +
    ' / 헤더: ' + (parsed.headerRow + 1) + '행 / ' + escapeAttr(parts.join(', ')) + '</p></details>';
}

function showHometaxResult(innerHtml, pid) {
  if (typeof document === 'undefined') return;
  var box = document.getElementById('hometax-result');
  if (!box) return;
  var div = document.createElement('div');
  div.className = 'hometax-result-block';
  if (pid) div.setAttribute('data-hometax-block', pid);
  div.innerHTML = '<div class="hometax-result-body">' + innerHtml + '</div>' +
    (pid ? '' : '<button type="button" class="btn-row-action hometax-close" data-hometax-close="true" aria-label="닫기">닫기</button>');
  box.appendChild(div);
}

function reportHometaxNearMiss(fileName) {
  showHometaxResult('<p class="hometax-warn">\'' + escapeAttr(fileName) + '\': 홈택스 목록처럼 보이지만 공급가액 열을 찾지 못해 불러오지 못했습니다.</p>');
}

function bindHometaxResult() {
  var box = document.getElementById('hometax-result');
  if (!box) return;
  box.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    if (btn.hasAttribute('data-hometax-pending')) {
      resolvePendingHometax(btn.getAttribute('data-hometax-pending'), btn.getAttribute('data-hometax-choice'));
    } else if (btn.hasAttribute('data-hometax-close')) {
      var block = btn.closest('.hometax-result-block');
      if (block) block.remove();
    }
  });
}

function getExtension(name) {
  var m = /\.([a-zA-Z0-9]+)$/.exec(name || '');
  return m ? m[1].toLowerCase() : '';
}

async function processOneFile(file, invoiceId, sourceInfo) {
  var ext = getExtension(file.name);
  var result = null;
  try {
    if (ext === 'pdf') {
      result = await extractPdfInvoiceData(file);
    } else if (ext === 'xlsx') {
      result = await extractExcelInvoiceData(file);
    } else if (ext === 'xls') {
      result = await extractXlsInvoiceData(file);
    } else if (IMAGE_EXT_RE.test(ext)) {
      result = await extractImageInvoiceData(file);
    }
  } catch (err) {
    result = null;
  }

  if (result && result.hometaxList) {
    // (v7) 홈택스 목록: "인식 중" 임시 행은 목록에서 지우되, 그 id로 저장된
    // 원본 blob은 지우지 않고 새 행들이 함께 가리키는 blobKey로 재사용한다.
    state.invoices = state.invoices.filter(function (r) { return String(r.id) !== String(invoiceId); });
    importHometaxList(result.hometaxList, invoiceId, file, sourceInfo || { fileSource: 'blob' });
    return;
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
    linkedProjectRowId: null,
    direction: 'purchase',
    approvalNo: '',
    blobKey: null,
    sourceRow: null
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
    .then(function () { return processOneFile(file, invoiceId, sourceInfo); })
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
  if (isHometaxListRow(row)) {
    alert('홈택스 목록에서 가져온 항목은 재인식 대신 목록 엑셀을 다시 올려주세요(이미 있는 승인번호는 자동으로 건너뜁니다).');
    return;
  }
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

// (v7) 매출/매입 선택을 기다리던 목록 엑셀은 새로고침하면 메모리에서
// 사라진다 — 그 blob이 남지 않도록, 화면을 열 때 어떤 행도 가리키지 않는
// blob을 정리한다(행 id 또는 blobKey로 참조되는 것만 유지).
function cleanupOrphanBlobs() {
  return openInvoicesDb().then(function (db) {
    return new Promise(function (resolve) {
      var tx = db.transaction(INV_DB_FILES_STORE, 'readwrite');
      var store = tx.objectStore(INV_DB_FILES_STORE);
      var req = store.getAllKeys();
      req.onsuccess = function () {
        var used = {};
        state.invoices.forEach(function (r) {
          used[String(r.id)] = true;
          if (r.blobKey != null) used[String(r.blobKey)] = true;
        });
        (req.result || []).forEach(function (k) {
          if (!used[String(k)]) store.delete(k);
        });
      };
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
    // (v7) 홈택스 목록 행은 여러 행이 하나의 원본 엑셀(blobKey)을 함께 가리킨다.
    return getStoredFile(row.blobKey != null ? row.blobKey : row.id);
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
  if (row.sourceRow != null) {
    alert('목록 엑셀의 ' + row.sourceRow + '번째 줄입니다');
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
  if (row.parseMethod === 'hometax-list') {
    return '<span class="badge-ok">홈택스</span>';
  }
  return '<span class="badge-ok">완료</span>';
}

function refreshStatusCell(tr, row) {
  // (v7) 체크박스·구분 열이 늘어 칸 번호 하드코딩 대신 data-col로 찾는다.
  var td = tr.querySelector('[data-col="status"]');
  if (td) td.innerHTML = statusBadgeHtml(row);
}

function updateUploadProgressText() {
  var el = document.getElementById('upload-progress');
  if (!el) return;
  var n = Object.keys(processingIds).length;
  el.textContent = n > 0 ? (n + '건 인식 중…') : '';
}

// (v7) 체크 상태는 메모리에만 둔다(저장하지 않음).
var selectedIds = {};

function getVisibleInvoices() {
  var filterSelect = document.getElementById('project-filter');
  var filter = filterSelect ? filterSelect.value : '';
  var dirSelect = document.getElementById('direction-filter');
  var dirFilter = dirSelect ? dirSelect.value : '';
  var noProjectEl = document.getElementById('filter-no-project');
  var noProjectOnly = !!(noProjectEl && noProjectEl.checked);
  return state.invoices.filter(function (r) {
    if (filter && r.projectName !== filter) return false;
    if (dirFilter && getDirection(r) !== dirFilter) return false;
    if (noProjectOnly && r.projectName) return false;
    return true;
  });
}

function renderInvoiceTable() {
  var tbody = document.getElementById('invoice-body');
  var rows = getVisibleInvoices();

  // 목록에서 사라진 행의 체크 상태는 정리한다.
  Object.keys(selectedIds).forEach(function (id) {
    if (!findInvoice(id)) delete selectedIds[id];
  });

  var html = '';
  rows.forEach(function (row, idx) {
    var dir = getDirection(row);
    var hideRetry = isHometaxListRow(row);
    html +=
      '<tr data-id="' + row.id + '">' +
      '<td class="select-cell"><label class="select-label"><input type="checkbox" data-select="true" aria-label="선택"' + (selectedIds[row.id] ? ' checked' : '') + '></label></td>' +
      '<td>' + (idx + 1) + '</td>' +
      '<td><select data-field="direction" class="dir-select dir-' + dir + '" aria-label="구분">' +
      '<option value="purchase"' + (dir === 'purchase' ? ' selected' : '') + '>매입</option>' +
      '<option value="sales"' + (dir === 'sales' ? ' selected' : '') + '>매출</option>' +
      '</select></td>' +
      '<td><input type="date" data-field="issueDate" value="' + escapeAttr(row.issueDate) + '"></td>' +
      '<td><input type="text" data-field="vendor" value="' + escapeAttr(row.vendor) + '"></td>' +
      '<td><input type="text" data-field="workType" value="' + escapeAttr(row.workType) + '"></td>' +
      '<td><input type="text" inputmode="numeric" maxlength="12" placeholder="000-00-00000" data-field="bizRegNo" value="' + escapeAttr(row.bizRegNo) + '"></td>' +
      '<td><input type="text" inputmode="numeric" data-money="true" data-field="supplyAmount" value="' + formatNumber(row.supplyAmount) + '"></td>' +
      '<td><input type="text" inputmode="numeric" data-money="true" data-field="vat" value="' + formatNumber(row.vat) + '"></td>' +
      '<td><input type="text" inputmode="numeric" data-money="true" data-field="total" value="' + formatNumber(row.total) + '"></td>' +
      '<td><input type="text" list="project-suggestions" data-field="projectName" placeholder="공사명 입력" value="' + escapeAttr(row.projectName) + '"></td>' +
      '<td data-col="status">' + statusBadgeHtml(row) + '</td>' +
      '<td><div class="row-actions">' +
      '<button type="button" class="btn-row-action" data-action="view">원본</button>' +
      (hideRetry ? '' : '<button type="button" class="btn-row-action" data-action="retry">재인식</button>') +
      '<button type="button" class="btn-row-action" data-action="rawtext">텍스트</button>' +
      '</div></td>' +
      '<td><button type="button" class="btn-row-action" data-action="delete" aria-label="삭제">삭제</button></td>' +
      '</tr>';
  });

  tbody.innerHTML = html || '<tr><td colspan="14" class="folder-empty">업로드된 계산서가 없습니다. 위에서 파일을 올리거나 폴더를 연결해보세요.</td></tr>';

  renderProjectFilterOptions();
  renderProjectSuggestions();
  renderGenerateSummary();
  renderBulkBar();
  updateUploadProgressText();
}

function selectedCount() {
  return Object.keys(selectedIds).length;
}

// 일괄 지정 바의 "선택 N건"/버튼 활성화와 머리글 전체 선택 체크 상태 갱신.
function renderBulkBar() {
  var n = selectedCount();
  var countEl = document.getElementById('bulk-count');
  if (countEl) countEl.textContent = '선택 ' + n + '건';
  var applyBtn = document.getElementById('btn-bulk-apply');
  if (applyBtn) {
    applyBtn.disabled = n === 0;
    applyBtn.textContent = '선택한 ' + n + '건에 적용';
  }
  var sameBtn = document.getElementById('btn-bulk-same-vendor');
  if (sameBtn) sameBtn.disabled = n === 0;
  var clearBtn = document.getElementById('btn-bulk-clear');
  if (clearBtn) clearBtn.disabled = n === 0;
  var all = document.getElementById('select-all-visible');
  if (all) {
    var visible = getVisibleInvoices();
    var checked = visible.filter(function (r) { return selectedIds[r.id]; }).length;
    all.checked = visible.length > 0 && checked === visible.length;
    all.indeterminate = checked > 0 && checked < visible.length;
  }
}

// 공사명 셀 수정과 일괄 지정이 함께 쓰는 규칙: 값이 바뀌면 정산서 연결을
// 풀어준다(needsReview/parseMethod는 건드리지 않음 — 공사명은 검수와 무관).
function setRowProjectName(row, name) {
  if (row.projectName !== name && row.linkedProjectRowId) {
    // 이미 어떤 정산서에 반영된 계산서라도, 공사명을 다른 값으로 바꾸면
    // 그 연결은 "예전 공사명" 기준이므로 더 이상 유효하지 않다 — 풀어줘야
    // 새 공사명으로 "정산서 생성"할 때 이 계산서가 반영 대상에 포함된다.
    row.linkedProjectRowId = null;
  }
  row.projectName = name;
}

// 구분(매입/매출) 변경: 반영 위치가 달라지므로 정산서 연결을 풀어준다.
function setRowDirection(row, dir) {
  dir = dir === 'sales' ? 'sales' : 'purchase';
  if (getDirection(row) === dir) return false;
  row.direction = dir;
  if (row.linkedProjectRowId) row.linkedProjectRowId = null;
  return true;
}

function vendorKey(row) {
  var biz = String(row.bizRegNo || '').replace(/\D/g, '');
  return getDirection(row) + '|' + (biz ? 'b:' + biz : 'n:' + String(row.vendor || '').trim());
}

function bindBulkBar() {
  var applyBtn = document.getElementById('btn-bulk-apply');
  var sameBtn = document.getElementById('btn-bulk-same-vendor');
  var clearBtn = document.getElementById('btn-bulk-clear');
  var input = document.getElementById('bulk-project');
  var all = document.getElementById('select-all-visible');
  var hint = document.getElementById('bulk-hint');

  if (applyBtn) applyBtn.addEventListener('click', function () {
    var name = input ? input.value.trim() : '';
    if (!name) {
      if (hint) hint.textContent = '공사명을 입력해주세요';
      if (input) input.focus();
      return;
    }
    if (hint) hint.textContent = '';
    var n = 0;
    Object.keys(selectedIds).forEach(function (id) {
      var row = findInvoice(id);
      if (row) { setRowProjectName(row, name); n++; }
    });
    selectedIds = {};
    saveInvoicesState();
    renderInvoiceTable();
    if (hint) hint.textContent = n + '건에 공사명 "' + name + '"을(를) 넣었습니다.';
  });

  if (sameBtn) sameBtn.addEventListener('click', function () {
    var keys = {};
    Object.keys(selectedIds).forEach(function (id) {
      var row = findInvoice(id);
      if (row) keys[vendorKey(row)] = true;
    });
    state.invoices.forEach(function (r) {
      if (keys[vendorKey(r)]) selectedIds[r.id] = true;
    });
    renderInvoiceTable();
  });

  if (clearBtn) clearBtn.addEventListener('click', function () {
    selectedIds = {};
    renderInvoiceTable();
  });

  if (all) all.addEventListener('change', function () {
    var visible = getVisibleInvoices();
    visible.forEach(function (r) {
      if (all.checked) selectedIds[r.id] = true;
      else delete selectedIds[r.id];
    });
    renderInvoiceTable();
  });
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
  SettlementShared.getActiveProjectNames().forEach(function (n) { names[n] = true; });
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
  // 구분 필터와 무관하게 공사명 필터만 기준으로 계산한다.
  var rows = state.invoices.filter(function (r) { return r.projectName === filter; });
  var supply = 0, vat = 0, total = 0, purchaseCount = 0;
  var salesCount = 0, salesSupply = 0;
  rows.forEach(function (r) {
    if (getDirection(r) === 'sales') {
      salesCount++;
      salesSupply += Number(r.supplyAmount) || 0;
      return;
    }
    purchaseCount++;
    supply += Number(r.supplyAmount) || 0;
    vat += Number(r.vat) || 0;
    total += Number(r.total) || 0;
  });
  document.getElementById('gen-count').textContent = String(purchaseCount);
  document.getElementById('gen-supply').textContent = formatNumber(supply);
  document.getElementById('gen-vat').textContent = formatNumber(vat);
  document.getElementById('gen-total').textContent = formatNumber(total);
  var salesCountEl = document.getElementById('gen-sales-count');
  var salesSupplyEl = document.getElementById('gen-sales-supply');
  if (salesCountEl) salesCountEl.textContent = String(salesCount);
  if (salesSupplyEl) salesSupplyEl.textContent = formatNumber(salesSupply);
  document.querySelectorAll('[data-sales-summary]').forEach(function (el) { el.hidden = salesCount === 0; });
  summaryEl.hidden = false;
}

// ---------------------------------------------------------------------
// 목록 테이블 이벤트 위임(셀 수정 + 행 액션) — settlement.js와 동일하게
// <tbody> 하나에 input/click 리스너를 한 번씩만 등록한다.
// ---------------------------------------------------------------------
function bindInvoiceTableEvents() {
  var tbody = document.getElementById('invoice-body');

  // (v7) 체크박스 선택과 구분(select) 변경. select는 input 이벤트도 내지만
  // 안전하게 change도 처리한다(setRowDirection은 같은 값이면 아무 것도 안 함).
  function handleDirectionOrSelect(e) {
    var target = e.target;
    var tr = target.closest('tr[data-id]');
    if (!tr) return false;
    if (target.dataset.select === 'true') {
      if (e.type !== 'change') return true;
      var id = tr.getAttribute('data-id');
      if (target.checked) selectedIds[id] = true;
      else delete selectedIds[id];
      renderBulkBar();
      return true;
    }
    if (target.dataset.field === 'direction') {
      var row = findInvoice(tr.getAttribute('data-id'));
      if (row && setRowDirection(row, target.value)) {
        target.classList.remove('dir-sales', 'dir-purchase');
        target.classList.add('dir-' + getDirection(row));
        saveInvoicesState();
        renderGenerateSummary();
      }
      return true;
    }
    return false;
  }
  tbody.addEventListener('change', handleDirectionOrSelect);

  tbody.addEventListener('input', function (e) {
    if (handleDirectionOrSelect(e)) return;
    var target = e.target;
    var field = target.dataset.field;
    if (!field) return;
    var tr = target.closest('tr[data-id]');
    if (!tr) return;
    var row = findInvoice(tr.getAttribute('data-id'));
    if (!row) return;

    if (field === 'projectName') {
      setRowProjectName(row, target.value);
    } else if (target.dataset.money === 'true') {
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
      state.invoices = state.invoices.filter(function (r) { return String(r.id) !== String(id); });
      delete selectedIds[id];
      if (row && row.blobKey != null) {
        // (v7) 같은 목록 엑셀(blobKey)을 가리키는 행이 하나도 남지 않을 때만 원본 삭제
        var stillUsed = state.invoices.some(function (r) { return r.blobKey != null && String(r.blobKey) === String(row.blobKey); });
        if (!stillUsed) deleteStoredFile(row.blobKey);
      } else {
        deleteStoredFile(row ? row.id : id);
      }
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
  var salesSkippedByUser = false;

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

  // (v7) 매입 → 표1 외주·자재비(기존과 동일), 매출 → projectInfo.supplyAmount에 합산.
  var purchasesToLink = invoicesToLink.filter(function (r) { return getDirection(r) !== 'sales'; });
  var salesToLink = invoicesToLink.filter(function (r) { return getDirection(r) === 'sales'; });
  var salesSupply = 0;
  salesToLink.forEach(function (r) { salesSupply += parseNumber(r.supplyAmount); });
  var baseSupply = mode === 'merge' ? (Number(targetState.projectInfo.supplyAmount) || 0) : 0;

  if (mode === 'merge' && salesToLink.length && baseSupply > 0) {
    // 사용자가 계약 공급가액을 직접 입력해 둔 경우 이중 합산 방지
    var addOk = confirm(
      '기존 공급가액 ' + formatNumber(baseSupply) + '원에 매출 계산서 ' + salesToLink.length + '건(공급가액 ' +
      formatNumber(salesSupply) + '원)을 더해 ' + formatNumber(baseSupply + salesSupply) + '원으로 바꿀까요?\n' +
      '취소하면 공급가액은 그대로 두고 매출 계산서는 반영하지 않습니다.'
    );
    if (!addOk) {
      salesToLink = [];
      salesSupply = 0;
      salesSkippedByUser = true;
    }
  }

  purchasesToLink.forEach(function (inv) {
    var newId = targetState.subcontractNextId++;
    var row = makeSubcontractRowFromInvoice(newId, inv);
    targetState.subcontract.push(row);
    inv.linkedProjectRowId = row.id;
  });

  if (salesToLink.length) {
    // 정산서의 부가세·합계는 settlement.js가 calcVat(supplyAmount)로 다시 계산하므로
    // 계산서의 세액은 넣지 않는다.
    targetState.projectInfo.supplyAmount = baseSupply + salesSupply;
    salesToLink.forEach(function (inv) { inv.linkedProjectRowId = 'supply'; });
  }

  SettlementShared.saveProjectByName(projectName, targetState);
  saveInvoicesState();
  renderInvoiceTable();

  var resultEl = document.getElementById('generate-result');
  var actionLabel = mode === 'merge' ? '병합했습니다' : (mode === 'overwrite' ? '새로 생성했습니다(기존 내용 대체)' : '새로 생성했습니다');
  if (resultEl) {
    resultEl.innerHTML =
      (salesToLink.length
        ? '"' + escapeAttr(projectName) + '" 정산서에 매입 계산서 ' + purchasesToLink.length + '건(표1 외주·자재비)과 매출 계산서 ' +
          salesToLink.length + '건(공급가액 +' + formatNumber(salesSupply) + '원)을 ' + actionLabel + '.<br>'
        : '"' + escapeAttr(projectName) + '" 정산서에 계산서 ' + purchasesToLink.length + '건을 ' + actionLabel + '.' +
          (salesSkippedByUser ? ' 매출 계산서는 공급가액을 그대로 두기로 해 반영하지 않았습니다.' : '') + '<br>') +
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
  bindBulkBar();
  bindHometaxResult();
  cleanupOrphanBlobs();
  bindFolderButtons();
  bindMoneyFormatting();
  bindDatePickers();

  var filterSelect = document.getElementById('project-filter');
  if (filterSelect) filterSelect.addEventListener('change', renderInvoiceTable);
  var dirFilter = document.getElementById('direction-filter');
  if (dirFilter) dirFilter.addEventListener('change', renderInvoiceTable);
  var noProjectFilter = document.getElementById('filter-no-project');
  if (noProjectFilter) noProjectFilter.addEventListener('change', renderInvoiceTable);

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
  SettlementShared.showChangelogIfNeeded();

  if (!supportsFsAccess()) {
    setFolderStatus('이 브라우저는 폴더 연결을 지원하지 않아 "폴더 연결" 버튼이 폴더 선택 창으로 대체됩니다.');
  }
  tryReconnectFolder();

  // 화면을 그리기 전에 클라우드(다른 기기/담당자가 저장한 정산서)를 먼저
  // 로컬 저장소에 병합한다(공사명 자동완성/필터 목록에 반영하기 위해).
  SettlementShared.pullProjectsFromCloud().then(function () {
    renderInvoiceTable();
  });
});
