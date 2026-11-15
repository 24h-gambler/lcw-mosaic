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
export interface WorldHandle {
  goToScene(id: SceneId): Promise<void>;            // 걸어가거나 문을 지나는 연출 포함
  onNpcInteract(cb: (npc: NpcRef) => void): () => void; // E 키·탭으로 NPC에게 말 걸기
  npcSay(npcId: string, text: string): void;        // 말풍선(빙의 대사 포함, 빙의 중엔 반짝임)
  playerSay(text: string): void;
  giveItem(itemKey: string): void;                  // 주문한 음료·교환한 물건이 손/슬롯에
  celebrate(stars: 0 | 1 | 2 | 3): void;            // 별 연출·효과음
  setGoal(goalKo: string, targetEn?: string): void; // 화면 맨 위 목표 한 줄
  setPaused(paused: boolean): void;                 // 대화창이 열리면 이동 멈춤
  dispose(): void;
}
export function createWorld(opts: { canvas: HTMLCanvasElement; tier: 'low' | 'mid' | 'high' }): Promise<WorldHandle>;
```

월드 도메인은 첫 PR에서 이 인터페이스를 (내용이 단순하더라도) 먼저 머지해 다른 도메인이 붙을 수 있게 합니다.

## 3. 대화 → 다른 도메인 (`apps/client/src/dialog/DialogPanel.tsx`)

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
}
```

`UtteranceSubmit`은 `/v1/lesson/utterance` 본문(`18` 2장)과 같은 모양입니다. 채점·코인은 언제나 서버 값입니다.

## 4. 수업 → 다른 도메인 (`apps/client/src/lesson/`)

- `/game/?code=123456` 또는 첫 화면의 코드 입력 → `POST /v1/join` → 학생 토큰은 `sessionStorage`.
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
