# 18. 수업 API와 월드 안 선생 패널 (2026-11-16, 11-24 R331 디렉터 창 → 월드 패널)

06(수업 아크)의 서버·교사 층입니다. 교사는 디렉터 콘솔에서 수업을 열고, 학생은 **3D 클라이언트 안에서** 지금 단계의 장면(카페·물물교환 등)과 NPC 대화로 같은 목표 문장을 말합니다. 3D가 돌지 않는 기기·브라우저는 `/join` 단어 카드 화면이 같은 API로 대체합니다(WP-106 폴백 사다리와 같은 원칙 — 기본 경로를 대신하지 않음). 모든 발화는 학생별로 남고 07(지표)·10(흐름)을 따릅니다.

## 1. 누가 무엇을 보나

| 사람 | 화면 | 하는 일 |
|---|---|---|
| 교사(운영자) | 월드 안 `/world/?teach=new` → `/world/?teach=<수업>` (R331, 12절). `/director` 는 선생님 로그인 문 + 월드로 넘기는 단추(운영 콘솔은 로그인 뒤 접힘) | 월드 안 접는 패널에서 학생 고르기 → 수업 시작(패널에 참가 숫자) → 아바타로 아이 옆에서 걷고 말하기 → 목표 문장 띄우기 · 아이가 한 말 피드 · F1/F2 핀 · 큰 주머니 물건으로 영어 문장 교환 제안 → 수업 끝(두 번 확인) → 부모 리포트 링크. 별도 창 없음 |
| 학생 | `/world/` 첫 화면 「수업 참가」(참가 숫자) 또는 영어의 날 표(숫자 없이 자동 입장), 대체 `/join?lite=1` | 첫 화면에서 숫자·이름표 확인 한 번 → 새로고침 없이 월드로, 첫 W·A·S·D/E(또는 클릭)가 시점을 잡음 → 지금 단계 NPC 에게 걸어가 E 로 목표 문장 말하기 · 선생님 곁에서 E 로 교환 창 → 별·코인·오늘 말한 수. 학생 화면에는 선생 UI 가 없음. `/join` 은 3D 가능 기기면 `/world/` 로 넘김(`?code=` 보존) |
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
| `POST /v1/admin/lessons/:id/mark-test` | 운영자 | `{note, dry_run?}` | `{lesson_id, player_id, test_player_id, moved:{utterances, expressions, memory_cards, voice_clips_kept, coins, folded_into, report_done, card_done}, report:{rebuilt, report_path} 또는 null}` — 실학생 id 로 돈 시험 세션을 시험 id 로 옮기고 합쳐진 리포트를 같은 링크로 다시 씀(7절). 다시 부르면 `already: true` |
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
  "lesson": { "id": "les-…", "player_id": "…", "join_code": "123456", "nickname": "…", "started_at": 0, "ended_at": null, "stage_id": "cafe_order", "targets": ["Can I have a warm honey tea?"] },
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

**자동 마무리(7절)**: `lesson` 에 `end_reason`(`auto_idle`·null), `report_pending`(보낼 리포트가 선생님 확인을 기다림), `draft_summary_ko`(초안 한 줄), `continues_from`(이어 가는 앞 수업)이 붙습니다. `student_view.mic_issue` = `{issue, raw, at}` 또는 null. `student_view.mic_turns` = `{started, sent, lost, last_lost:{cause, at}|null}` 또는 null — 아이 기기의 마이크 턴 장부(대화 레인 `lcw.micTurns` = `"<시작>.<보냄>.<잃음>|<원인>:<ms>"`, state 조회의 `mic_turns` 로 옴, R2627). 잃은 턴 원인: `no_speech`(raw `vad_quiet` 미터가 1초 넘게 돌며 경계 `VOICE_RMS_BORDER` 아래만 들음·`stt_empty` Whisper 가 빈 글자를 돌려줌·`stt_hallucination` Whisper 의 무음 문구(Thank you. 등)인데 그 턴에 말소리 증거가 없음, 조용함은 이 셋뿐·`no_audio` 녹음 자료 없음) · `quota`(서버 인식 하루 몫, http_429 — '마이크 없음'이 아님) · `stt_failed`(http_413·5xx, 5xx 는 서버가 Workers AI 를 한 번 더 부른 뒤에도 실패한 것) · `network` · `denied`·`unsupported`(raw `gum_*`) · `submit_failed`(채점 보내기 실패) · `closed`(턴 도중 창 닫음).

## 4. 첫 수업안 (`plan_id = first_lesson_v1`, 120분 대면)

`packages/content/src/lesson-plans.ts`의 `LESSON_PLANS`가 단계·목표 문장·교사 대본을 담습니다. 단계: ① 인사·고정 과제(자유 발화, 4주 비교 기준선) ② 카페 주문(L1→L3 문장 뱅크) ③ 선생님과 물물교환 역할극 ④ 열린 질문 ⑤ 오늘 표현 회상(힌트 없이) ⑥ 마무리·다음 수업 예고 ⑦ 모험. 단계마다 교사는 목표 문장을 고르거나 직접 써서 학생 화면에 띄웁니다.

## 5. 저장되는 것

발화마다 `utterances`(session_kind=`lesson`, session_id=수업 id), 수업마다 `lessons`·`pins`·`lesson_minutes`(분 단위 진행표)·`lesson_live`(빙의 대사·이벤트, 행 번호 커서)·`lesson_stage_log`(단계 바뀐 시각)·`lesson_director`(빙의 중인 NPC)·`lesson_presence`(학생 화면 마지막 연결·장면), 끝나면 `reports`·`report_deliveries`. 음성 원본은 저장하지 않습니다(동의 전, 16). 매일 수치는 `/v1/admin/daily`로 Mark(허브)가 가져갑니다.

## 7. 버려진 수업 자동 마무리 (2026-11-16, Oreo 수업)

Oreo 수업(les-20261116-fdbe87bf)은 17:03 에 학생 화면과 콘솔이 둘 다 끊겼고 아무도 「수업 끝」을 누르지 않아 요약·진행표·리포트 없이 열린 채 남았습니다. 그래서 서버가 버려진 수업을 스스로 닫습니다.

- **언제**: 마지막 실제 활동이 `LESSON_IDLE_CLOSE_MS`(15분)보다 오래되면 닫습니다. 실제 활동은 아래 가운데 가장 늦은 것입니다.
  - 학생 화면의 조회(`lesson_presence`)와 학생 답(`utterances`)
  - 선생님의 행동: 대사·이벤트(`lesson_live`), 빙의(`lesson_director`), 단계 바꿈(`lesson_stage_log`), 같은 단계에 문장만 다시 보내기·서버의 자동 진행(`lesson_state.updated_at`), 핀(`pins.at_ms`, 지금 시각을 넘지 않게 자름)
  - **콘솔이 켜져 있기만 한 것(`lesson_teacher` 의 비트)은 활동이 아닙니다**(코디네이터 11-18). Oreo 수업(11-16)은 아이가 17:03 에 떠났는데, 콘솔 탭이 23:25 까지 비트를 보내 7시간 '진행 중'이었고 초안이 422분이었습니다.
  - 1PC 에서 「선생님 나가기」를 누른 뒤 아이 화면이 조회하거나 아이가 답하면, 그것은 아이 쪽 활동으로 칩니다.
  - `lesson_teacher.console_seen_at` 열은 남아 있지만 더는 쓰지 않습니다.
- **바로잡기**: 정리가 돌 때마다 자동 마무리됐지만 아직 보내지 않은 수업을 다시 계산합니다(`reclampAutoClosed`). 끝 시각이 마지막 실제 활동보다 늦으면 `ended_at`·`last_activity_at`·초안을 마지막 실제 활동으로 되돌립니다. 결과는 정리 결과의 `reclamped` 에 남습니다. 이미 허브로 나간 요약 카드가 있으면 바로잡힌 시간으로 다시 보냅니다(시험·빈 수업·오래된 수업처럼 카드가 없던 수업에는 새로 만들지 않음). 바로잡힌 줄은 다음 정리에서 건드리지 않고, 닫힌 지 14일이 지난 줄은 다시 계산하지 않습니다.
- **늦게 온 아이**: 아이가 아직 한 번도 안 온 수업은 참여 코드가 살아 있는 동안 시작 뒤 `LESSON_EMPTY_GRACE_MS`(60분)까지 닫지 않습니다(선생님이 수업을 열고 콘솔을 닫은 뒤 아이가 늦게 와도 들어올 수 있게).
- **누가**: 크론. `wrangler.toml` 트리거 `*/5 * * * *` 가 5분마다 `/internal/cron` 을 부르고, 정시(분 0)에는 대신 `0 * * * *`(매시 일)를 보냅니다(`platform.ts` `scheduled`). 모든 크론이 먼저 정리를 돌립니다. Cloudflare 크론 트리거는 계정당 개수가 정해져 있어 셋을 그대로 씁니다(`0 * * * *` 를 5분짜리로 바꿈).
- **무엇을**: `ended_at` = 마지막 활동 시각(진행표가 빈 15분을 세지 않게), F2 핀 표현 등록, 리포트 초안(`lesson_auto_close.draft` = 부모 사실표·진행 숫자), 참여 코드 삭제·학생 토큰 만료, 허브 카드(요약 카드 제목 「⏸ LCW 수업 자동 마무리됨 · … · 리포트 보내기/이어 하기」, 버튼 「리포트 확인·보내기」 = `/director?auto=<id>`, 「이어 하기」 = `…&next=continue`). 카드의 주소는 배포의 `LCW_PUBLIC_ORIGIN` → 수업을 시작한 주소(`lesson_origins`) → `https://lcw.worldwidesomething.com` 순서입니다(크론에는 요청 주소가 없어서). 카드를 안 만드는 경우: 아이가 한 번도 안 들어온 수업(`empty` — 화면 조회도 답도 없음, 콘솔 상자에도 안 뜨고 이어 하기 대상도 아님), smoke- 학생, 마지막 활동이 24시간 넘은 수업. 수업마다 카드 결과(`sent`·`empty`·`test`·`stale`·`failed:…`)가 정리 결과의 `cards` 와 `ops_runs` 에 남고, 카드 만들기가 실패하면 그 실행은 실패로 남습니다.
- **보내지 않는 것**: `reports`·`report_deliveries` 행을 만들지 않고 보호자 푸시도 없습니다. 보호자에게 가는 리포트는 사람에게 보내는 말이라, 선생님이 콘솔에서 확인하고 「보호자에게 리포트 보내기」(두 번 눌러 확인, `send: true`)를 눌러야 만들고 보냅니다. 옛 콘솔의 「리포트 가져오기」(`send` 없음)는 409 와 초안만 받습니다.
- **이어 하기**: 같은 날(KST) 같은 학생으로 수업을 시작하면(콘솔 「이어 하기」 또는 학생 목록의 시작) 새 수업이 `lesson_continuations` 로 앞 수업을 잇고, 같은 수업안이면 아이가 멈춘 단계에서 시작합니다. 새 수업을 끝내면 리포트 하나에 두 조각이 들어갑니다(`mergeLessonParentFacts`: 수는 더하고, 시간은 조각마다의 분만 — 사이 공백은 빼고). 앞 조각은 `folded_into` 로 표시되고 그 카드는 「이어 한 수업 … 의 보고서에 합쳐 보냄」으로 바뀝니다.
- **콘솔**: 첫 화면의 「진행 중인 수업 이어 하기」는 그대로이고, 그 아래 「자동 마무리된 수업 · 리포트 아직 안 보냄」 상자가 생깁니다(마지막 활동이 14일 안인 것만). 수업을 열면 초안 한 줄과 코멘트 칸, 「보호자에게 리포트 보내기」가 보입니다.
- **시험 수업 표시**(2026-11-19): 실학생 id 로 누가 돌린 세션(11-19 15:55 Oreo — 선생님 접속 0, 말 11번 중 9번 글자 입력, 이미 끝낸 수업안)은 자동 마무리되면 그 아이의 '버려진 수업'으로 보이고, 같은 날 그 아이의 진짜 수업이 이어 받아 리포트가 합쳐집니다. `POST /v1/admin/lessons/:id/mark-test {note, dry_run?}`(운영자)가 그 세션을 시험 id `smoke-test-<수업 id>` 로 옮깁니다. 옮기는 것은 수업·말한 줄·그 수업에서 생긴 표현·기억 카드이고, 학생 토큰은 끝냅니다. 음성 클립은 일부러 아이 쪽에 둡니다. 시험 id 에는 음성 동의가 없어 03:00 보존 정리가 지우기 때문입니다(PR 184 검토). 클립은 옮긴 줄에 달려 있어 어느 리포트도 읽지 않고, 목록은 `voice_clips_kept` 에 남습니다. 그러면 시험 학생을 빼는 모든 곳에서 빠집니다: 콘솔 상자, 이어 하기 후보, 허브 카드와 매시 다시 보내기, 그날 학생 기록 카드, 다음 리포트의 '지난 수업', 주간 숫자. 그 세션이 준 코인은 줄마다 되돌리는 원장 줄(`test-lesson:<줄 id>`)로 아이 잔액에서 뺍니다. 이미 합쳐진 리포트가 있으면 같은 공유 토큰으로 그 세션 없이 다시 씁니다. 전달 줄(상태·보낸 시각·열람·알림)과 리포트의 만든 시각·열람 시각은 그대로라, 이미 보낸 링크도 같은 날짜에 고친 숫자를 보여 줍니다. 알림은 두 번 가지 않습니다(`report:<id>` 키). 그 세션의 허브 카드는 한 번 「🧪 LCW 시험 세션으로 표시함 · … · 리포트 보내지 마세요」로 다시 씁니다. keep 도 보내기 버튼도 없고, 나간 적 없는 카드는 새로 만들지 않습니다. 지우는 것은 없습니다. 원래 학생·옮긴 id·코인·덮기 전 리포트(facts·body·만든 시각·열람 시각)·뒤따르는 단계가 어디까지 됐는지(`report_done`·`card_done`)가 `lesson_test_marks` 에 남습니다. 이미 표시한 수업을 다시 부르면 끝나지 않은 단계(리포트 다시 쓰기 실패 등)를 마저 하고 같은 기록을 돌려줍니다(`already`). 코인은 줄마다 한 번만 빠집니다. 진행 중 수업·시험 학생·자기 리포트가 나간 수업은 거절합니다(409). 이어 하기는 같은 아이의 조각만 잇습니다(`unsentPartsBefore`).
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
| 진행 중 | NPC 빙의·대사 보내기·후속 대사 한 번 누르기 | ~~뺌~~ → 11-19 「선생님이 직접 하기」로 접어서 되살림(10절) | 0번 썼지만 빼고 나니 선생님이 수업에서 할 수 있는 게 없어짐(Dan 11-19) |
| 진행 중 | 이벤트 버튼 6개 | ~~뺌~~ → 11-19 같은 접힘 안으로 되살림(10절) | 같은 이유 |
| 진행 중 | 핀(코칭·표현) 버튼, F1/F2 | 뺌 | 0번 씀. 서버의 핀 API·표현 등록은 그대로 |
| 진행 중 | 도움 띠, 숫자 상자, 분 단위 진행 그래프 | 뺌 | 같은 숫자를 말 목록 제목에 둠. 진행표는 리포트·CSV 에 남음 |
| 진행 중 | 「지금 학생 화면」 문장 목록(단계 패널 아래) | 뺌 | 학생 화면 상자와 겹침 |
| 진행 중 | 「다음 수업」 상자 | 뺌 | 0번 씀 |

시험: `apps/web/src/__tests__/directorLive.test.ts`(뺀 것이 없고 접은 것이 있는지), `lesson.test.ts`(단계 패널). 화면 규칙: 접은 부분은 `<details>` 이고 `data-testid` 는 `director-key-more`·`director-csv-more`·`director-new-student-more`·`director-audio-more`·`teacher-more` 입니다.

## 10. 마지막 칸: 모험 (2026-11-19, R2625)

수업 날의 순서는 … EC Play → LCW → 모험입니다. 두 수업 계획 모두 마무리 뒤에 `adventure` 단계(`ADVENTURE_STAGE_ID`)로 끝납니다.
- **선생님 콘솔**: 단계 안내가 '아이 화면 상태줄의 「🗺 모험」을 같은 탭에서 — 새 탭·다른 기기면 수업 코드 ○○○○'라고 말합니다. 계획 글의 `{code}`(`LESSON_JOIN_CODE_SLOT`)를 콘솔이 그 수업의 코드로 채웁니다. 「수업 끝」·리포트는 이 칸에서 합니다(마무리는 모험으로 넘기며 끝).
- **아이 화면**: 목표 카드는 `Close the chat with ✕, then tap 🗺 Adventure`이고(🗺 는 대화창을 ✕ 로 접어야 보이는 상태줄에 있습니다 — 나가기와 같은 설계), 대화창이 열려 있는 동안은 노란 카드 `lesson-adventure-fold`가 창의 ✕ 바로 왼쪽 같은 줄에서 ➡ 로 ✕ 를 가리킵니다(NPC 말을 덮지 않게 — 위에 두면 390 바닥 창에서 NPC 말을 덮었음. 왼쪽 자리가 없으면 위, 위쪽에 붙으면 아래. 탭은 받지 않음). 이 단계에서는 답을 마치면(✕·완료) 새 창 대신 창이 접혀 상태줄이 바로 보입니다. 상태줄의 🗺 단추(`lesson-adventure`)가 노랗게 켜집니다(`data-now="1"`, 크기는 그대로 — 상태줄의 자리·크기는 틀 레인 몫). 같은 탭이라 수업 토큰(sessionStorage)이 따라가 모험의 🎤가 바로 됩니다.
- **활동**: 모험에서는 월드 조회가 멈춥니다. 두 길이 같은 규칙으로 살아 있음을 셉니다 — 모험이 1분마다 보내는 `GET /v1/lesson/state?away=adventure`(PR 172, 콘솔 장면을 'adventure'로)와, 같은 수업 토큰으로 온 `/v1/converse/stt` 한 번(시각만). 둘 다 `lesson_presence.last_seen_at` 만 움직이고 월드 단계의 분·자동 넘김은 멈춥니다. 그래서 모험 중에 자동 마무리(15분)가 수업을 닫지 않습니다. 모험에서도 아이가 떠난 지 15분이면 마지막 말한 때로 닫힙니다.
- 아이가 월드에 없으니 이 칸의 계획한 분은 저절로 차지 않습니다. 선생님이 「수업 끝」으로 마칩니다.

## 9. 단계 자동 진행 (2026-11-16, R2625·R2627)

Dan: 「별도로 조종 안해도 됩니다」, 「진행 자체가 안되고 계속 있는점」. Oreo 수업의 `lesson_stage_log` 는 25분 동안 `warmup_anchor` 하나뿐이었습니다(선생님이 단계 버튼을 누르지 않으면 넘어가지 않았음). 이제 서버가 진행 중인 단계를 스스로 다음 단계로 넘깁니다(`lesson-mode.ts` `autoAdvance`).

- **언제** (먼저 일어난 것 하나)
  - 그 단계에 들어온 뒤 통과(별 1개 이상)한 **서로 다른** 목표 문장이 `min(목표 수, LESSON_AUTO_ADVANCE_PASSES=2)`개. 같은 문장을 다시 말하면 한 번으로 셉니다. 화면의 문장 없이 한 자유 발화(target_text 빈 값)는 세지 않습니다. 자유 단계(준비·열린 질문)는 후속 질문 끝이나 시간으로 넘어갑니다.
  - 대화창이 그 단계 NPC 의 후속 질문(`followUpsEn`)을 끝까지 함: 아이 기기가 `POST /v1/lesson/stage-done {stage_id}`(학생 토큰). 그 단계에서 통과한 답이 `LESSON_FOLLOWUPS_MIN_ANSWERS`(2, 여는 말 + 후속 하나)개 이상일 때만 넘깁니다. 후속 질문을 모두 「건너뛰기」 해도 대화창은 끝나므로, 답 없이 끝낸 단계는 넘기지 않습니다. 이미 지난 단계의 늦은 신호는 아무것도 바꾸지 않습니다.
  - 그 단계에서 **아이가 화면에 있던 시간**이 계획한 분(`stage.minutes`)을 채움. 아이 화면의 조회(`/v1/lesson/state`, 1.2초마다)가 올 때마다 직전 조회와의 간격을 `lesson_state.child_ms` 에 더합니다. 간격이 `LESSON_CHILD_GAP_MS`(30초)를 넘으면 더하지 않습니다. 그래서 늦게 들어온 아이도 준비 단계를 건너뛰지 않고, 20분 자리를 비웠다 돌아온 아이도 단계를 건너뛰지 않습니다. 단계가 바뀌면 0부터 다시 셉니다.
- **선생님이 이깁니다**: 선생님이 콘솔에서 단계를 바꾸면 그 단계의 수와 시계가 그때부터 다시 셉니다. 마지막 단계는 넘기지 않습니다(「수업 끝」은 선생님이). 끝난 수업은 움직이지 않습니다.
- **콘솔이 따라감**: 피드 조회에서 서버 단계가 바뀌면, 선생님이 지금 단계 패널을 보고 있던 경우 패널도 새 단계로 넘어갑니다(`followStageView`). 그래서 버튼은 계속 「다음 단계로」이고, 한 번 눌러 아이를 이전 단계로 돌려보내는 일이 없습니다.
- **기록**: `lesson_stage_log.source` = null(선생님·시작) 또는 `auto:passes`·`auto:followups`·`auto:time`. 콘솔 피드 `stage_log` 에 그대로 나가고, 단계 패널에 「MM:SS 에 자동으로 넘어왔어요 · 목표 문장 통과」와 지금 단계의 규칙 한 줄이 보입니다.
- **아이 화면**: 답 응답에 `auto_advanced: {from, to, why}`(넘김이 있을 때만, 같은 client_id 의 재전송에는 없음), 조회 응답에 `auto_advanced`(시간으로 넘긴 그 조회만)와 `follow_ups_en`. 답이 단계를 끝내면 컨트롤러가 0.3초 뒤 조회해 다음 단계의 장면·NPC·문장이 바로 뜹니다(`LESSON_ADVANCE_POLL_MS`). 대화창에는 `followUps`(대화 레인)를 넘기고, `onDone(r, {followUpsDone: true})` 이면 `stage-done` 을 부릅니다.
- **마이크 점검 창은 수업당 한 번**(11-18 운영 smoke: 아무도 안 누른 창이 카페·물물교환 대화창 위에 남아 있었음): 단계가 실제로 넘어가면 컨트롤러가 창 이벤트 `lcw:lesson-stage`(`world/events.ts`)를 보내고, 창이 아직 열려 있으면 닫고 'skipped' 로 남깁니다(마이크 턴이 이미 남긴 상태는 지킴). 점검 표시는 이 탭과 기기(localStorage `lcw.lessonMicChecked:<수업>`)에 같이 둬 새로고침·새 탭에서도 다시 뜨지 않습니다. 그 뒤에는 오른쪽 위 작은 마이크 칩(잘 들려요·작아요·없음·점검 안 함)만 보이고, 아이가 칩을 누를 때만 다시 점검합니다.
- **시험**: `apps/edge/src/__tests__/lesson-auto-stage.test.ts`, `apps/client/src/__tests__/lesson-auto-stage.test.ts`, `apps/web/src/__tests__/directorLive.test.ts`. 마이크 창은 `apps/client/src/__tests__/mic-check.test.tsx`.

## 10. 선생님이 직접 하기·수업 중 자유 대화 (2026-11-19, Dan 「LCW 는 선생은 못하고 자유도도 없앴다」)

8절(콘솔 정리)·9절(자동 진행)·#152(수업 중 지나가는 NPC 조용히)가 합쳐져 수업이 '서버가 정한 순서대로만 가는 대본'이 됐습니다. 선생님은 콘솔에서 단계 버튼 하나와 「수업 끝」말고 할 수 있는 것이 없었고, 아이는 수업 중 수업 NPC 말고는 아무와도 말할 수 없었습니다. R2625 ⑥ 「별도로 조종 안해도 됩니다」는 '조종하지 않아도 수업이 돌아가야 한다'는 뜻이지 '선생님이 조종할 수 없어야 한다'는 뜻이 아니었습니다. 그래서:

- **콘솔 「🎤 선생님이 직접 하기」**(`data-testid="director-teach-more"`, 학생 화면 상자 바로 아래, 기본 접힘·이 브라우저가 열림 상태를 기억 `lcw.director.teachOpen`): 펼치면 ① NPC 빙의·대사 보내기(`director-possess`, 지금 단계의 대본·후속 대사 한 번 누르기 포함, `/` 키로 입력창) ② 학생 화면에 내 문장 띄우기(`director-own-target`, `POST /v1/admin/lessons/:id/stage {stage_id: 지금 단계, targets:[문장]}` — 아이 화면의 목표 문장이 바뀌고 그 문장으로 채점) ③ 이벤트 6개(`director-events`, 숫자 키 1–6). 접혀 있으면 상자를 그리지 않아 숫자 키·`/` 키가 아무것도 하지 않습니다. 자동 진행은 그대로 돌고, 선생님이 한 것이 이깁니다(9절).
- **내 문장과 자동 진행**: 문장 띄우기(②와 이벤트 뒤 「목표로 띄우기」)는 `only_if_stage: true` 로 보냅니다. 콘솔이 한 번의 조회만큼 늦어 서버가 이미 다음 단계로 넘겼으면 409 `stage_moved` 로 거절하고(아이를 이전 단계로 돌려보내지 않음) 콘솔은 「그 사이 단계가 넘어갔어요」와 함께 문장을 그대로 둡니다. 통과 수(9절 `passes`)는 그 단계에 들어온 때와 마지막으로 화면 문장이 바뀐 때(`lesson_state.updated_at`: 시작·자동 진행·선생님 문장) 가운데 늦은 때부터 셉니다 — 아이가 앞서 통과한 문장 때문에 선생님 문장이 뜨자마자 단계가 넘어가지 않게.
- **수업 중 자유 대화**: 수업 중에도 지나가는 NPC 가 말 걸기 표시·E·클릭·탭에 답합니다. 수업 레이어가 수업 창을 접고(`LESSON_FREE_TALK_EVENT` `lcw:lesson-free-talk`) 앱이 그 NPC 의 혼자 놀기 대화창을 엽니다. 그 창이 열려 있는 동안 수업 창과 「말하기」 다시 열기 버튼은 그리지 않고(마이크·목소리 겹침 없음), 자유 대화 창을 닫으면 접힌 「🎤 말하기」 버튼이 돌아오고, 그 버튼이나 수업 NPC 로 수업 창을 엽니다. 단계가 넘어가거나 수업이 끝나면 자유 대화 창은 닫힙니다. 같은 단계에 선생님 문장만 바뀐 경우는 자유 대화 창을 닫을 때 보입니다. 자유 대화 창을 열 수 없는 경우(좌석 멈춤, 대화 모듈을 아직 못 받음)에는 탭이 수업 창을 건드리지 않습니다. 둘 다 닿는 거리면 E 는 수업 NPC 를 먼저 고릅니다(지나가는 NPC 는 점수 +1.5). 자유 대화 중에는 심부름이 움직이지 않습니다. 자유 대화는 연결된 아이 기기면 그 아이의 혼자 놀기 기록, 코드로 들어온 아이면 손님 대화로 남고, 수업 발화 수에는 들어가지 않습니다(`passerTaps` 로 따로 셈).
- **11절에서 이어 받음**: 선생님 3D 입장(`/world/?teach=`, 02 §11)에서 선생님이 월드 안에서 직접 말하는 길은 11절 선생님 패널로 생겼습니다(아래 줄은 그 전 상태 기록). 「월드에서 1인칭으로」가 같은 탭에서 넘어가므로, 지금은 콘솔을 다른 탭(또는 폰)에 하나 더 열어 두고 거기서 말해야 합니다. 수업 단계마다 아이를 다음 장면으로 걸어 데려가는 동작(`goToScene`)과 수업 중 '내 월드' 모습(계절·하늘·동물) 대신 마을 기본 모습으로 바뀌는 것은 R2588(선생님이 아이의 내 월드에 들어감)과 어긋나 있고 이 변경에서 바꾸지 않았습니다.
- **시험**: `apps/web/src/__tests__/directorLive.test.ts`(접힘 기본·펼치면 세 상자), `apps/client/src/world/__tests__/events.test.ts`, 야간 실플레이 `tools/real-play.mjs` 의 `lesson-passer`(지나가는 NPC 대화창이 그 NPC 로 열리고 수업 창은 접힌 채).

## 11. 선생님과 함께 걷는 수업 (2026-11-19, R325)

Dan(11-19 수업 중): 「LCW 가 선생님과 함께 진행되지 않는다」, 「'다음'을 누를 때마다 아이가 다음 장소로 순간이동하고 자유도 없이 수업이 이어진다」, 「화면 아래 중앙을 계속 차지하는 부분(수업 창)을 옆 정보 패널로」, 「/director 콘솔이 너무 난잡하다」, 「선생님은 여러 도구·물건을 가지고 아이와 거래할 수 있게. 선생님 아바타에 상호작용 키를 상시 두고, 상호작용하면 언제든 거래 창」.

**원인**(코드로 확인): ① 수업 컨트롤러(`lesson/controller.ts apply`)와 월드 도착 효과(`LessonLayer`)가 단계가 바뀔 때마다 `goToScene` 을 불러 아이를 걸려 보내거나 페이드로 옮겼음 ② 단계·문장이 바뀔 때마다(`panelKey`) 대화 레인의 대화창(화면 아래를 덮고 월드를 멈추는 창)이 저절로 다시 열렸음 ③ 앱이 수업 중 월드 모습을 마을 기본으로 바꿨음(`lessonOn ? null : …`) ④ 선생님 3D 입장(`?teach=`)에서는 말할 길이 없었고, 아이 월드의 선생님 모습은 E·탭으로 고를 수 없었고(`pickableNpc`), 선생님 띠가 목표 카드를 덮었음 ⑤ 콘솔에 실제 수업에서 쓰지 않는 큰 덩어리가 많았음.

- **순간이동 없음**: 단계가 바뀌면 그 단계 NPC 만 제자리로 갑니다(`WorldHandle.placeSceneNpc`, 가까우면 걸어서). 아이는 그대로 있고, 월드의 길 찾기(목표 표시·화면 가장자리 화살표와 거리·빛기둥·미니맵, `setGoalNpc`)가 갈 곳을 가리킵니다. 아이 화면 위치는 `whereNow()`(가장 가까운 장면)로 콘솔 「학생 화면」에 갑니다. 수업 중에도 아이의 내 월드 모습(계절·하늘·동물 친구)이 그대로입니다(코드로 들어온 아이는 학생 토큰으로 `GET /v1/my-world`).
- **대화창은 아이가 열 때만**: E·탭으로 그 단계 NPC 에게 말 걸거나, 옆 패널의 🎤 를 누를 때 열립니다. 다른 NPC 가 단계 NPC 가 되면(새 단계) 열린 창은 닫히고 아이가 걸어갑니다. ✕ 로 닫습니다. 지나가는 NPC·물건과 마음대로 놉니다(10절 자유 대화 그대로).
- **옆 정보 패널**(`lesson/LessonSide.tsx`, `data-testid="lesson-side"`): 오른쪽, HUD 오른쪽 기둥(별·보기 단추·미니맵·1PC 선생님 단추)과 위쪽 목표 카드 아래(`max(--lcw-hud-right-b, --lcw-hud-top-b)`). 펼치면 목표·갈 NPC 와 거리(「29 m · follow the light」, 4 m 안이면 「바로 옆」)·문장·선생님의 최근 말·🎤 말하기·🤝 선생님과 바꾸기·상태줄(함께/혼자·모험·나가기). 펼친 패널은 오른쪽 가장자리 80px(`SIDE_EDGE_LANE_PX`)를 비워 길 찾기 화살표와 거리 글자가 덮이지 않습니다. 높이 500px 이하(폰 가로 844×390)에서는 한 줄(「📘 Lesson · 29m」 🎤 🤝)로 접힌 채 시작하고, 선생님의 새 말은 그 아래 8초 보입니다. 아래 가운데에는 아무것도 두지 않습니다.
- **선생님 하나**: 아이 월드의 선생님 모습(방문 선생님 NPC `teacher`)은 E·클릭·탭으로 고를 수 있고, 고르면 거래 창이 열립니다(`lessonTalkAction` → `'trade'`). 진짜 선생님이 3D 로 들어와 있으면 그 모습이 선생님이 걷는 자리에 서고(`PeerAvatars.roleAt`, 같은 선생님의 두 번째 모습은 그리지 않음 `hiddenRole='teacher'`), 걷는 속도로 걷습니다. 둘 다 닿으면 E 는 단계 NPC 를 먼저 고릅니다(지나가는 쪽 +1.5). 다만 **진짜 선생님이 걸어와 아이 시선 앞(±40°)에 서 있으면 선생님이 이깁니다**(`visitor.npcTalkScore` −2.5, R331 11-24 실측: 안내 NPC 가 발밑 0.8 m·선생님이 정면 2 m 일 때 E 가 안내 NPC 로 가 거래 창이 안 열림). 열린 수업 문장이 남아 있으면 선생님에게 E 를 눌러도 그 문장 창이 먼저 열리므로(`lessonTalkAction` 'reopen') 단계 문장을 건너뛰지 않습니다.
- **선생님 말하기**: 콘솔 「선생님 말하기」와 선생님 3D 패널이 `POST /v1/admin/lessons/:id/npc-say {npc_id:'teacher', text}` 로 보냅니다(빙의 아님 — `possessed_npc_id` 그대로). 아이 화면은 선생님 머리 위 말풍선 + 옆 패널의 「🧑‍🏫 Teacher」 줄. 대화 분(`teacher_ms`)에 셉니다. 3D 패널은 🎤(브라우저 음성 인식 en-US)로 받아 적은 말을 보내기 전에 고칠 수 있고, 지금 단계 대본·후속 질문을 한 번 누르기로 둡니다.
- **선생님이 단계를 쥠**: 선생님 3D 페이지는 `presence {source:'world'}` 로 15초마다 알립니다. 그 알림이 살아 있는 동안(`TEACHER_PRESENT_MS`, 떠나기 신호가 그 뒤에 없을 때) 자동 진행(9절)은 넘기지 않고, 피드 `stage_hold = {held, ready, next_stage_id}` 에 '넘길 때가 됐다'(`passes`·`followups`·`time`)만 알립니다. 선생님이 3D 패널의 「다음 단계로 ▶」나 콘솔 버튼으로 넘깁니다. 3D 페이지를 닫으면 알림이 끊긴 뒤 자동 진행이 돌아옵니다(`TEACHER_WORLD_HOLD`). 아이 조회 응답의 `teacher.in_world` 가 같은 값입니다.
- **같이 걷기**: 3D 패널의 「같이 걷기」(`WorldHandle.followPeer('student')`)는 아이 2.5 m 앞까지 따라 걷고, 선생님이 방향키·스틱을 잡으면 바로 선생님 조종으로 돌아갑니다. 「학생 옆으로」는 그대로(`goNearPeer`).
- **선생님 물건**(`packages/content/src/lesson-trade.ts TEACHER_STOCK`): 마을이 이미 정의한 것을 그대로 — 교환 상점 도구 8 + 카페 메뉴 13 + 가구점 9 = 30개(같은 item key·이름·그림·월드 모델). 선생님 몫은 줄지 않습니다.
- **주기**: 콘솔 「주고받기 · 물건 주기」와 3D 패널이 `POST /v1/admin/lessons/:id/give {item_key, client_id}`. 서버가 아이 홈 월드 가방(5칸이 차면 상자)에 넣고(`lesson-trade.ts applyLessonTrade`, 한 트랜잭션·되돌리기 기록 `lesson.trade`), 선생님 줄 「Here is a map for you!」과 `gift` 줄을 남깁니다. 아이 컨트롤러는 조회의 `gifts` 를 id 마다 한 번 `giveItem`(손·핫바). 같은 `client_id` 는 한 번만 줍니다(`lesson_trades` 기본 키, 다시 오면 저장한 답 + `replayed`).
- **거래**: 아이가 선생님에게 E·탭 또는 🤝 → 거래 창(`TradeWindow`): 「선생님 물건」 30개 + 「내 물건」(`GET /v1/lesson/trade`, 가방·핫바·상자의 내 것)에서 받을 것·줄 것을 고르고 「🎤 영어로 말해서 바꾸기」 → 대화 레인의 대화창이 선생님을 NPC 로, 그 거래의 세 문장(`tradeOffers`: 1성 「The lantern, please.」 · 2성 「Can I have the lantern, please?」/「Can I trade my rope for the boots?」 · 3성 꾸밈말 붙인 문장, L3 부터 「Could I …」「I'd like to trade …」)을 카드로 띄웁니다. 답은 `POST /v1/lesson/trade {client_id, get_key, give_item_id, target_text, transcript, …}`: 서버가 ① 같은 `client_id` 면 저장한 답 ② 준다는 물건이 정말 아이 것인지(`item_not_owned` 409) ③ 고른 문장이 그 거래의 문장인지(`not_a_trade_sentence` 400 — 「hi」로 거래 못 함) ④ 수업 문장처럼 채점(`scoreUtterance`) ⑤ **통과했을 때만** 옮김(준 물건은 `lesson-teacher:<수업>` 몫·위치 'given', 받은 물건은 가방/상자). 결과의 `itemKey` 를 대화창이 손에 쥐여 주고 준 물건은 핫바에서 뺍니다. 선생님 답 「Deal! Here are the boots. Thank you for the rope!」이 선생님 줄로 갑니다. 발화는 `ctx:'trade'`, `interlocutor:'teacher'` 로 수업 발화에 남지만 단계 통과(9절)·수업 별 합계·코인에는 들어가지 않습니다(받은 물건이 보상). 한 수업 60번까지(`LESSON_TRADES_MAX`).
- **콘솔 정리**(8절에 더함):

| 자리 | 무엇 | 처리 | 이유 |
|---|---|---|---|
| 맨 위 | 참가 코드 띠(코드 112px, 주소 두 줄·복사·유효 시각, 타이머 48px) | 한 줄 띠로: 코드 36px, 주소·복사·유효 시각은 「참가 주소 · 다른 기기로 들어오기」로 접음, 타이머 28px | 로그인한 기기로 들어오면 코드는 필요 없고, 코드로 들어올 때도 숫자 여섯 개만 보이면 됨 |
| 맨 위 | 「선생님 표시 · 1PC 잠금」 상자 | 제목 「선생님」, 「🧭 월드에 들어가기 (학생과 같이 걷고 말하고 주고받기)」 | 수업의 기본 길이 월드 안으로 들어가는 것 |
| 왼쪽 | 단계 7줄(한 줄 44px, 단계마다 경과·계획 시간) | 번호 칩 한 줄(지금 단계만 제목·시간, 지난 단계는 「1 ✓」, 제목은 칩에 마우스) | 7줄이 화면 절반. 지난·다음 단계 시간은 수업 중 안 봄 |
| 왼쪽 | 단계 패널의 자동 진행 설명 문단·「지금 할 일」 큰 상자 | 설명은 한 줄(선생님이 월드에 있으면 「단계는 선생님이 넘길 때까지 기다려요」), 넘길 때가 되면 초록 알림 한 줄, 진행 안내는 「이 단계 진행 안내」로 접음 | 대본·문장·버튼만 매번 봄 |
| 오른쪽 | (새로) 「선생님 말하기」·「주고받기」 | 학생 화면 상자 바로 아래 | 선생님이 수업에서 실제로 할 것 |
| 오른쪽 | 「선생님이 직접 하기」(빙의·내 문장·이벤트)·「보호자에게 수업 소리」 | 「더 보기 · 직접 조종·이벤트 · 수업 소리」 하나로 묶음(안의 접힘·`data-testid` 그대로) | 선생님 말하기가 생겨 빙의는 드물게 씀 |
| 오른쪽 | 아이가 한 말 목록 | 남김. 높이 560 → 320px, 줄마다 붙던 모드 글자(guided·free) 뺌 | 모드는 단계 칩에 이미 있음 |

진행 중 화면 높이(1440×900, 같은 수업): 정리 전 스크린샷 기준 2배 넘던 것이 1809px.

- **선생님 3D 화면**(`world/TeacherBar.tsx`): 왼쪽, HUD 위쪽 묶음 아래(`--lcw-hud-top-b`)의 접는 패널(높이 500 이하면 접힌 채). 학생 수·학생 옆으로·같이 걷기·콘솔로 / 단계 n/7 · 제목, 쥐고 있음, 넘길 때 알림, 「다음 단계로 ▶ 다음 제목」 / 말하기(입력·🎤·대본 한 번 누르기) / 학생의 마지막 말 / 물건 주기·주고받기(접힘). 피드는 2.5초마다(`TEACH_FEED_MS`), 아이 월드 모습(`world_look`)을 받아 선생님도 아이의 월드를 봅니다. 선생님 페이지에는 손님용 첫 방문 안내·목표 사슬이 뜨지 않습니다.
- **월드 도메인 접점**(같은 PR, 최소): `world/engine.ts` — `placeSceneNpc`·`whereNow`·`npcDistance`·`followPeer` 핸들, 진짜 선생님이 있으면 선생님 NPC 를 그 자리에 세우는 몇 줄, 같이 걷기 몇 줄. `world/peers.ts` — `hiddenRole`·`roleAt`. `world/visitor.ts` — `pickableNpc` 에서 선생님 제외를 뺌. `world/api.ts` — 위 선택 멤버. HUD(`world/hud*`)·플레이어 물리·핫바 파일은 건드리지 않았습니다.
- **R326 (Dan 11-19 18시 지적, 같은 PR)**:
  - ⑨ 대화 창이 화면을 가림 → 데스크톱(가로 761px·세로 521px 넘음)에서도 대화 창은 오른쪽 정보 패널(`min(440px, 38vw)`, 별 칩 아래 64px부터, 어둡게 덮는 층 없음)입니다. 폰 가로는 `min(52vw, 560px)`(전에는 60vw). 월드는 왼쪽에서 NPC 를 비춥니다(`dialogViewInset` → `setViewInset` rightPx). 실측 1280×800: 창 왼쪽 828px(월드 65%), 844×390: 405px(월드 48%), 겹침 0.
  - ④ 건너뛰기만 눌러 넘어감 → 수업 대화창은 후속 질문을 **한 번 말해 본 뒤에만** 「다음으로」가 나옵니다(`skipNeedsTry`; 그 전에는 「🎤 한 번 말해 보면 다음으로 갈 수 있어요」). 건너뛰기와 말 없이 닫은 창은 `POST /v1/lesson/skip {client_id, stage_id, kind:'follow_up'|'close', question, tried}` 로 `lesson_skips` 에 남고(같은 client_id 한 번), 피드 `skips = {total, untried, stage, stage_untried, heavy, recent}` 가 콘솔 「아이가 한 말」 위에 「건너뛰기 n번 (말 안 하고 m번)」, 한 단계 3번·한 수업 5번 넘으면(`LESSON_SKIP_HEAVY_*`) 빨간 경고. 계획한 분(9절 'time')은 **그 단계에서 아이가 한 번이라도 말했을 때만** 단계를 넘기고, 말 없이 시간이 지나면 피드 `stage_hold.quiet` → 콘솔 「아이가 아직 말하지 않았어요 — 넘어가려면 다음 단계로(선생님 승인)」. 건너뛰기는 별·코인·단계 통과 어디에도 들어가지 않습니다.
  - ⑫ 억지 교육 → 자기 말과 놀이 속 임무: 수업 대화창은 guided 단계도 **자유 말하기**(`mode:'free'`)로 열고 단계 문장은 「이런 말도 할 수 있어요」 아이디어(단어 카드·키보드 그대로). 서버는 문장 없이 온 말(`target_text ''`)을 guided 단계의 문장들(화면 문장 먼저, 별 높은 순, 힌트 없음)과 견주어 하나라도 통과하면 **그 문장의 임무 통과**로 채점·기록(`mission_text`, 단계 통과·별·코인·기억 카드 그대로), 아니면 자유 대화 점수(말한 만큼 별). free 단계는 그대로(문장 통과로 넘기지 않음). 수업 중 지나가는 NPC 에게 E·탭하면 그 NPC 창도 수업 답 경로로 가서(선생님이 피드에서 봄, 좌석 없는 아이도 수업 중에는 말 걸 수 있음) 자기 말로 합니다. 선생님 거래도 자기 말(「can i have the lantern please」)이 그 거래 문장을 담으면 통과, 아무것도 안 담으면 거래 없이 「무엇을 바꾸고 싶은지 영어로 말해 봐요」. 거래 창의 「💬 그냥 이야기하기」는 선생님에게 자기 말로 말 걸기(수업 자유 대화). 옆 패널은 **임무 목록**(📋 Missions: 한 임무 ✓ · 지금 임무 ▶ 와 갈 곳·거리·「내 말로 해도 돼요. 예:」 한 문장 · 아무에게나 내 말로 말 걸기 · 선생님과 물건 바꾸기), HUD 위 목표 카드는 임무 한 줄만(문장 줄 없음).
- **독립 검토 반영(R326)**: 거래는 대화 창 하나에 한 번(`window_id` = 대화 창 id; 같은 창에서 별을 더 받으려 다시 말해도 물건은 다시 안 옴), 시도도 한 수업 240번까지. 기억 카드에 묶인 물건(`card_id`)은 「내 물건」에 안 나옴. 선물·거래로 받은 것이 가방이 아니라 상자로 갔으면 손에 쥐지 않음, 받은 선물 id 는 탭 저장소(`lcw.lessonGiftsSeen`)에도 남겨 다시 불러와도 한 번. 선생님 3D 탭이 숨겨졌거나 다른 탭에 밀렸으면 `source:'console'` 로 알려 단계 쥐기가 풀림(잊은 뒷탭이 수업을 멈추지 않음). 수업 중 가게(교환 상점)·심부름 대화는 수업 경로가 아니라 제 경로(구매·심부름이 사라지지 않음). 지나가는 NPC 와의 자기 말도 그 단계 임무를 담으면 임무 통과로 셈(아이가 고른 행동이 곧 수업). 후속 질문 중 ✕ 는 그 질문 건너뛰기로 기록, 시도는 채점이 돌아온 뒤에만 셈.
- **시험**: `apps/edge/src/__tests__/lesson-teacher-trade.test.ts`(거래 한 번만 옮김·틀린 문장·남의 물건·맞바꿈·선물 커서·선생님 말·단계 쥐기), `apps/client/src/__tests__/lesson-teacher-trade.test.tsx`(단계 바뀜에 순간이동 없음·선생님 말과 선물 한 번·거래 결과·옆 패널 자리·접힘), `packages/content/src/__tests__/lesson-trade.test.ts`, `apps/web/src/__tests__/lesson.test.ts`(콘솔). 실화면: 학생·선생님 두 창 headless 실측(1280×800, 844×390 터치).

## 12. 함께 진행 — 별도 창 없는 수업 (2026-11-24, R331)

Dan 11-23: 디렉터 별도 창을 없애고 선생님이 월드 안 아바타로 수업을 이끈다.

- **선생 패널** (`apps/client/src/world/TeacherBar.tsx`): `?teach=new` 는 시작 모드(학생 목록 `GET /v1/admin/students` → `POST /v1/admin/lessons/start {presence:true}` → `?teach=<id>`). 진행 중에는 참가 숫자(`feed.lesson.join_code`, 끝나면 null) · 단계 · 목표 문장(`POST /stage {only_if_stage}`) · 아이가 한 말 5줄 · F1 코칭/F2 표현 핀(`POST /pins`) · 교환 제안 · 수업 끝(두 번 확인 → `POST /end` → `/r/<토큰>`). 패널은 접힘. 모든 호출은 운영자 토큰만 — 학생 토큰·무토큰·틀린 토큰은 401/403 (`apps/edge/src/__tests__/r331-teacher-panel.test.ts`).
- **학생 입장** (`apps/client/src/start/StartFlow.tsx` `LessonJoin`): 첫 화면 「수업 참가」 숫자 → `POST /v1/join` → 세션 저장 → 이름표 확인 → 새로고침 없이 월드 + 바로 시점 잡기. 영어의 날 표(ed-link SSO → `GET /v1/device/lesson` → `POST /v1/device/lesson/join`)는 숫자 없이 그대로. 옛 `/join` 은 3D 가능 기기면 `/world/?code=` 로. `/director` 는 선생님 로그인 문 + 넘김(`apps/web/src/DirectorHandoff.tsx`): 로그인 전에는 콘솔 로그인(Google·운영 열쇠)이 펼쳐지고 월드 단추가 꺼져 있음, 로그인하면 「월드에서 수업 시작하기」(`/world/?teach=new`)가 켜지고 운영 콘솔(좌석·가입 승인)은 접힘. 월드의 선생 주소(`?teach=`)를 로그인 없이 열면 일반 플레이어로 들어가지 않고 `/director` 로 돌려보냄(`teachSignInRedirect`).
- **조작** (`engine.ts` `LOCK_KEYS`): 포인터 잠금은 사용자 제스처가 필요한데, 11-24 headed Chromium 실측(타이머·Esc 는 NotAllowedError, KeyW·KeyE keydown 은 성공)으로 첫 W·A·S·D·방향키·E·Space 가 시점을 잡는다 — 클릭 0번도 됨. 한 번 잡은 뒤 Esc 로 풀면 화면 가운데 「계속하려면 화면이나 W·A·S·D 를 한 번 눌러요」. 선생님도 잠그고 Esc 로 마우스를 풀어 패널을 씀.
- **교환**: 선생님은 물건 + 서버가 채점하는 `tradeOffers` 문장(물건 이름만 ⭐1 / `Can I have the X, please?` ⭐2 / 꾸밈말까지 ⭐3)을 골라 말풍선으로 제안(목표 문장은 안 바꿈). 아이는 선생님 곁에서 E → 교환 창에서 말함 → `POST /v1/lesson/trade` 가 같은 채점으로 별을 정하고 통과해야 물건이 넘어감. 성립한 교환 수는 리포트 `facts.lesson.teacher_trades`(공개 허용 목록 포함, 부모 화면 「영어로 말해 선생님과 바꾼 물건」)와 허브 수업 요약 카드·학생 하루 카드에 숫자로(원문 없음).

## 6. 이어지는 것

3D 클라이언트는 `/v1/lesson/state`의 `stage_id`로 장면을 바꾸고 `/v1/lesson/utterance`로 채점합니다(수업·월드·대화 도메인 공동 지점). 보호자 로그인(WP-301)과 수업 창문(WP-307)은 보호자 도메인이 같은 수업 id에 붙입니다. 학생 토큰은 수업 하나·학생 한 명에만 쓸 수 있습니다.
