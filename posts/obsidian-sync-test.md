---
title: 옵시디언에서 블로그 자동 업로드 테스트
date: 2026-08-16
---

# 자동 업로드 파이프라인 테스트

이 노트는 Obsidian Vault의 `04 블로그` 폴더에서 `draft: false`인 글을 찾아 `my-blog` 사이트로 자동 업로드하는 과정을 확인하기 위한 테스트 글입니다.

## 동작 방식

- `draft: false`인 노트를 찾아서
- `my-blog/posts/`에 마크다운 파일로 복사하고
- `posts/manifest.json`에 파일명을 추가한 뒤
- git commit/push로 반영합니다

업로드가 끝나면 이 노트의 `draft` 속성이 다시 `true`로 체크됩니다.

> 이 글은 테스트용이라 마음에 들지 않으면 blog 사이트의 `posts/` 폴더와 이 vault의 노트를 함께 지우셔도 됩니다.
