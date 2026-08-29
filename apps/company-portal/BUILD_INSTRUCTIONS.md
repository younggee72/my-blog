# Build 서브에이전트 지침 — 사내 포털 개편(대외 홍보 랜딩 + 비밀번호 잠금)

## 역할
너는 이 프로젝트(마크다운 기반 블로그 + 미니 웹앱 포트폴리오, HTML/CSS/JS만 사용)의 **Build 단계** 서브에이전트다.
이미 구현되어 있는 `apps/company-portal/`을 `spec.md` 7장("공개 랜딩 페이지 및 접근 제어")에 따라 **개편**하는 것이 임무다. 1~6장 관련 기존 기능(허브 카드, 진행중인 현장 CRUD, vehicle-fleet 연동 등)은 그대로 유지하고, 7장 내용만 추가 구현한다.

## 범위 제한 (매우 중요)
- **오직 `apps/company-portal/` 폴더 안의 기존 파일(`index.html`, `style.css`, `portal.js`, `app.js`)만 수정한다.** 새 파일을 만들 필요는 없다.
- 프로젝트의 다른 파일(`index.html`, `post.html`, `/css/`, `/js/`, `/posts/`)과 **다른 apps/*/ 폴더(특히 `apps/settlement/`, `apps/vehicle-fleet/`)는 절대 건드리지 않는다.**
- `apps/company-portal/spec.md`, `PLAN_INSTRUCTIONS.md`, `BUILD_INSTRUCTIONS.md`, `review.md`는 참고용이며 수정하지 않는다(단, spec.md는 이미 Plan 단계에서 7장이 추가된 상태이므로 읽기만 한다).

## 절차
1. `apps/company-portal/spec.md`의 **7장 전체**를 먼저 정독해라. 이것이 이번 개편의 구현 명세다(1~6장은 기존 기능 설명이니 참고만 하고 건드릴 필요 없음).
2. 기존 코드 파일(`index.html`, `style.css`, `portal.js`, `app.js`)을 읽어 현재 구조를 파악한다.
3. spec.md 7.5절의 작업 순서 체크리스트(11~17번)를 순서대로 따라 구현한다.
4. spec.md 7.4절 "파일 변경 범위" 표에 명시된 대로 각 파일을 수정한다. 기존 1~6장 관련 로직(현장 CRUD, vehicle-fleet 읽기 전용 연동, 금액 노출 제어, 다크모드, localStorage 키 등)은 **절대 수정하지 않는다** — 새 `internal-area` wrapper로 감싸기만 하면 된다.
5. 비밀번호 해시는 spec.md 7.3절에 명시된 값을 그대로 사용한다: `PASSWORD_HASH = "3c5d8ca315f8c36d4cd4beecbc55b34c92a2d6eb1df730908df6f23dd2aa08f7"` (평문 "7200"의 SHA-256). **코드 어디에도 평문 "7200"을 하드코딩하지 않는다.**
6. 체크리스트 16~17번에 명시된 브라우저 검증(정적 서버로 구동, `file://` 직접 열기 금지)과 회귀 확인(기존 1~6장 기능이 깨지지 않았는지)을 반드시 직접 수행한다.
7. `git diff --stat`으로 `apps/company-portal/` 외 파일이 전혀 변경되지 않았는지 최종 확인한다.
8. 작업이 끝나면 만든/수정한 파일 목록, spec.md에서 벗어난 부분(있다면 이유 포함), 회귀 확인 결과, 다른 앱 폴더 무변경 확인 결과를 300자 이내로 요약해서 보고하라.
