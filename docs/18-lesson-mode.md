# 18. 수업 API와 디렉터 콘솔 (2026-11-16)

06(수업 아크)의 서버·교사 층입니다. 교사는 디렉터 콘솔에서 수업을 열고, 학생은 **3D 클라이언트 안에서** 지금 단계의 장면(카페·물물교환 등)과 NPC 대화로 같은 목표 문장을 말합니다. 3D가 돌지 않는 기기·브라우저는 `/join` 단어 카드 화면이 같은 API로 대체합니다(WP-106 폴백 사다리와 같은 원칙 — 기본 경로를 대신하지 않음). 모든 발화는 학생별로 남고 07(지표)·10(흐름)을 따릅니다.

## 1. 누가 무엇을 보나

| 사람 | 화면 | 하는 일 |
|---|---|---|
| 교사(운영자) | `/director` | 학생 고르기·등록 → 수업 시작(6자리 참가 코드) → 단계 넘기기(수업안 문장 그대로) → 학생 화면·아이가 한 말 보기 → 수업 끝 → 부모 리포트 링크 받기 |
| 학생 | `/world/?code=` (3D), 대체 `/join` | 코드 입력 → 지금 단계 장면에서 NPC(또는 빙의한 교사)와 목표 문장 말하기 → 별·코인·오늘 말한 수. 대체 화면은 같은 순서를 단어 카드로 |
| 학부모 | `/r/<토큰>` | 수업 리포트(사실표와 같은 숫자만, 07 §5) |
| 외부인 | `/`, `/try` | 소개와 3분 체험 |

교사 화면은 운영자 토큰을 한 번 입력하면 그 기기 `localStorage`에 남습니다. 학생 화면에는 가격·결제·기한이 없습니다(AGENTS 4.9).

## 2. API 계약

모든 요청과 응답은 JSON입니다. `운영자` = `Authorization: Bearer <LCW_OPERATOR_TOKEN>`, `학생` = `Authorization: Bearer <student_token>`.

| 메서드·경로 | 권한 | 입력 | 출력 |
|---|---|---|---|
| `GET /v1/admin/students` | 운영자 | — | `[{player_id, nickname, level, birth_year, family_id, last_lesson_at, utterances_7d}]` |
| `POST /v1/admin/players` | 운영자 | `{family_id, guardian_id, player_id, nickname, birth_year?, level?}` | `201 {ok}` |
| `POST /v1/admin/lessons/start` | 운영자 | `{player_id, plan_id?, presence?}` | `{lesson_id, join_code, expires_at, plan, stage_id, continues_from}` — 같은 학생의 오늘(KST) 자동 마무리된 수업(7절)이 리포트를 아직 안 보냈으면 그 수업을 이어 감: `continues_from` 에 그 id, 같은 수업안이면 `stage_id` 가 아이가 멈춘 단계 |
| `POST /v1/admin/lessons/:id/stage` | 운영자 | `{stage_id, targets: string[]}` | `{ok}` |
| `POST /v1/admin/lessons/:id/pins` | 운영자 | `{kind: 'expression'\|'coaching'\|'highlight', at_ms, note}` | `{ok, id}` |
| `POST /v1/admin/lessons/:id/npc-say` | 운영자 | `{npc_id, text}` (npc_id 는 `LESSON_NPCS`: guide·cafe_owner·shop_owner) | `201 {ok, id, at}` — 그 NPC 에 빙의도 함. 끝난 수업은 409 |
| `POST /v1/admin/lessons/:id/possess` | 운영자 | `{npc_id \| null}` | `{ok, possessed_npc_id}` (null = 빙의 풀기) |
| `POST /v1/admin/lessons/:id/event` | 운영자 | `{kind, detail?}` (kind 6종 = `LESSON_DIRECTOR_EVENTS`, `storage.ts` `DirectorEventKind`) | `201 {ok, id, at}`. 끝난 수업은 409 |
| `GET /v1/admin/lessons/:id/feed?since=<ms>` | 운영자 | — | `{lesson, utterances, pins, live, npc_lines, events, live_cursor, stage_log, minutes, progress, student_view, server_now}` (3절). `?live_cursor=` 를 주면 그 뒤의 대사·이벤트만 |
| `GET /v1/admin/lessons/:id/pin-windows` | 운영자 | — | 핀마다 앞뒤 30초 전사문(학생 발화+빙의 대사)과 F2 표현 후보 — 교사용 리포트 초안 재료. 공개 리포트에는 넣지 않음 |
| `GET /v1/admin/lessons?day=YYYY-MM-DD` | 운영자 | — | `{day, lessons: [{id, player_id, nickname, plan, started_at, ended_at, report_path, end_reason, report_pending, utterances, passes}]}` (KST 하루, 허브 카드용). `end_reason` = `auto_idle`(자동 마무리) 또는 null, 이어 한 수업에 합쳐 보낸 조각은 그 리포트의 `report_path` |
| `GET /v1/admin/lessons/live` | 운영자 | — | `{lessons: [{lesson_id, join_code, expires_at, plan_id, player_id, nickname, started_at, stage_id, stage_started_at, stage_ms}], server_now}` — 끝나지 않고 시작 12시간 안(참여 코드 수명)인 수업, smoke- 학생 제외(`?include_test=1` 이면 포함 — 콘솔 `/director?include_test=1` 로 운영 실측). 다른 기기에서 연 콘솔 첫 화면의 「진행 중인 수업 이어 하기」 카드가 씀(시각은 서버 시계, 콘솔이 `server_now` 차이만큼 옮김). `auto_closed: [{lesson_id, player_id, nickname, plan_id, started_at, ended_at, closed_at, stage_id, utterances, passes, draft_summary_ko}]` 는 리포트를 아직 안 보낸 자동 마무리 수업(14일 안, 이어 하는 중인 것 제외) — 콘솔 「자동 마무리된 수업」 상자 |
| `GET /v1/admin/lesson-plans` · `lesson-npcs` · `director-events` | 운영자 | — | `LESSON_PLANS` · `LESSON_NPCS` · `LESSON_DIRECTOR_EVENTS` 그대로 |
| `POST /v1/admin/lessons/:id/end` | 운영자 | `{teacher_comment?, next_lesson_at?, send?}` | `{report_path, share_token, facts}` — 자동 마무리된 수업은 `send: true` 일 때만 리포트를 만들어 보냄(없으면 409 `auto_closed_unsent` + `draft_summary_ko`). 이어 한 수업은 앞 조각까지 한 리포트로(7절) |
| `POST /v1/admin/lessons/sweep-idle` | 운영자 | `{dry_run?}` | `{open, idle:[{lesson_id, test, last_activity_at, idle_min}], closed, dry_run}` — 크론과 같은 버려진 수업 정리를 바로 돌림(`dry_run` 이면 보기만) |
| `GET /v1/admin/students/:id/daily?days=14` | 운영자 | — | `[{day, utterances, passes, words, speaking_ms, lessons}]` |
| `GET /v1/admin/daily?day=YYYY-MM-DD` | 운영자 | — | `{day, students: [{player_id, nickname, utterances, passes, words, speaking_ms, lessons, last_at}]}` |
| `POST /v1/join` | 공개 | `{code}` | `{student_token, lesson_id, player_id, nickname, level}` (코드 6자리, 12시간 유효, 실패 10회/시간 넘으면 429) |
| `GET /v1/lesson/state?cursor=<cursor>&scene=<SceneId>&ui=3d\|cards` | 학생 | — | `{lesson_id, stage_id, stage_goal_ko, mode, scene_id, npc_id, hint, targets, offers:[{stars,text,hintTags}], possessed_npc_id, npc_lines:[{id,seq,at,npc_id,text}], events:[{id,seq,at,kind,detail}], cursor, ended, coins_balance, server_now}` — `coins_balance` 는 아이의 하나뿐인 코인 잔액(홈 월드 장부): 3D HUD(`setCoins`)와 /join 이 첫 조회부터 보여 줌. `lesson_stars` 는 이 수업에서 받은 별 합(수업 중 HUD 별 칩, `setStars` — celebrate 가 따로 더하지 않음), `npc_line_en` 은 단계 대본 첫 줄(대화창 NPC 첫 대사, `DialogConfig.npcLine`) — 3초마다, 앞 응답의 `cursor`(행 번호, 시계가 아님 — 같은 ms 의 두 줄도 한 번씩)를 넘김. `cursor` 없으면(첫 요청·새로고침) 최근 20초의 대사만, 이벤트는 다시 재생하지 않음. 2분보다 오래된 줄은 건너뜀. `scene`·`ui` 는 디렉터 콘솔의 학생 화면 요약으로. `mic`(ok·quiet·none·skipped)와 `mic_issue`(대화 레인 sessionStorage `lcw.micIssue` 그대로, `"<issue>:<브라우저 코드>\|<ms>"`)는 콘솔 학생 화면 상자의 마이크 줄 — 마이크가 ok 가 아니면 원인별로 할 일을 한 줄로(`autoCloseStrings.ts` `micIssueLine`) |
| `POST /v1/lesson/utterance` | 학생 | `{target_text, transcript, chosen_stars, hint_level, latency_ms, dur_ms, stt_source, confidence}` | `{pass, score, stars, feedback_ko, feedback_en, coins_total, utterances_today, repeat?}` — 아이 화면은 `feedback_en`, 한국어는 도움말 줄(`lcw.helpKo`)로만. **별은 목표당 한 번(R2627, `lesson-stars.ts`)**: 같은 단계에서 이미 통과한 목표(guided 는 같은 `target_text`, free 는 낱말 겹침 0.7 이상인 앞 통과)를 다시 말하면 그 목표의 최고 별을 넘는 만큼만 더함 — 같거나 낮으면 `stars: 0`·`repeat: true`·코인 0·`feedback_en` 「You already got stars for that! Now say something new.」, 높으면 화면엔 이번 별·행에는 차이만 저장(수업 별 합·코인·단계 통과 수가 되풀이로 늘지 않음). 아이 화면은 repeat 에 별을 날리지 않고 「한 번 더」를 먼저 보임 |
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

**자동 마무리(7절)**: `lesson` 에 `end_reason`(`auto_idle`·null), `report_pending`(보낼 리포트가 선생님 확인을 기다림), `draft_summary_ko`(초안 한 줄), `continues_from`(이어 가는 앞 수업)이 붙습니다. `student_view.mic_issue` = `{issue, raw, at}` 또는 null. `student_view.mic_turns` = `{started, sent, lost, last_lost:{cause, at}|null}` 또는 null — 아이 기기의 마이크 턴 장부(대화 레인 `lcw.micTurns` = `"<시작>.<보냄>.<잃음>|<원인>:<ms>"`, state 조회의 `mic_turns` 로 옴, R2627). 잃은 턴 원인: `no_speech`(raw `vad_quiet` 음량 못 넘음·`stt_empty` Whisper 가 낱말 못 들음·`no_audio` 녹음 자료 없음) · `quota`(서버 인식 하루 몫, http_429 — '마이크 없음'이 아님) · `stt_failed`(http_413·5xx) · `network` · `denied`·`unsupported`(raw `gum_*`) · `submit_failed`(채점 보내기 실패) · `closed`(턴 도중 창 닫음).

## 4. 첫 수업안 (`plan_id = first_lesson_v1`, 120분 대면)

`packages/content/src/lesson-plans.ts`의 `LESSON_PLANS`가 단계·목표 문장·교사 대본을 담습니다. 단계: ① 인사·고정 과제(자유 발화, 4주 비교 기준선) ② 카페 주문(L1→L3 문장 뱅크) ③ 선생님과 물물교환 역할극 ④ 열린 질문 ⑤ 오늘 표현 회상(힌트 없이) ⑥ 마무리·다음 수업 예고. 단계마다 교사는 목표 문장을 고르거나 직접 써서 학생 화면에 띄웁니다.

## 5. 저장되는 것

발화마다 `utterances`(session_kind=`lesson`, session_id=수업 id), 수업마다 `lessons`·`pins`·`lesson_minutes`(분 단위 진행표)·`lesson_live`(빙의 대사·이벤트, 행 번호 커서)·`lesson_stage_log`(단계 바뀐 시각)·`lesson_director`(빙의 중인 NPC)·`lesson_presence`(학생 화면 마지막 연결·장면), 끝나면 `reports`·`report_deliveries`. 음성 원본은 저장하지 않습니다(동의 전, 16). 매일 수치는 `/v1/admin/daily`로 Mark(허브)가 가져갑니다.

## 7. 버려진 수업 자동 마무리 (2026-11-16, Oreo 수업)

Oreo 수업(les-20261116-fdbe87bf)은 17:03 에 학생 화면과 콘솔이 둘 다 끊겼고 아무도 「수업 끝」을 누르지 않아 요약·진행표·리포트 없이 열린 채 남았습니다. 그래서 서버가 버려진 수업을 스스로 닫습니다.

- **언제**: 학생 화면의 조회(`lesson_presence`), 학생 답(`utterances`), 콘솔 신호(`lesson_teacher` 마지막 신호·나가기), 빙의(`lesson_director`), 빙의 대사·이벤트(`lesson_live`), 단계 바꿈(`lesson_stage_log`) 가운데 가장 늦은 것이 `LESSON_IDLE_CLOSE_MS`(15분)보다 오래되면. 콘솔이 켜져 있거나 아이 화면이 열려 있으면 닫지 않습니다. 1PC 에서 「선생님 나가기」를 누른 뒤에도 아이 화면의 조회·답, 그리고 그 수업에 켜져 있는 콘솔(`lesson_teacher.console_seen_at`, 나간 뒤의 신호는 '선생님 있음'으로는 안 치지만 활동으로는 칩니다)이 있으면 열려 있습니다. 아이가 아직 한 번도 안 온 수업은 참여 코드가 살아 있는 동안 시작 뒤 `LESSON_EMPTY_GRACE_MS`(60분)까지 닫지 않습니다(선생님이 수업을 열고 콘솔을 닫은 뒤 아이가 늦게 와도 들어올 수 있게).
- **누가**: 크론. `wrangler.toml` 트리거 `*/5 * * * *` 가 5분마다 `/internal/cron` 을 부르고, 정시(분 0)에는 대신 `0 * * * *`(매시 일)를 보냅니다(`platform.ts` `scheduled`). 모든 크론이 먼저 정리를 돌립니다. Cloudflare 크론 트리거는 계정당 개수가 정해져 있어 셋을 그대로 씁니다(`0 * * * *` 를 5분짜리로 바꿈).
- **무엇을**: `ended_at` = 마지막 활동 시각(진행표가 빈 15분을 세지 않게), F2 핀 표현 등록, 리포트 초안(`lesson_auto_close.draft` = 부모 사실표·진행 숫자), 참여 코드 삭제·학생 토큰 만료, 허브 카드(요약 카드 제목 「⏸ LCW 수업 자동 마무리됨 · … · 리포트 보내기/이어 하기」, 버튼 「리포트 확인·보내기」 = `/director?auto=<id>`, 「이어 하기」 = `…&next=continue`). 카드의 주소는 배포의 `LCW_PUBLIC_ORIGIN` → 수업을 시작한 주소(`lesson_origins`) → `https://lcw.worldwidesomething.com` 순서입니다(크론에는 요청 주소가 없어서). 카드를 안 만드는 경우: 아이가 한 번도 안 들어온 수업(`empty` — 화면 조회도 답도 없음, 콘솔 상자에도 안 뜨고 이어 하기 대상도 아님), smoke- 학생, 마지막 활동이 24시간 넘은 수업. 수업마다 카드 결과(`sent`·`empty`·`test`·`stale`·`failed:…`)가 정리 결과의 `cards` 와 `ops_runs` 에 남고, 카드 만들기가 실패하면 그 실행은 실패로 남습니다.
- **보내지 않는 것**: `reports`·`report_deliveries` 행을 만들지 않고 보호자 푸시도 없습니다. 보호자에게 가는 리포트는 사람에게 보내는 말이라, 선생님이 콘솔에서 확인하고 「보호자에게 리포트 보내기」(두 번 눌러 확인, `send: true`)를 눌러야 만들고 보냅니다. 옛 콘솔의 「리포트 가져오기」(`send` 없음)는 409 와 초안만 받습니다.
- **이어 하기**: 같은 날(KST) 같은 학생으로 수업을 시작하면(콘솔 「이어 하기」 또는 학생 목록의 시작) 새 수업이 `lesson_continuations` 로 앞 수업을 잇고, 같은 수업안이면 아이가 멈춘 단계에서 시작합니다. 새 수업을 끝내면 리포트 하나에 두 조각이 들어갑니다(`mergeLessonParentFacts`: 수는 더하고, 시간은 조각마다의 분만 — 사이 공백은 빼고). 앞 조각은 `folded_into` 로 표시되고 그 카드는 「이어 한 수업 … 의 보고서에 합쳐 보냄」으로 바뀝니다.
- **콘솔**: 첫 화면의 「진행 중인 수업 이어 하기」는 그대로이고, 그 아래 「자동 마무리된 수업 · 리포트 아직 안 보냄」 상자가 생깁니다(마지막 활동이 14일 안인 것만). 수업을 열면 초안 한 줄과 코멘트 칸, 「보호자에게 리포트 보내기」가 보입니다.
- **Cloudflare SQLite 제약**: 마지막 활동은 UNION 이 아니라 한 행짜리 스칼라 서브쿼리로 구합니다. workerd 의 SQLite 는 다섯 항목을 넘는 compound SELECT 를 거절합니다("too many terms in compound SELECT", 11-16 배포에서 정리가 이것으로 실패). 시험의 node:sqlite 는 이를 받아 주므로, 배포 전에 `pnpm test:workerd-sql`(시험이 돌린 SQL 을 workerd 에 다시 돌림, `tools/workerd-sql.mjs`)을 돌리고, `lesson-autoclose.test.ts` 의 불변 시험이 소스의 UNION 항목 수를 막습니다.
- **확인**: `POST /v1/admin/lessons/sweep-idle {dry_run:true}` 로 지금 닫힐 수업을 봅니다. `ops_runs` 의 `lesson_idle_sweep` 은 닫은 것이 있을 때와 매일 03시에 남습니다. 시험은 `apps/edge/src/__tests__/lesson-autoclose.test.ts`, `apps/web/src/__tests__/director-autoclose.test.ts` 입니다.
- **허브 중계**: 카드는 서버 출력함에 쌓이고 집 PC 중계(`tools/lesson-watch.mjs --relay`)가 돌 때 허브로 갑니다. 중계 시간 밖에 닫힌 수업의 카드는 다음 중계 때 갑니다.

## 8. 콘솔에 남긴 것·접은 것·뺀 것 (2026-11-16, R2625)

Dan(선생님) 수업 뒤 말: 「쓸데없는 기능이나 버튼들이 많이 있던데 … 별도로 조종 안해도 됩니다」. 근거는 첫 실제 수업(Oreo, les-20261116-fdbe87bf)의 운영 기록입니다. 빙의 대사 0, 이벤트 0, 핀 0, 단계 바꿈 0 — 선생님은 학생 화면과 아이가 한 말만 봤습니다. 정리 전 진행 중 화면은 누를 것 47개, 높이 3386px(1280 폭)였습니다. 서버 API(`/director/say`·`/event`·`/pins`·`/stage`)는 그대로 두었습니다. 콘솔에서 버튼만 뺐고, 대화·월드 도메인과 자동 진행(②)이 같은 API 를 씁니다.

| 자리 | 무엇 | 처리 | 이유 |
|---|---|---|---|
| 첫 화면 | 학생 목록·「수업 시작」, 「진행 중인 수업 이어 하기」, 자동 마무리 상자, 가입 승인 대기 | 남김 | 수업을 여는 데 씀 |
| 첫 화면 | 선생님 열쇠 상자 | 로그인했으면 맨 아래 「선생님 열쇠 · 로그인」으로 접음 | 한 번 넣으면 끝. 열쇠가 없거나 틀리면 맨 위에 그대로 |
| 첫 화면 | 오늘 기록 CSV·진행표 CSV | 「오늘 기록 내려받기 (CSV)」로 접음 | 수업 중엔 안 씀. 종합 보고서는 학생 문서(english-day)가 맡음 |
| 첫 화면 | 새 학생 직접 등록 | 접음 | 보통은 보호자 가입 → 승인 |
| 첫 화면 | 「1PC · 2PC」 상자 | 상자를 없애고 안내 글만 남김 | 버튼이 없는 설명 |
| 진행 중 | 학생 화면 상자(장면·마지막 말·마이크 원인 한 줄) | 남김 | 실제로 본 것 |
| 진행 중 | 아이가 한 말 목록 | 남김. 제목에 말·통과·별 수를 붙임 | 실제로 본 것. 따로 있던 숫자 상자를 합침 |
| 진행 중 | 단계 패널 | 남김. 수업안 문장 목록(읽기 전용) + 버튼 하나(지금 단계면 「다음 단계로 ▶」, 다른 단계면 「이 단계로 바꾸기」). 분 단위 진행 방법은 접음 | 조종 없이 가는 게 목표(② 자동 진행). 문장 고르기 체크박스·직접 쓰는 문장 칸은 뺌 |
| 진행 중 | 「수업 끝」·리포트 상자 | 남김 | 보호자에게 가는 말은 선생님 확인 뒤에만(KEEP) |
| 진행 중 | 선생님 상태 한 줄·나가기·「월드에서 1인칭으로」 | 남김 | 퍼포먼스 레인의 1인칭 버튼 포함 |
| 진행 중 | 학생 화면에 보일 이름·1PC 잠금 번호 | 「… (필요할 때만)」으로 접음 | 한 번 정하면 끝 |
| 진행 중 | 보호자에게 수업 소리 들려주기(WP-307) | 접음 | 실제 수업에서 안 씀. 기능은 살림 |
| 진행 중 | NPC 빙의·대사 보내기·후속 대사 한 번 누르기 | 뺌 | 0번 씀. 후속 대사는 대화 레인의 `followUps` 가 맡음 |
| 진행 중 | 이벤트 버튼 6개 | 뺌 | 0번 씀 |
| 진행 중 | 핀(코칭·표현) 버튼, F1/F2 | 뺌 | 0번 씀. 서버의 핀 API·표현 등록은 그대로 |
| 진행 중 | 도움 띠, 숫자 상자, 분 단위 진행 그래프 | 뺌 | 같은 숫자를 말 목록 제목에 둠. 진행표는 리포트·CSV 에 남음 |
| 진행 중 | 「지금 학생 화면」 문장 목록(단계 패널 아래) | 뺌 | 학생 화면 상자와 겹침 |
| 진행 중 | 「다음 수업」 상자 | 뺌 | 0번 씀 |

시험: `apps/web/src/__tests__/directorLive.test.ts`(뺀 것이 없고 접은 것이 있는지), `lesson.test.ts`(단계 패널). 화면 규칙: 접은 부분은 `<details>` 이고 `data-testid` 는 `director-key-more`·`director-csv-more`·`director-new-student-more`·`director-audio-more`·`teacher-more` 입니다.

## 9. 단계 자동 진행 (2026-11-16, R2625·R2627)

Dan: 「별도로 조종 안해도 됩니다」, 「진행 자체가 안되고 계속 있는점」. Oreo 수업의 `lesson_stage_log` 는 25분 동안 `warmup_anchor` 하나뿐이었습니다(선생님이 단계 버튼을 누르지 않으면 넘어가지 않았음). 이제 서버가 진행 중인 단계를 스스로 다음 단계로 넘깁니다(`lesson-mode.ts` `autoAdvance`).

- **언제** (먼저 일어난 것 하나)
  - 그 단계에 들어온 뒤 통과(별 1개 이상)한 **서로 다른** 목표 문장이 `min(목표 수, LESSON_AUTO_ADVANCE_PASSES=2)`개. 같은 문장을 다시 말하면 한 번으로 셉니다. 화면의 문장 없이 한 자유 발화(target_text 빈 값)는 세지 않습니다. 자유 단계(준비·열린 질문)는 후속 질문 끝이나 시간으로 넘어갑니다.
  - 대화창이 그 단계 NPC 의 후속 질문(`followUpsEn`)을 끝까지 함: 아이 기기가 `POST /v1/lesson/stage-done {stage_id}`(학생 토큰). 그 단계에서 통과한 답이 `LESSON_FOLLOWUPS_MIN_ANSWERS`(2, 여는 말 + 후속 하나)개 이상일 때만 넘깁니다. 후속 질문을 모두 「건너뛰기」 해도 대화창은 끝나므로, 답 없이 끝낸 단계는 넘기지 않습니다. 이미 지난 단계의 늦은 신호는 아무것도 바꾸지 않습니다.
  - 그 단계에서 **아이가 화면에 있던 시간**이 계획한 분(`stage.minutes`)을 채움. 아이 화면의 조회(`/v1/lesson/state`, 3초마다)가 올 때마다 직전 조회와의 간격을 `lesson_state.child_ms` 에 더합니다. 간격이 `LESSON_CHILD_GAP_MS`(30초)를 넘으면 더하지 않습니다. 그래서 늦게 들어온 아이도 준비 단계를 건너뛰지 않고, 20분 자리를 비웠다 돌아온 아이도 단계를 건너뛰지 않습니다. 단계가 바뀌면 0부터 다시 셉니다.
- **선생님이 이깁니다**: 선생님이 콘솔에서 단계를 바꾸면 그 단계의 수와 시계가 그때부터 다시 셉니다. 마지막 단계는 넘기지 않습니다(「수업 끝」은 선생님이). 끝난 수업은 움직이지 않습니다.
- **콘솔이 따라감**: 피드 조회에서 서버 단계가 바뀌면, 선생님이 지금 단계 패널을 보고 있던 경우 패널도 새 단계로 넘어갑니다(`followStageView`). 그래서 버튼은 계속 「다음 단계로」이고, 한 번 눌러 아이를 이전 단계로 돌려보내는 일이 없습니다.
- **기록**: `lesson_stage_log.source` = null(선생님·시작) 또는 `auto:passes`·`auto:followups`·`auto:time`. 콘솔 피드 `stage_log` 에 그대로 나가고, 단계 패널에 「MM:SS 에 자동으로 넘어왔어요 · 목표 문장 통과」와 지금 단계의 규칙 한 줄이 보입니다.
- **아이 화면**: 답 응답에 `auto_advanced: {from, to, why}`(넘김이 있을 때만, 같은 client_id 의 재전송에는 없음), 조회 응답에 `auto_advanced`(시간으로 넘긴 그 조회만)와 `follow_ups_en`. 답이 단계를 끝내면 컨트롤러가 0.3초 뒤 조회해 다음 단계의 장면·NPC·문장이 바로 뜹니다(`LESSON_ADVANCE_POLL_MS`). 대화창에는 `followUps`(대화 레인)를 넘기고, `onDone(r, {followUpsDone: true})` 이면 `stage-done` 을 부릅니다.
- **시험**: `apps/edge/src/__tests__/lesson-auto-stage.test.ts`, `apps/client/src/__tests__/lesson-auto-stage.test.ts`, `apps/web/src/__tests__/directorLive.test.ts`.

## 6. 이어지는 것

3D 클라이언트는 `/v1/lesson/state`의 `stage_id`로 장면을 바꾸고 `/v1/lesson/utterance`로 채점합니다(수업·월드·대화 도메인 공동 지점). 보호자 로그인(WP-301)과 수업 창문(WP-307)은 보호자 도메인이 같은 수업 id에 붙입니다. 학생 토큰은 수업 하나·학생 한 명에만 쓸 수 있습니다.
