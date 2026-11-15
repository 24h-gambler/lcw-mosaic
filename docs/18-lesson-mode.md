# 18. 수업 API와 디렉터 콘솔 (2026-11-16)

06(수업 아크)의 서버·교사 층입니다. 교사는 디렉터 콘솔에서 수업을 열고, 학생은 **3D 클라이언트 안에서** 지금 단계의 장면(카페·물물교환 등)과 NPC 대화로 같은 목표 문장을 말합니다. 3D가 돌지 않는 기기·브라우저는 `/join` 단어 카드 화면이 같은 API로 대체합니다(WP-106 폴백 사다리와 같은 원칙 — 기본 경로를 대신하지 않음). 모든 발화는 학생별로 남고 07(지표)·10(흐름)을 따릅니다.

## 1. 누가 무엇을 보나

| 사람 | 화면 | 하는 일 |
|---|---|---|
| 교사(운영자) | `/director` | 학생 고르기·등록 → 수업 시작(6자리 참가 코드) → 단계별 목표 문장 띄우기 → 실시간 발화 피드 보기 → F1(코칭)·F2(새 표현) 표시 → 수업 끝 → 부모 리포트 링크 받기 |
| 학생 | `/game/?code=` (3D), 대체 `/join` | 코드 입력 → 지금 단계 장면에서 NPC(또는 빙의한 교사)와 목표 문장 말하기 → 별·코인·오늘 말한 수. 대체 화면은 같은 순서를 단어 카드로 |
| 학부모 | `/r/<토큰>` | 수업 리포트(사실표와 같은 숫자만, 07 §5) |
| 외부인 | `/`, `/try` | 소개와 5분 체험 |

교사 화면은 운영자 토큰을 한 번 입력하면 그 기기 `localStorage`에 남습니다. 학생 화면에는 가격·결제·기한이 없습니다(AGENTS 4.9).

## 2. API 계약

모든 요청과 응답은 JSON입니다. `운영자` = `Authorization: Bearer <LCW_OPERATOR_TOKEN>`, `학생` = `Authorization: Bearer <student_token>`.

| 메서드·경로 | 권한 | 입력 | 출력 |
|---|---|---|---|
| `GET /v1/admin/students` | 운영자 | — | `[{player_id, nickname, level, birth_year, family_id, last_lesson_at, utterances_7d}]` |
| `POST /v1/admin/players` | 운영자 | `{family_id, guardian_id, player_id, nickname, birth_year?, level?}` | `201 {ok}` |
| `POST /v1/admin/lessons/start` | 운영자 | `{player_id, plan_id?}` | `{lesson_id, join_code, expires_at, plan}` |
| `POST /v1/admin/lessons/:id/stage` | 운영자 | `{stage_id, targets: string[]}` | `{ok}` |
| `POST /v1/admin/lessons/:id/pins` | 운영자 | `{kind: 'expression'\|'coaching'\|'highlight', at_ms, note}` | `{ok, id}` |
| `POST /v1/admin/lessons/:id/npc-say` | 운영자 | `{npc_id, text}` (npc_id 는 `LESSON_NPCS`: guide·cafe_owner·shop_owner) | `201 {ok, id, at}` — 그 NPC 에 빙의도 함. 끝난 수업은 409 |
| `POST /v1/admin/lessons/:id/possess` | 운영자 | `{npc_id \| null}` | `{ok, possessed_npc_id}` (null = 빙의 풀기) |
| `POST /v1/admin/lessons/:id/event` | 운영자 | `{kind, detail?}` (kind 6종 = `LESSON_DIRECTOR_EVENTS`, `storage.ts` `DirectorEventKind`) | `201 {ok, id, at}`. 끝난 수업은 409 |
| `GET /v1/admin/lessons/:id/feed?since=<ms>` | 운영자 | — | `{lesson, utterances, pins, live, npc_lines, events, live_cursor, stage_log, minutes, progress, student_view, server_now}` (3절). `?live_cursor=` 를 주면 그 뒤의 대사·이벤트만 |
| `GET /v1/admin/lessons/:id/pin-windows` | 운영자 | — | 핀마다 앞뒤 30초 전사문(학생 발화+빙의 대사)과 F2 표현 후보 — 교사용 리포트 초안 재료. 공개 리포트에는 넣지 않음 |
| `GET /v1/admin/lessons?day=YYYY-MM-DD` | 운영자 | — | `{day, lessons: [{id, player_id, nickname, plan, started_at, ended_at, report_path, utterances, passes}]}` (KST 하루, 허브 카드용) |
| `GET /v1/admin/lessons/live` | 운영자 | — | `{lessons: [{lesson_id, join_code, expires_at, plan_id, player_id, nickname, started_at, stage_id, stage_started_at, stage_ms}], server_now}` — 끝나지 않고 시작 12시간 안(참여 코드 수명)인 수업, smoke- 학생 제외(`?include_test=1` 이면 포함 — 콘솔 `/director?include_test=1` 로 운영 실측). 다른 기기에서 연 콘솔 첫 화면의 「진행 중인 수업 이어 하기」 카드가 씀(시각은 서버 시계, 콘솔이 `server_now` 차이만큼 옮김) |
| `GET /v1/admin/lesson-plans` · `lesson-npcs` · `director-events` | 운영자 | — | `LESSON_PLANS` · `LESSON_NPCS` · `LESSON_DIRECTOR_EVENTS` 그대로 |
| `POST /v1/admin/lessons/:id/end` | 운영자 | `{teacher_comment?, next_lesson_at?}` | `{report_path, share_token, facts}` |
| `GET /v1/admin/students/:id/daily?days=14` | 운영자 | — | `[{day, utterances, passes, words, speaking_ms, lessons}]` |
| `GET /v1/admin/daily?day=YYYY-MM-DD` | 운영자 | — | `{day, students: [{player_id, nickname, utterances, passes, words, speaking_ms, lessons, last_at}]}` |
| `POST /v1/join` | 공개 | `{code}` | `{student_token, lesson_id, player_id, nickname, level}` (코드 6자리, 12시간 유효, 실패 10회/시간 넘으면 429) |
| `GET /v1/lesson/state?cursor=<cursor>&scene=<SceneId>&ui=3d\|cards` | 학생 | — | `{lesson_id, stage_id, stage_goal_ko, mode, scene_id, npc_id, hint, targets, offers:[{stars,text,hintTags}], possessed_npc_id, npc_lines:[{id,seq,at,npc_id,text}], events:[{id,seq,at,kind,detail}], cursor, ended, coins_balance, server_now}` — `coins_balance` 는 아이의 하나뿐인 코인 잔액(홈 월드 장부): 3D HUD(`setCoins`)와 /join 이 첫 조회부터 보여 줌. `lesson_stars` 는 이 수업에서 받은 별 합(수업 중 HUD 별 칩, `setStars` — celebrate 가 따로 더하지 않음), `npc_line_en` 은 단계 대본 첫 줄(대화창 NPC 첫 대사, `DialogConfig.npcLine`) — 3초마다, 앞 응답의 `cursor`(행 번호, 시계가 아님 — 같은 ms 의 두 줄도 한 번씩)를 넘김. `cursor` 없으면(첫 요청·새로고침) 최근 20초의 대사만, 이벤트는 다시 재생하지 않음. 2분보다 오래된 줄은 건너뜀. `scene`·`ui` 는 디렉터 콘솔의 학생 화면 요약으로 |
| `POST /v1/lesson/utterance` | 학생 | `{target_text, transcript, chosen_stars, hint_level, latency_ms, dur_ms, stt_source, confidence}` | `{pass, score, stars, feedback_ko, coins_total, utterances_today}` |
| `GET /v1/reports/:token` | 공개 | — | `{kind, ref_id, facts, body, clips, created_at}` |

### 3. 피드(`feed`) 모양

```json
{
  "lesson": { "id": "les-…", "player_id": "…", "nickname": "…", "started_at": 0, "ended_at": null, "stage_id": "cafe_order", "targets": ["Can I have a warm honey tea?"] },
  "utterances": [{ "id": "…", "at": 0, "target_text": "…", "transcript": "…", "stars": 2, "score": 0.8, "pass": true, "hint_level": "full", "mode": "guided" }],
  "pins": [{ "id": "…", "kind": "expression", "at_ms": 0, "note": "…" }],
  "live": { "utterances": 0, "passes": 0, "stars_total": 0, "words_total": 0, "student_speaking_ms": 0 },
  "npc_lines": [{ "id": "npc-…", "at": 0, "npc_id": "cafe_owner", "text": "Welcome! What would you like?" }],
  "events": [{ "id": "evt-…", "at": 0, "kind": "blackout", "detail": "" }],
  "stage_log": [{ "at": 0, "stage_id": "warmup_anchor" }],
  "minutes": [{ "minute": 0, "student_ms": 3000, "teacher_ms": 2000, "exchanges": 1, "activity": "warmup_anchor" }],
  "progress": { "student_ms": 0, "teacher_ms": 0, "student_talk_ratio": 0, "exchanges": 0, "long_silence_minutes": 0, "mode_breakdown": {} },
  "student_view": { "connected": true, "last_seen_at": 0, "scene_id": "honey_cafe", "ui": "3d", "expected_scene_id": "honey_cafe", "goal_ko": "…", "targets": [], "last_utterance": null },
  "server_now": 0
}
```

**진행표(WP-304 분 단위 집계)**: 발화와 빙의 대사가 들어올 때마다 그 분을 저장된 기록에서 다시 계산해 `LessonDO.recordMinute`로 `lesson_minutes`에 씁니다(다시 써도 같은 값). 학생 시간은 `dur_ms`(없으면 단어×500ms), 교사 시간은 빙의 대사 단어×400ms(WP-306 음성 감지 전까지의 추정, 상수는 `lesson-mode.ts`), 교환 수는 학생 발화 수, 활동은 그 분의 단계입니다. `minutes`는 말이 없던 분도 0으로 채워 빈 구간이 보입니다.

**리포트**: 「수업 끝」은 이번 수업만의 `progress`(숫자만)를 `facts`에 붙이고, `pin_windows`(핀마다 앞뒤 30초의 학생 발화·빙의 대사와 F2 표현 후보, `extractBookmarkWindows`)는 교사에게만 돌려줍니다(`end` 응답·`pin-windows`) — 공개 링크 리포트에 아이 발화 원문·코칭 메모가 나가지 않게(1절 "사실표와 같은 숫자만"). F2 핀은 영어 메모(없거나 한글뿐이면 첫 후보)로 수업 유래 표현(`expressions`, WP-310)에 등록됩니다. 진행 중인 분은 침묵 분으로 세지 않습니다. 학부모용 이번 수업 사실표(`facts.lesson`)는 보호자 도메인이 같은 자리에 붙입니다.

## 4. 첫 수업안 (`plan_id = first_lesson_v1`, 120분 대면)

`packages/content/src/lesson-plans.ts`의 `LESSON_PLANS`가 단계·목표 문장·교사 대본을 담습니다. 단계: ① 인사·고정 과제(자유 발화, 4주 비교 기준선) ② 카페 주문(L1→L3 문장 뱅크) ③ 선생님과 물물교환 역할극 ④ 열린 질문 ⑤ 오늘 표현 회상(힌트 없이) ⑥ 마무리·다음 수업 예고. 단계마다 교사는 목표 문장을 고르거나 직접 써서 학생 화면에 띄웁니다.

## 5. 저장되는 것

발화마다 `utterances`(session_kind=`lesson`, session_id=수업 id), 수업마다 `lessons`·`pins`·`lesson_minutes`(분 단위 진행표)·`lesson_live`(빙의 대사·이벤트, 행 번호 커서)·`lesson_stage_log`(단계 바뀐 시각)·`lesson_director`(빙의 중인 NPC)·`lesson_presence`(학생 화면 마지막 연결·장면), 끝나면 `reports`·`report_deliveries`. 음성 원본은 저장하지 않습니다(동의 전, 16). 매일 수치는 `/v1/admin/daily`로 Mark(허브)가 가져갑니다.

## 6. 이어지는 것

3D 클라이언트는 `/v1/lesson/state`의 `stage_id`로 장면을 바꾸고 `/v1/lesson/utterance`로 채점합니다(수업·월드·대화 도메인 공동 지점). 보호자 로그인(WP-301)과 수업 창문(WP-307)은 보호자 도메인이 같은 수업 id에 붙입니다. 학생 토큰은 수업 하나·학생 한 명에만 쓸 수 있습니다.
