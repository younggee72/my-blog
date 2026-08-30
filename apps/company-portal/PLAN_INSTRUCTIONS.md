# Plan 서브에이전트 지침 — 업무자료실(공사자료/안전자료 파일 공유) 추가

## 역할
너는 이 프로젝트(마크다운 기반 블로그 + 미니 웹앱 포트폴리오, HTML/CSS/JS만 사용)의 **Plan 단계** 서브에이전트다.
이미 구현되어 있는 `apps/company-portal/`에 새 기능(업무자료실)을 추가하는 계획을 세워, `apps/company-portal/spec.md`에 새 장(8장)으로 추가하는 것이 임무다.
**코드를 작성하지 마라.** 계획 문서만 수정한다. 기존 spec.md의 1~7장은 그대로 두고 이어서 추가해라.

## 먼저 읽어야 할 것
- `apps/company-portal/spec.md` (1~7장 전체) — 기존 계획/구현 이력
- `apps/company-portal/index.html`, `style.css`, `portal.js`, `app.js` — 기존 구현(특히 "업무 도구" 허브 카드 3장 중 "기타 업무 도구" placeholder 카드 부분)

## 프로젝트 제약 조건
- 마크다운 기반 블로그 + 미니 웹앱 포트폴리오, HTML/CSS/JS만 사용, 빌드 도구/번들러 없음.
- `apps/company-portal/` 밖의 파일(다른 앱, 블로그 본체)은 건드리지 않는다.
- 사이트 색상 팔레트(`/css/style.css`의 CSS 변수를 이 앱에 재선언한 값)를 따른다.
- 사용법 안내 문구를 포함한다.
- 이번 기능은 **예외적으로 CDN 사용이 꼭 필요하다**(Firebase Storage 클라이언트 SDK). 프로젝트 규칙상 CDN은 허용되어 있으니, Firebase JS SDK를 CDN(예: `https://www.gstatic.com/firebasejs/10.x.x/firebase-app.js`, `firebase-storage.js`, ES 모듈 방식)으로 불러와서 쓴다.

## 배경 — 사용자 요청
"기타업무도구 란은 업무자료란으로 수정하고 업무자료방에 들어가면, 1.공사자료 2.안전자료 를 만들어서 각각방에 PDF파일 CAD파일 엑셀파일등을 올릴수 있도록 만들어줘"

사용자와 상의한 결과 **"진짜 공유 저장소 연결"**로 확정했고(모든 직원이 같은 파일을 보게 됨), 사용자가 직접 Firebase 프로젝트(`jicheon-construction`)를 만들고 Cloud Storage를 활성화했다. 아래 정보가 이미 준비되어 있다.

**Firebase 설정값(공개해도 되는 클라이언트 설정 — API 키가 아니라 프로젝트 식별 정보이며, 실제 접근 제어는 Storage 보안 규칙이 담당한다. 이 값을 코드에 그대로 넣는 것은 "비밀번호/웹훅 URL 하드코딩 금지"와는 다른 사안이니 헷갈리지 마라):**
```js
const firebaseConfig = {
  apiKey: "AIzaSyAdyXmaN_rgxG_eCFA8jnuzvQabL8thLFk",
  authDomain: "jicheon-construction.firebaseapp.com",
  projectId: "jicheon-construction",
  storageBucket: "jicheon-construction.firebasestorage.app",
  messagingSenderId: "79554524630",
  appId: "1:79554524630:web:67a2588607f85984c82077",
  measurementId: "G-H7P1VFC43Q"
};
```

**현재 배포된 Storage 보안 규칙(사용자가 Firebase 콘솔에서 이미 게시함):**
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if true;
    }
  }
}
```
즉 지금은 **누구나 읽기/쓰기(업로드/삭제 포함) 가능**한 완전 개방 상태다. (사용자가 Firebase 콘솔 규칙 편집기에서 여러 번 입력 오류를 겪어 우선 이 단순한 규칙으로 게시했다.) spec.md에 이 현황과 한계(진짜 보안이 아니라는 점 — 이미 회사 홈페이지 비밀번호 잠금과 동일한 맥락의 트레이드오프)를 명시하고, 클라이언트 쪽에서 파일 크기 제한(예: 20MB) 등을 추가로 검증해 실수로 큰 파일을 올리는 것 정도는 막도록 설계하라.

## 요구사항

1. **허브 카드 변경**: 기존 "기타 업무 도구"(placeholder, 클릭 불가) 카드를 **"업무자료"**로 바꾸고, 클릭하면 이동 가능한 실제 링크로 만든다(다른 두 카드 — 현장정산서, 법인차량관리 — 와 동일한 방식으로 새 페이지로 이동).
2. **업무자료실 페이지**: `apps/company-portal/materials.html`(새 파일)을 만든다. 이 페이지 진입 시 두 개의 방(섹션 또는 탭)이 보인다:
   - **1. 공사자료**
   - **2. 안전자료**
   - 각 방은 독립적으로 파일 업로드·목록 표시·다운로드·삭제가 가능해야 한다(같은 Firebase Storage 버킷 안에서 폴더 경로로 구분 — 예: `construction/`, `safety/`).
3. **업로드 기능**: 파일 선택(`<input type="file">`, PDF·CAD(.dwg/.dxf 등)·엑셀(.xls/.xlsx) 확장자 위주로 accept 속성 지정하되, 다른 확장자도 완전히 막지는 않아도 됨) → Firebase Storage에 업로드 → 완료 후 목록 자동 갱신. 업로드 중 진행 상태(퍼센트 또는 스피너) 표시. 클라이언트 단에서 **파일 크기 20MB 초과 시 업로드 전에 막고 안내 메시지** 표시.
4. **목록 표시**: 각 방마다 업로드된 파일 목록을 파일명, 용량(KB/MB 단위로 보기 좋게), 업로드 일시로 보여준다. Firebase Storage의 `listAll()` + `getMetadata()` + `getDownloadURL()` 조합으로 별도 DB 없이 구현 가능하다는 점을 spec.md에 명시하라(이 프로젝트는 Storage만 설정했고 Firestore는 없음).
5. **다운로드/삭제**: 각 파일 항목에 "다운로드"(새 탭에서 열기 또는 다운로드 링크)와 "삭제"(`confirm()` 확인 후 `deleteObject()`) 버튼을 둔다.
6. **사용법 안내 및 보안 고지**: 이 페이지에도 다른 화면들과 같은 패턴으로 사용법 안내 박스를 넣고, 다음을 명시한다: (a) 업로드한 파일은 **모든 방문자가 볼 수 있는 공유 저장소**에 저장되며(더 이상 브라우저 로컬 저장이 아님), (b) 이 링크를 아는 사람은 누구나 업로드/다운로드/삭제가 가능한 수준의 보안이라는 점(회사 홈페이지의 비밀번호 잠금과 동일한 성격의 트레이드오프), (c) 파일당 20MB 제한이 있다는 점.
7. **파일 구조 설계 판단**: `materials.html` + 전용 CSS(기존 `style.css`에 이어 쓸지, 별도 파일로 뺄지 Plan 단계에서 판단) + `materials.js`(Firebase 초기화 + 업로드/목록/삭제 로직 + 렌더링). Firebase SDK는 ES 모듈 CDN import로 `materials.js` 상단에서 불러온다(`<script type="module" src="materials.js">`).
8. **디자인**: 기존 company-portal의 CSS 변수·다크모드·모바일 반응형 패턴을 그대로 따른다. 파일 목록은 카드 또는 표 형태(다른 화면의 `item-card` 패턴 재사용 검토).
9. 이 기능은 회사 홈페이지의 비밀번호 잠금(7200)이 걸린 "내부 영역" 안에서만 링크로 연결되므로 materials.html 자체에 별도 비밀번호를 또 넣지는 않는다(단, materials.html URL을 직접 아는 사람은 접근 가능하다는 한계를 6번 항목에서 이미 고지).

## 산출물
`apps/company-portal/spec.md`에 새 장(8장, "업무자료실(Firebase Storage 연동)")을 추가한다. 포함할 내용:

1. **개요**: 업무자료실 기능 요약과 왜 실제 클라우드 저장소(Firebase)를 쓰는지(공유 목적) 한 문단.
2. **파일 구조**: 새로 만들 파일 목록과 역할.
3. **핵심 로직 설계**: Firebase 초기화 코드 스니펫, 업로드/목록조회/다운로드/삭제 함수 설계(의사코드 수준), 폴더 경로 규칙(`construction/`, `safety/`), 파일명 충돌 방지 방식(예: 타임스탬프 접두사 + 원본 파일명), 클라이언트 사이드 20MB 검증 로직.
4. **보안 현황과 한계**: 위에 정리된 현재 Storage 규칙 상태와 트레이드오프를 명시.
5. **UI/디자인**: 페이지 레이아웃(허브 카드 라벨 변경 포함), 업로드 버튼/진행상태, 파일 목록 카드 디자인, 사용법 안내 문구 배치, 다크모드·반응형.
6. **작업 순서(체크리스트)**: Build 단계에서 순서대로 구현할 수 있는 번호 매겨진 단계 목록(허브 카드 텍스트/링크 수정부터, Firebase 연동, 업로드, 목록, 삭제, 스타일, 브라우저 검증까지).

계획을 다 작성했으면 저장하고, 무엇을 추가했는지 300자 이내로 요약해서 보고하라.
