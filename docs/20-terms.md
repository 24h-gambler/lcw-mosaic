# 20. 제품 용어집

사용자에게 보이는 모든 글(아이 화면, 보호자 화면, 교사 콘솔, 소개 사이트, 메타 태그, 공유 미리보기, 알림, URL)에 쓰는 낱말을 이 한 곳에서 정합니다. 다른 문서와 코드는 이 표를 따릅니다.

## 1. 쓰지 않는 낱말 (운영자 지시 2026-11-16)

| 시험 id | 쓰지 않는 것 | 대신 쓰는 것 | 예 |
|---|---|---|---|
| `ko-game` | 게임 | **월드**(제품 전체, 3D 공간), **마을**(월드 안의 장소), **놀이**(놀이 방식·모드), **플레이**(하는 행위, 플레이 시간) | "3D 블록 게임" → "3D 블록 월드", "게임 시간" → "플레이 시간", "게임만 하게 되지 않을까요" → "놀기만 하게 되지 않을까요" |
| `en-game` | game, games (영어 문장) | world, town, play | "Play the game" → "Come into the world" |
| `path-game` | URL `/game` | `/world/` | `/game/?code=482913` → `/world/?code=482913` |

- 이 낱말은 아이에게 "공부가 아니라 놀이"라는 인상을 주려는 마케팅 문구에서도 쓰지 않습니다. LCW 는 말하기 연습이 일어나는 **월드**입니다.
- 목표 언어 연습 문장도 같습니다(예: `I like playing games after school.` → `I like playing soccer after school.`).
- 코드 식별자·파일 이름(`GameCanvas.tsx`, `size="game"`)과 주석, 내부 설계 문서(`15` 참조 게임 분석 등)는 사용자에게 보이지 않으므로 대상이 아닙니다.

## 2. 강제하는 곳

| 어디서 | 무엇을 | 도구 |
|---|---|---|
| `pnpm test` | `apps/web/src`, `apps/client/src`, `apps/edge/src`, `packages/content/src`, `packages/ui/src`의 문자열·템플릿·JSX 글, `index.html` 제목·메타, 웹 매니페스트, 사전 렌더한 사이트 페이지 전부 | `tools/forbidden-words.mjs`, 시험 `tools/__tests__/forbidden-words.test.ts` |
| 매일 밤 운영 화면 | 운영 주소의 실제 화면 글(1440·390) | `tools/nightly-audit.mjs` |

TypeScript 컴파일러로 소스를 읽기 때문에 주석과 식별자는 걸리지 않고, 화면에 나가는 글만 걸립니다. 영어 `game`은 띄어쓰기가 있는 문장(또는 JSX 글)에서만 찾으므로 `size: 'game'` 같은 낱말 하나짜리 값은 걸리지 않습니다.

예외는 `tools/forbidden-words.mjs`의 `ALLOW`에 이유와 함께 둡니다. 지금은 두 곳뿐입니다.

1. `apps/edge/src/world-path.ts`: `/game` → `/world/` 리다이렉트가 옛 경로를 알아야 합니다.
2. `apps/web/src/site/prerender.tsx`: `robots.txt`의 `Disallow: /game/`(검색 로봇이 읽는 줄).

예외를 늘리는 것은 제품 결정입니다. 시험을 통과시키려고 예외를 더하지 않습니다.

## 3. 옛 주소 `/game/`

3D 월드는 `/world/`에 있습니다. `/game`, `/game/`, `/game/…`은 Worker가 `302`로 같은 자리의 `/world/…`로 보내고 쿼리 문자열(`?code=`, `?pass=`, `?scene=`)을 그대로 넘깁니다(`apps/edge/src/world-path.ts`, 시험 `apps/edge/src/__tests__/world-path.test.ts`). 수업 코드 링크, 친구 초대권 링크, 북마크가 깨지지 않습니다. 되돌릴 수 있게 영구(301)가 아니라 임시(302)로 둡니다.

## 4. 그 밖의 용어

| 쓰는 말 | 뜻 | 쓰지 않는 말 |
|---|---|---|
| 월드 | 플레이어 한 명이 가진 3D 공간 하나(좌석당 5개, `03`) | 맵, 서버(공개 목록의 "공개 서버"만 예외) |
| 마을 | 월드 안의 도시 구역과 그 장소들 | |
| 놀이 방식 | 생존·건축·아레나·역할극·캠페인 같은 모드(`01`) | 게임 모드 |
| 플레이 시간 | 아이가 월드에 들어가 있는 시간 | 게임 시간 |
| 수업 | 교사가 있는 120분(`18`) | 세션(사용자 글에서) |
| 보호자 | 학부모 화면의 사용자 | |
