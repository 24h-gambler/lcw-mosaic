# 19. 클라이언트 도메인 사이 계약 (2026-11-16)

`apps/client`는 세 도메인이 같이 씁니다(`11` 0장). 서로 기다리지 않도록 경계와 인터페이스를 여기서 한 번 정합니다. 바꿀 때는 이 문서를 같은 PR에서 고칩니다.

## 1. 파일 소유

| 경로 | 소유 도메인 | 내용 |
|---|---|---|
| `apps/client/src/world/**`, `apps/client/src/main.tsx`, `apps/client/src/App.tsx` | 월드 | 렌더러, 청크·메싱 Worker, 장면(프리팹), 캐릭터·카메라, 쌓기·부수기, 효과, 앱 껍데기 |
| `apps/client/src/dialog/**`, `packages/converse`, `packages/audio`, `packages/content`의 뱅크 | 대화 | 대화창, 마이크·인식 폴백 사다리, 조합판, 힌트, 채점 요청, 보상 연출 |
| `apps/client/src/lesson/**`, `apps/edge/src/lesson-mode.ts`, `apps/web` 디렉터 콘솔 | 수업 | 참가 코드, 수업 상태 따라 장면 바꾸기, 빙의 대사, 이벤트 |

## 2. 월드 → 다른 도메인 (`apps/client/src/world/api.ts`)

```ts
export type SceneId = 'plaza' | 'honey_cafe' | 'trade_shop' | 'build_plot' | 'open_hill';
export interface NpcRef { id: string; ctx: NpcContext; nameKo: string; nameEn: string }
export type DirectorEventKind = 'weather_shift' | 'blackout' | 'npc_prompt' | 'mentor_dungeon_gate' | 'review_chest' | 'star_celebration';
export interface WorldHandle {
  goToScene(id: SceneId): Promise<void>;            // 46 m 이내는 걸어가고, 멀거나 막히면 문 연출(페이드)로
  onNpcInteract(cb: (npc: NpcRef) => void): () => void; // E 키·탭으로 NPC에게 말 걸기
  npcSay(npcId: string, text: string, opts?: { possessed?: boolean }): void; // 말풍선(빙의 중엔 반짝임)
  playerSay(text: string): void;
  giveItem(itemKey: string): void;                  // 주문한 음료·교환한 물건이 손/슬롯에
  celebrate(stars: 0 | 1 | 2 | 3, opts?: { add?: number }): void; // 별 연출·효과음 (0 = '다시 해 볼까요'), add = 별 칩 증가분(기본 stars)
  setGoal(goalKo: string, targetEn?: string): void; // 화면 맨 위 목표 한 줄
  setPaused(paused: boolean): void;                 // 대화창이 열리면 이동 멈춤 + 플레이어 어깨 너머 NPC 얼굴 구도
  dispose(): void;
  // 선택(월드가 구현, 다른 도메인은 있으면 씀)
  setPossessed?(npcId: string | null): void;        // 교사 빙의 표시(머리 위 반짝임)
  playDirectorEvent?(kind: DirectorEventKind, detail: string): void; // 디렉터 이벤트 연출
  getScene?(): SceneId;
  listNpcs?(): NpcRef[];
  setLessonBadge?(on: boolean): void;               // 장면 이름 옆 '수업 중'
  setCoins?(total: number | null): void;           // 별 옆 코인 칩(서버 장부 잔액), null 이면 숨김
  getStats?(): WorldStats;                          // fps·draw call·삼각형·청크 수(검증용)
  setViewInset?(bottomPx: number): void;            // 화면 아래를 덮은 패널 높이: 대화 구도를 그 위 띠 가운데에(0 = 없음)
}
export function createWorld(opts: { canvas: HTMLCanvasElement; tier: 'low' | 'mid' | 'high'; startScene?: SceneId; hudRoot?: HTMLElement }): Promise<WorldHandle>;
export function canRunWorld(): boolean;             // WebGL2 가 없으면 false → /join 단어 카드
```

NPC id·ctx (대화 뱅크가 `npc.ctx`로 찾는 값):

| id | 이름 | ctx | 나오는 장면 |
|---|---|---|---|
| `guide` | 안내인 선생님 (Luna) | `guide` | plaza · build_plot · open_hill (장면을 따라 옮겨 다님) |
| `cafe_owner` | 카페 주인 하니 (Hani) | `cafe` | honey_cafe |
| `shop_owner` | 상점 주인 토비 (Toby) | `trade_shop` | trade_shop |

월드 도메인은 첫 PR에서 이 인터페이스를 (내용이 단순하더라도) 먼저 머지해 다른 도메인이 붙을 수 있게 합니다.

## 3. 대화 → 다른 도메인 (`apps/client/src/dialog/DialogPanel.tsx`)

- 소리(WP-110, `12` 12장): 페이지의 AudioContext는 `apps/client/src/audio/runtime.ts`의 `getAudioRuntime()` 하나입니다. 새 소리는 자기 컨텍스트를 만들지 말고 `rt.unlock()`(탭 안에서)로 컨텍스트를 얻어 `rt.bus('sfx'|'ui'|'amb'|'bgm'|'voice_npc'|'voice_lesson')`에 연결하고, 시작 전에 `rt.admit(id, bus, durMs)`로 상한·마이크 중 침묵·폭발 묶기를 확인합니다. 덕킹은 `rt.duck(reason, on)`(수업 상시 `lesson_active`, 수업 음성 감지 `lesson_vad`, 말풍선 입력 `skill_or_bubble`). 마이크를 여는 곳은 `micCue()`(`dialog/sound.ts`)가 true 로 끝난 뒤 녹음을 시작합니다.

```ts
export interface DialogOffer { stars: 1 | 2 | 3; text: string; hintTags: string[] }
export interface DialogResult { pass: boolean; stars: number; feedbackKo: string; coinsTotal?: number }
export interface DialogPanelProps {
  npc: NpcRef;
  level: Level;
  mode: 'free' | 'guided' | 'read' | 'recall';
  offers: DialogOffer[];                  // 비면 뱅크에서 npc.ctx로 찾음
  hint: 'full' | 'keyword' | 'initial' | 'picture' | 'none';
  submit: (u: UtteranceSubmit) => Promise<DialogResult>; // 수업이면 /v1/lesson/utterance, 혼자면 /v1/converse/*
  onDone: (r: DialogResult) => void;
  onClose: () => void;
  onResult?: (r: DialogResult) => void;   // 결과가 뜨는 순간마다(통과·실패) — 별·코인·아이템을 '좋아요' 전에 반영
}
```

`UtteranceSubmit`은 `/v1/lesson/utterance` 본문(`18` 2장)과 같은 모양입니다. 채점·코인은 언제나 서버 값입니다.

구현(2026-11-16, 대화 도메인):

- 타입은 `apps/client/src/dialog/types.ts`. `DialogResult`의 선택 필드:
  - `missed?: string[]`: 서버가 못 들은 단어(밑줄 표시용).
  - `itemKey?: string`: 서버가 실제로 주고 월드 `items` 표에 적은 아이템. 월드는 **있을 때만** 이것을 `giveItem` 합니다. 없으면(코인 부족·실패·가격 0 문장) 아무것도 주지 않습니다 — 장면 기본값으로 대신 주지 않습니다(AGENTS 4.7).
  - `askedKey?: string`: 가격 0 문장(물물교환·길 묻기)에서 아이가 말한 대상. 교환 상점이면 바꿀 물건(교환 자체는 `/v1/worlds/:id/trades` 정산), 안내인이면 가리킬 장소.
  - `matchedText?: string`: 자유 대화에서 서버가 맞춰 채점한 뱅크 문장.
- `UtteranceSubmit`의 선택 필드 `echo?`·`attempt?`·`dialogId?`는 혼자 경로용 메타입니다. 수업 submit은 이 셋을 빼고 보냅니다(수업 본문은 strict).
- 한 번 연 대화창 = 한 번의 구매(`dialogId`): "별 하나 더"로 다시 말하면 가격이 최고 별 기준으로 내려가 차액을 돌려받고, 응답을 못 받아 다시 보내도 두 번 빠지지 않습니다. 통과한 뒤 "별 하나 더"에 실패하거나 창을 닫아도(✕·Esc) `onDone`에 그 창의 최고 결과가 갑니다. `onClose`는 아무것도 사지 않았을 때만 불립니다.
- 서버만 정하는 것: ECHO(같은 창에서 서버가 실패 2번을 기록한 뒤에만 낮은 통과선), 별 등급(아이 레벨의 뱅크 문장만 — 그 NPC에 그 레벨 문장이 있으면 다른 레벨 문장은 인정 안 함), 학생 경로에서 뱅크에 없는 문장은 별 0. 음성인지(`stt_source`)·받아쓴 글은 브라우저 STT 구조상 클라가 보내므로, 서버 Whisper(`/v1/converse/stt`)가 붙으면 그 결과로 바꿉니다.
- `DialogPanelProps`에 선택 필드 `npcLine?`(NPC 첫 질문, 없으면 맥락별 기본 대사), `fontScale?`(1~1.5), `speech?`(시험·미리보기용 음성 엔진).
- 음성 클립(보호자 다시 듣기, `apps/edge/src/voice.ts`, 2026-11-16): `DialogPanelProps.recordClip?`가 true면(앱이 정함: 수업 중이면 `/v1/join`의 `voice_store`를 담은 `sessionStorage` `lcw.studentVoice`, 아니면 `GET /v1/device/me`의 `voice_store`, 게스트는 항상 false) 마이크가 켜진 동안만 `@lcw/audio` `createMediaClipRecorder`(Opus 24kbps WebM, Safari는 MP4, 최대 12.5초)로 그 말 한 번을 메모리에 녹음합니다. 들린 말이 없으면 버립니다. 클립은 채점 요청 본문에 실리지 않고, 서버가 `/v1/converse/score`·`/v1/lesson/utterance` 응답에 `audio_upload {token(48자 16진수), max_bytes, expires_at}`을 줄 때만 `POST /v1/voice/upload/<token>`으로 한 번 올립니다(본문 = 오디오 그대로, 10분·한 번만, 256KB 이하, WebM/Ogg/MP4 매직 바이트만, 그 사이 동의가 꺼졌으면 403). `audio_upload`는 말소리 입력(`browser`·`device`·`workers_ai`)이고 보호자가 `voice_store`를 켰고 R2가 붙어 있을 때만 옵니다. 채점 요청의 `audio_key`는 받아도 저장하지 않습니다. 녹음이 인식을 방해하지 않게: 인식이 먼저 마이크를 잡고, 녹음기가 함께 있는 동안 인식이 `denied`로 끝나면 그 기기는 `localStorage` `lcw.clip.off`로 녹음을 영구히 끕니다. `/join` 단어 카드 화면도 같은 녹음기·같은 업로드를 씁니다.
- `DialogPanel.tsx`는 `DialogPanel`과 함께 `createSoloSubmit(npc)`(학생 토큰으로 `/v1/converse/score`), `createLessonSubmit({token})`을 내보냅니다. 혼자 경로에서 서버는 토큰에서 학생·집 월드(`home-<player>`, 처음에 시작 코인 1회)·레벨을 정하고, 별·가격·아이템을 문장 뱅크에서 정합니다(요청의 `price`·`item_id`는 무시).
- 입력 사다리: 브라우저 음성 인식(en-US) → 안 되면(카카오톡 등 인앱 브라우저, 미지원, 권한 거부, 2회 연속 못 들음) 단어 카드 조합판 → 글자 입력. 카드·글자 입력은 별 2개까지(`04` 4.1). 기기 내·서버 Whisper는 같은 `SpeechEngine` 인터페이스로 붙습니다.
  - 서버 Whisper(`dialog/server-stt.ts`, `createDialogSpeechEngine`이 기본값): 브라우저 인식이 없고 아이 토큰(수업 학생 토큰 또는 기기 토큰)이 있으면 한 턴을 MediaRecorder Opus 16kbps로 녹음해 `POST /v1/converse/stt`(본문 = 오디오, `x-lcw-audio-ms`)에 한 번 보냅니다. 실시간 자막이 없으므로 마이크 음량(RMS 0.02 이상)이 "말하는 중" 신호이고(`interimIsText: false`, 점만 보임), 멈춘 뒤 9초까지 결과를 기다립니다. 소리가 없었으면 올리지 않습니다(한도도 안 씀).
  - 서버(`apps/edge/src/stt.ts`): 아이 토큰만, 좌석 멈춤이면 403, 15초·160KB 넘으면 413. 한도 계기(`canUseServerStt`: 강등 사다리 + 좌석 하루 40분)가 거절하면 429 → 클라이언트는 `unsupported`로 받아 단어 카드로. 길이(주장값과 16kbps 크기 추정 중 큰 값)로 뉴런을 먼저 차감한 뒤 Workers AI `@cf/openai/whisper-large-v3-turbo`(`language:'en'`)를 부릅니다. 모델에는 오디오와 언어만 가고 누가 말했는지는 가지 않으며, 오디오는 저장·기록하지 않습니다(AGENTS 4장 5·6·8). 채점은 그대로 `/v1/converse/score`(`stt_source:'workers_ai'`).
- NPC 맥락: 카페 주인 `cafe`, 물물교환 상점 주인 `trade_shop`(상점 거래 뱅크, 가격 0), 광장 안내인 `guide`(길 묻기 뱅크 — 카페·교환 상점, 가격 0).
- 기억 카드·복습(WP-310·406, `03` D8, `09` P4, 2026-11-16):
  - 혼자 경로에서 2성 이상으로 통과하고 무언가를 얻은 문장(산 아이템, 가격 0 문장이면 말한 대상)은 `memory_cards` 한 줄이 됩니다(`mc-<dialog_id>`, 한 창에 하나 — "별 하나 더"는 같은 카드를 더 좋은 문장으로 바꿈). 첫 복습은 20분 뒤이고 응답의 `memory_card.next_review_at`이 그 시각입니다. 코인이 모자라 아무것도 못 샀으면 카드도 없습니다. 산 아이템 행(`items.card_id`)에 카드가 붙습니다.
  - `GET /v1/review/due`(학생·기기 토큰): `{signs, next_due_at, cards_total, mastered}`. `signs`는 서버가 고른 최대 3건(`selectReviewSigns`: 장착 중이거나 7일 안에 쓴 장비 우선, `10 + 밀린 일수` 순, 창고 장비는 제외)이고 각 항목은 `card_id·item_key·item_name_ko·emoji·ctx·text·hint_tags·hint·listen·box·stars·label_ko`입니다. 힌트는 칸(box)이 정합니다: 20분·1일 전체 문장(1일부터 음성 없음 `listen=false`), 3일 키워드, 7일 첫 글자, 16일 그림, 35일 없음.
  - `POST /v1/review/attempt` `{card_id, transcript, stt_source, confidence, dur_ms, latency_ms}`: 서버가 그 카드 자기 문장과 그 칸의 통과선(`TUNING.memory.reviewPassThreshold` 0.70/0.70/0.70/0.65/0.60/0.60)으로 채점하고 칸을 옮깁니다(실패는 한 칸만 후퇴). 16일 칸은 같은 물건의 다른 뱅크 문장도 인정(`matched_text`). 아직 때가 안 된 카드·남의 카드·마스터한 카드는 409/404. 35일을 통과하면 마스터 도안이 되고 보너스 코인이 **장부**(`ledger`, reason `memory_master`)에 한 번만 들어갑니다. 복습 발화는 `utterances`에 남고(3일 칸부터 `recall`), 통과하면 그 장비의 사용 시각과 수업 유래 표현의 혼자 재사용(`expressions.reuse_solo`)이 갱신됩니다.
  - 화면: `apps/client/src/dialog/ReviewDock.tsx`의 `ReviewDock({world, player, hidden})` — 오른쪽 위(별·코인 칩 아래, top 112px) 번개 표시 카드 최대 3장, 새 징후가 뜨면 `mem.warn`, 누르면 그 카드 문장 한 개로 대화창(`mode` read/recall, 칸의 `hint`, `listen`)을 열고 통과하면 `mem.fix` + `celebrate`. 다음 복습 시각에 맞춰 다시 묻습니다(같은 세션의 20분 복습). 게스트는 카드가 없어 비어 있습니다.
  - 수업 발화로 생기는 카드는 같은 입구 `createMemoryCard(db, {origin: 'lesson', itemId: 'lesson-<utt>|<대상>'})`(`apps/edge/src/review.ts`)를 씁니다. 수업 리포트의 35일 유지율은 이 카드들로 계산합니다.

- 소리 내어 읽기 가구 할인(`03` D13, WP-405, 2026-11-16):
  - 월드의 건축 화면이 방 판정을 내면 `WorldHandle.onRoomCheck?(cb)`로 `{missing: ('light'|'rest'|'flat')[], sentence}`를 알립니다(문장은 `sim-core`의 `ROOM_MISSING_SENTENCES` 한 표). 앱은 그 아래(화면 아래 가운데, 단축 칸 위)에 `apps/client/src/dialog/ReadAloudPrompt.tsx`의 `ReadAloudPrompt({kind, sentence, player})`를 붙입니다 — 영어 문장(22px 이상) + [소리 내어 읽기].
  - `POST /v1/furniture/read-aloud` `{kind, transcript, stt_source, confidence, dur_ms}`(학생·기기 토큰): 서버가 그 종류의 문장과 맞춰 채점(목소리만 — 글자·카드 입력은 할인 없음)하고 `claimReadAloudDiscount`로 **가구 종류당 한국 시간 하루 1회, 플레이어마다** 10%를 줍니다. 같은 날 다시 읽으면 `already_claimed`. `GET /v1/furniture/discounts`는 오늘 받은 할인과 사용 여부.
  - 할인은 다음 그 종류 가구 구매에서 서버가 씁니다: 교환 상점(`trade_shop`, 토비)이 가구 9종(`FURNITURE_SHOP_GOODS`, 조명·쉴 곳·탁자, 코인 가격 = 별 가격)을 팔고, `/v1/converse/score`가 오늘 할인을 그 구매(`dialog_id`)에 묶어 가격을 깎습니다(`read_aloud_discount_pct`). 같은 창의 "별 하나 더"도 할인 유지, 같은 날 두 번째 구매는 정가. 교환 상점의 기본 제안은 그대로 물물교환 문장입니다(첫 수업 장면 그대로).
  - 혼자 놀이에서 방에 그 종류가 없다고 나왔거나(방 판정) 아이가 그 문장을 읽었으면, 앱이 토비 대화창에 그 종류 가구 문장(`furnitureOffersFor(kind, level)`, `ReadAloudPrompt.tsx`가 함께 내보냄)을 `cfg.offers`로 넘깁니다. 그 밖에는 물물교환 문장 그대로입니다.
- 월드 시세 지수(`09` P7, WP-405, 2026-11-16): 서버 가격 = 별 가격 × 그 월드 시세 지수(반올림, 최소 1) × 읽기 할인. 지수는 주간 크론(`0 6 * * 1`)이 `apps/edge/src/economy.ts`의 `runWeeklyPriceIndexes`로 **그 월드 원장의 지난 7일 수입·지출만** 보고 주당 ±5%, 0.8~1.25 안에서 움직입니다(시작 지갑·"별 하나 더" 차액 환불은 수입이 아님). 같은 주 재실행은 건너뛰고(`price_index_history` 주 키), 한계에 닿은 월드는 크론 기록(`ops_runs`)의 `price_index.at_limit`에 남습니다. 클라이언트는 가격을 계산하지 않고 `/v1/converse/score`의 `coins_delta`만 씁니다.

## 4. 수업 → 다른 도메인 (`apps/client/src/lesson/`)

- `/game/?code=123456` 또는 첫 화면의 코드 입력 → `POST /v1/join` → 학생 토큰은 `sessionStorage`. 응답의 `voice_store`(보호자의 음성 저장 동의)는 `lcw.studentVoice='1'`로 같이 두고, 대화창 `recordClip`이 이것을 봅니다(3장).
- `GET /v1/lesson/state`를 3초마다: `stage_id`가 바뀌면 아래 표대로 `goToScene`, `targets`는 대화창 `offers`, 빙의 대사(`npc_lines`)는 `npcSay`.

| stage_id | 장면 | NPC | 힌트 |
|---|---|---|---|
| warmup_anchor | plaza | 선생님 아바타(빙의 가능한 안내인) | full |
| cafe_order | honey_cafe | 카페 주인 | full |
| trade_roleplay | trade_shop | 상점 주인(교사 빙의) | keyword |
| open_question | open_hill | 안내인 | none(자유 발화) |
| recall_today | honey_cafe | 카페 주인 | initial |
| wrap_up | plaza | 안내인 | full |

저사양 기기(`classifyDeviceTier` = low)나 WebGL이 없으면 `/join` 단어 카드 화면으로 보냅니다.

## 5. 앱 껍데기 슬롯 (`apps/client/src/App.tsx`, 월드 소유)

`App.tsx`는 월드를 만들고 다른 도메인의 화면을 **있으면** 붙입니다(`import.meta.glob`이라 파일이 없어도 빌드가 깨지지 않음).

- 대화: `apps/client/src/dialog/DialogPanel.tsx`의 이름 있는 내보내기 `DialogPanel`(3장 props)과, 수업이 아닐 때 쓸 `createSoloSubmit(npc: NpcRef)`.
  - NPC에게 말을 걸면(`onNpcInteract`) 수업 중이 아닐 때 앱이 `DialogPanel`을 엽니다. 열리면 `setPaused(true)`, 닫히면 `setPaused(false)`.
  - `onResult(r)`(결과 화면이 뜨는 순간)와 `onDone(r)`(창을 끝낼 때 최고 결과): 앱(`createResultPlayer`)이 결과를 월드에 틉니다. 별 연출·별 칩·코인·아이템은 결과가 뜨는 순간 반영되고(외부인 캡처 2026-11-16: '좋아요'를 눌러야 올라가던 것), `onDone`으로 같은 결과가 다시 와도 두 번 반영하지 않습니다. `DialogPanel`은 `celebrate`·`giveItem`을 직접 부르지 않습니다.
    - 열려 있는 동안 앱이 대화창(`.lcw-dlg`) 높이를 재어 `setViewInset?(px)`로 넘기고 닫히면 0 — 폰에서 화면의 70%를 덮는 창 위 띠에 NPC 얼굴이 보이게 합니다.
    - 아이템은 `r.itemKey`가 **있을 때만** 손에 줍니다. 장면 기본값은 없습니다. 수업이든 혼자든 같고, `practice`(게스트 연습)면 주지 않습니다. 한 창에서 한 번만 줍니다.
    - 별은 그 창에서 보여 준 것보다 높을 때만 축하하고, 별 칩에는 늘어난 만큼만 더합니다(1★ 뒤 재도전 2★ → `celebrate(2, {add: 1})`). 실패의 '다시 해 봐요'(0)는 아직 통과 전일 때만 보여 줍니다. ✕·Esc 로 닫을 때 최고 결과로 `onDone`이 다시 와도 두 번 축하하지 않습니다.
    - `r.coinsTotal`(서버 장부 잔액)이 오면 `setCoins?(n)`으로 HUD 의 별 옆 코인 칩에 보여 줍니다. 장부는 서버 하나이고, 수업 도메인이 맞춘 잔액을 `world.setCoins?.(n)`으로 직접 넣어도 됩니다.
    - 혼자 대화: 안내인(`ctx:'guide'`)이 통과한 답의 `askedKey`가 장소(`'cafe'|'trade_shop'`, 장면 id 도 됨)면 창을 닫은 뒤 그 장면으로 걸어갑니다(`goToScene`). 수업 중에는 수업이 장면을 정하므로 걷지 않습니다.
- 복습: `apps/client/src/dialog/ReviewDock.tsx`의 `ReviewDock`(게스트가 아닐 때, 수업 중이거나 혼자 대화창이 열려 있으면 `hidden`). 자리는 오른쪽 위 별·코인 칩 아래: 터치(`pointer: coarse`)면 시점 버튼(약 60~116px) 아래 `top:128px`, 아니면 `top:60px`.
- 첫 방문 안내·1분 심부름(WP-111, docs/03 D1, docs/08 G15): `apps/client/src/dialog/FirstVisitGuide.tsx`의 `FirstVisitGuide`와 `errandDialogFor`. 연결된 아이(`kind:'child'`)일 때만 붙고, 수업 중이거나 혼자 대화창이 열려 있으면 `hidden`.
  - 처음 한 번(`localStorage['lcw.firstVisitSeen']`) 헤드폰·보호자와 볼륨 안내와 "Hello!" 마이크 점검 카드(건너뛰기 가능). 위쪽 목표 한 줄은 `setGoal`, 왼쪽 아래 "카페로 가기 / 루나에게 돌아가기" 버튼은 `goToScene`. 끝나면 +50 알림.
  - 앱은 혼자 대화창을 **열 때** `errandDialogFor(npc, errand, level)`로 창의 모양을 정하고 창이 닫힐 때까지 바꾸지 않습니다: 루나는 `offered`·`carrying`에서 `ctx:'errand'`(수락·건네기 문장), `accepted`에서 카페 길 묻기, 카페는 `accepted`에서 시원한 물 문장. 첫 줄은 `cfg.npcLine`.
  - 점수 응답의 `errand: {state, reward_coins?}`(`DialogResult.errand`)로 앱이 상태를 바꾸고, 안내가 `GET /v1/errand`로 다시 읽습니다. 상태·보상은 서버만 정합니다.
- 수업: `apps/client/src/lesson/LessonLayer.tsx`의 `LessonLayer`.
  - props: `{ world: WorldHandle; renderDialog: (cfg: DialogConfig) => ReactNode; onLessonActive?: (active: boolean) => void }`.
  - 수업이 시작되면 `onLessonActive(true)` → 앱이 `setLessonBadge(true)`, 혼자 대화 열기를 멈춥니다(대화는 수업이 `renderDialog`로 엶).
  - `canRender3d`: 기기가 3D 를 감당하지 못하면 false 입니다. 해상도가 이미 등급 하한(`tiers.ts` minScale)인데 15초 준비 뒤 10초 연속 12fps 미만이면(`FrameFloorWatch`) false 가 됩니다. 그러면 수업은 같은 세션 그대로 `/join` 단어 카드로 옮깁니다. 낮음 등급이라는 이유만으로는 3D 를 끄지 않습니다. 낮음 등급은 해상도·시야를 줄여 3D 를 유지합니다(swiftshader 휴대폰 크기 55~60fps 실측). WebGL 이 없거나 시작에 실패하면 앱이 처음부터 `/join` 안내 화면을 냅니다.
  - 장면 이동 중에 `setPaused(true)`가 와도(수업 단계 전환과 대화창 열림이 같은 틱) `goToScene`은 위치로 도착을 판정합니다. 도착하지 못했으면 페이드로 목표 장면에 옮기고 가장 가까운 NPC 로 대화 구도를 다시 잡습니다.
- 누가 하나(`world/identity.ts`): ① 주소에 `?code=123456`(6자리)이 있으면 **수업**(`{kind:'lesson', code}`, 기기 확인 요청도 안 함) ② 아니면 `localStorage['lcw.deviceToken']`(보호자 `/link`가 저장)을 `GET /v1/device/me`(Bearer)로 확인해 **연결된 아이**(`{kind:'child', token, nickname, level, voiceStore, offline}`) — 401이면 토큰을 지우고 게스트, 네트워크 오류면 저장된 `lcw.deviceNickname`으로 오프라인 아이 ③ 둘 다 아니면 **게스트**. 저장소 접근이 막혀도 게스트로 시작합니다.
  - 앱은 `LessonLayer`에 `identity`를 넘기고, 혼자 대화에는 `createSoloSubmit(npc, { deviceToken, nickname, level })`(게스트면 둘째 인자 없음)와 `cfg.level`을 넘깁니다. 월드는 `setPlayerName?(nickname)`으로 머리 위 이름표를 달고 안내인이 이름으로 한 번 인사합니다.
- 좌석(6장): `identity.ts`가 `play_allowed`·`seat`를 읽어 연결된 아이에 `playAllowed`·`seat`(`{state, endsAt}`|null)로 둡니다. `play_allowed`가 **명시적으로 false**일 때만 혼자 놀기를 멈춥니다(필드가 없는 옛 서버·`seat:null`은 그대로 놉니다). 마지막 온라인 답은 `lcw.devicePlayBlocked`('1')로 남겨 오프라인 시작에도 지킵니다. 멈추면 월드는 걸어 다니며 둘러보기만 되고, NPC 에게 말을 걸면 대화창 대신 안내 카드(`world/SeatNotice.tsx`: "지금은 혼자 놀기가 쉬는 중이에요 … 보호자에게 말해 주세요", 가격·결제 낱말 없음)가 뜹니다. 왼쪽 위 '둘러보기만' 칩으로 다시 열 수 있습니다. 수업(`?code=`)은 기기 확인 자체를 하지 않으므로 좌석과 상관없이 들어옵니다.
- 첫 화면(3초 예산): `index.html`의 스플래시(토큰 색 큐브)가 첫 페인트에 바로 뜨고 글꼴은 첫 페인트를 막지 않습니다. 월드는 시작 지점 둘레 `FIRST_RING`(2청크) 안만 메시한 뒤(최대 `FIRST_SCREEN_CAP_MS` 2초) 보여 주고, 나머지 시야는 첫 프레임 뒤에 이어서 메시합니다. 단계별 시간은 `getStats().startup`(`town`·`atlas`·`characters`·`mesh`·`firstFrame`, createWorld 기준 ms)입니다.
- 화면 주소: `/game/?scene=<SceneId>`(시작 장면), `?tier=low|mid|high`(사양 강제), `?fps=1`(fps 표시). 디버그·검증용으로 `window.__lcwWorld`에 핸들을 둡니다.
- 검증: `node tools/world-shots.mjs <url> <out> [desktop|tablet|phone|flow]` — 헤드리스 Chrome(swiftshader)으로 장면 5개 × 3 화면 크기 스크린샷, fps, 콘솔 오류, 흐름(목표·말풍선·걷기·멈춤·별·아이템·빙의·눈·키보드·E 키)을 `report.json`에.

## 6. 보호자 → 월드 (기기 토큰 발급 쪽 보장, WP-301)

- `/link`가 저장하는 `lcw.deviceToken`은 64자 소문자 16진수(서버에는 해시만, 365일), `lcw.deviceNickname`은 아이 별명입니다. 보호자가 우리 가족 화면에서 기기를 해제하거나 365일이 지나면 `GET /v1/device/me`가 401 `device_only`를 돌려줍니다(5장의 "401이면 지우고 게스트"). 200 응답은 `{nickname, level, voice_store, play_allowed, seat}`뿐이며 `player_id`는 없습니다. `voice_store`가 false면 음성은 서버가 저장하지 않고 기기도 녹음하지 않습니다(3장 음성 클립).
- 좌석(WP-704, `apps/edge/src/seats.ts`): `seat`는 `{state:'active'|'expiring'|'read_only'|'archived'|'refunded'}` 또는 좌석을 받은 적 없는 아이면 `null`입니다. 날짜(`ends_at`)는 아이 기기에 내려보내지 않습니다(AGENTS 4장 9: 아이 화면에 기한 금지). `play_allowed`가 false(좌석이 보기 전용·보관·환불)면 월드는 혼자 놀기를 멈추고 월드를 보기만 하게 하며, 아이 화면에는 가격·결제·기한을 보이지 않고 "보호자에게 말해 주세요" 정도만 띄웁니다. 서버도 같은 판단으로 막습니다: 기기 토큰으로 오는 혼자 놀기 쓰기(`POST /v1/converse/score`(구매 포함), `POST /v1/review/attempt`, `POST /v1/showroom`)는 403 `{error:'seat_inactive', seat:{state}}`를 돌려주고, 읽기(`GET /v1/review/due`)와 쇼룸 내리기(`DELETE /v1/showroom`)는 보기 전용 30일 동안에도 됩니다. `seat:null`(판매 전·좌석 없는 아이)은 지금처럼 놉니다. 수업(`?code=`, `/v1/join`, `/v1/lesson/*`, 수업 학생 토큰)은 좌석과 상관없이 들어옵니다.

- 수업 실시간 듣기(WP-307, `apps/edge/src/lesson-audio.ts`): 수업 쪽 화면(`/director`)에는 보호자 도메인의 상자 하나(`apps/web/src/LessonAudioBox.tsx`)만 붙습니다. 운영자 경로 `POST /v1/admin/lessons/:id/audio/ice|publish|beat|stop`, 보호자 경로 `POST /v1/family/children/:pid/lesson-window/audio`(201 `{listener_id, sdp, ice_servers, stream_id}`), `PUT …/audio/:listener {sdp}`(recvonly만), `DELETE …/audio/:listener`. 창문 응답 `audio`는 `{direction:'recvonly', available, reason, stream_id, listener}`이고 `GET …/lesson-window?listener=<id>`가 듣는 중 신호입니다. 수업이 끝나면(`lessons.ended_at`) 스트림은 바로 '없음'이 됩니다. 아이 기기(/game, /join)는 이 기능에서 아무것도 바뀌지 않습니다.

## 7. 다른 도메인 → 외부인(공개 사이트) 쓰임

- **`/try` 체험**(`apps/web/src/site/TryWorld.tsx`): 2장 `createWorld`만 씁니다(`startScene: 'plaza'`, `hudRoot`는 사이트 무대). 쓰는 멤버: `goToScene('honey_cafe')`(카페로 가기·인사 때), `onNpcInteract`(`cafe_owner`에게 E·탭이면 도착/인사 넘김), `npcSay('cafe_owner', …)`, `giveItem('honey_tea')`, `celebrate(1|2|3)`, `setGoal`, `setPaused`(걷기 단계만 false), `getScene?`, `getStats?().fps`(시작 화면에서 2.5초 재어 20 미만이면 2D 무대 유지), `dispose`. 이 이름·id 가 바뀌면 같은 PR 에서 `TryWorld.tsx`도 고칩니다. `?world=0|1`로 2D/3D 를 강제합니다.
- **쇼룸 게시**(`apps/edge/src/showroom.ts`, WP-703): 게임(월드 도메인)이 아이 기기 토큰(`/link`, `lcw.deviceToken`)으로 `POST /v1/showroom` `{ snapshot }`을 보냅니다. 운영자는 `{ snapshot, player_id }`로 대신 게시할 수 있습니다.
  - `snapshot = { v: 1, title: string(1–40), blocks: [x(-512..512), y(-512..512), z(-64..512), 색 토큰 이름][] (최대 20,000), avatar: { shirt, pants, hair } }`. 색은 `@lcw/ui` `COLOR_TOKENS` 이름만 받고, 다른 필드가 하나라도 있으면 400 입니다(위치·음성·실명 차단). 블록 종류 → 색 토큰 변환은 게시하는 쪽(월드)이 합니다.
  - 보호자의 `showroom_public` 동의가 있어야 합니다(없으면 403 `consent_required`). 아이마다 링크는 하나이고, 다시 게시하면 같은 링크의 내용만 바뀝니다. 응답은 `{ token, path: '/s/<token>' }`이고, 제목은 닉네임과 같은 개인정보·욕설 필터(422)를 거칩니다. 게시는 시간당 30회까지입니다.
  - 공개 읽기는 `GET /v1/showroom/<token>`(32자 hex, noindex)이고, 동의를 철회하면 바로 404 가 되며 저장본도 지웁니다. 아이 기기는 `DELETE /v1/showroom`으로 자기 링크를 지웁니다.
