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
| `GET /v1/admin/lessons/:id/feed?since=<ms>` | 운영자 | — | `{lesson, utterances, pins, live}` (3절) |
| `POST /v1/admin/lessons/:id/end` | 운영자 | `{teacher_comment?, next_lesson_at?}` | `{report_path, share_token, facts}` |
| `GET /v1/admin/students/:id/daily?days=14` | 운영자 | — | `[{day, utterances, passes, words, speaking_ms, lessons}]` |
| `GET /v1/admin/daily?day=YYYY-MM-DD` | 운영자 | — | `{day, students: [{player_id, nickname, utterances, passes, words, speaking_ms, lessons, last_at}]}` |
| `POST /v1/join` | 공개 | `{code}` | `{student_token, lesson_id, player_id, nickname, level}` (코드 6자리, 12시간 유효, 실패 10회/시간 넘으면 429) |
| `GET /v1/lesson/state` | 학생 | — | `{lesson_id, stage_id, targets, ended}` |
| `POST /v1/lesson/utterance` | 학생 | `{target_text, transcript, chosen_stars, hint_level, latency_ms, dur_ms, stt_source, confidence}` | `{pass, score, stars, feedback_ko, coins_total, utterances_today}` |
| `GET /v1/reports/:token` | 공개 | — | `{kind, ref_id, facts, body, clips, created_at}` |

### 3. 피드(`feed`) 모양

```json
{
  "lesson": { "id": "les-…", "player_id": "…", "nickname": "…", "started_at": 0, "ended_at": null, "stage_id": "cafe_order", "targets": ["Can I have a warm honey tea?"] },
  "utterances": [{ "id": "…", "at": 0, "target_text": "…", "transcript": "…", "stars": 2, "score": 0.8, "pass": true, "hint_level": "full", "mode": "guided" }],
  "pins": [{ "id": "…", "kind": "expression", "at_ms": 0, "note": "…" }],
  "live": { "utterances": 0, "passes": 0, "stars_total": 0, "words_total": 0, "student_speaking_ms": 0 }
}
```

## 4. 첫 수업안 (`plan_id = first_lesson_v1`, 120분 대면)

`packages/content/src/lesson-plans.ts`의 `LESSON_PLANS`가 단계·목표 문장·교사 대본을 담습니다. 단계: ① 인사·고정 과제(자유 발화, 4주 비교 기준선) ② 카페 주문(L1→L3 문장 뱅크) ③ 선생님과 물물교환 역할극 ④ 열린 질문 ⑤ 오늘 표현 회상(힌트 없이) ⑥ 마무리·다음 수업 예고. 단계마다 교사는 목표 문장을 고르거나 직접 써서 학생 화면에 띄웁니다.

## 5. 저장되는 것

발화마다 `utterances`(session_kind=`lesson`, session_id=수업 id), 수업마다 `lessons`·`pins`, 끝나면 `reports`·`report_deliveries`. 음성 원본은 저장하지 않습니다(동의 전, 16). 매일 수치는 `/v1/admin/daily`로 Mark(허브)가 가져갑니다.

## 6. 이어지는 것

3D 클라이언트는 `/v1/lesson/state`의 `stage_id`로 장면을 바꾸고 `/v1/lesson/utterance`로 채점합니다(수업·월드·대화 도메인 공동 지점). 보호자 로그인(WP-301)과 수업 창문(WP-307)은 보호자 도메인이 같은 수업 id에 붙입니다. 학생 토큰은 수업 하나·학생 한 명에만 쓸 수 있습니다.
