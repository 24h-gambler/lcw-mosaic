# 22. 모험 — 말로 화해하는 탄막 이야기 (`/adventure/`)

- 기준일: 2026-11-22 · 소유: 대화(talk) 도메인의 모험 레인 · 원장 R2625 ⑧⑨ · R2734(오레오 실수업 뒤 개편, 6장)
- 운영자 말(2026-11-16): "undertale 을 좋아하는 학생이니까 언더테일 형태의 게임 플랫폼도 만들어서 넣어주세요. 별도 웹페이지로 가고 4단계로 만들어도 됩니다. 다 유기적으로 융합되게 한 하루씩 진행되어야 합니다."
- 화면에는 '게임' 대신 '모험'·'이야기'·'섬'을 씁니다(`21`). 아이 화면에 가격·결제·기한·시계를 띄우지 않습니다(AGENTS 4.9).

## 1. 무엇을 만드나

탑다운으로 섬을 걸어 다니다가 섬 주민을 만나면 턴제 만남 화면으로 바뀝니다. 아이는 작은 **말풍선 영혼**을 움직여 날아오는 글자·잉크·빵을 피하고, 자기 차례에는 **POKE · TALK · POUCH · FRIEND** 넷 중 하나를 고릅니다. 이기는 길은 말입니다: 그날 배운 영어 문장을 말하거나(마이크, 안 되면 타이핑) 고르거나 철자를 맞춰 상대의 마음(Calm)을 채우면 FRIEND 로 친구가 됩니다. POKE 로도 끝낼 수 있지만 별은 1개까지이고 상대는 시무룩하게 떠납니다.

장르의 형식(탑다운 탐험, 만남 → 턴제, 영혼 피하기, 네 가지 선택, 말로 화해)만 씁니다. 다른 작품의 이름·캐릭터·대사·그림·음악·지명은 쓰지 않고, 비슷하게 바꾼 이름도 쓰지 않습니다. 세계·인물·이야기·픽셀 그림·소리는 모두 이 저장소에서 새로 만들었습니다(그림 = `apps/adventure/src/art/sprites.ts` 문자 격자, 소리 = Web Audio 합성 `apps/adventure/src/audio/`, 외부 음원·이미지 파일 없음). 원작 낱말 목록은 `apps/adventure/src/__tests__/adventure-originality.test.ts` 가 소스 전체에서 막습니다.

### 1.1 세계 — 휘파람 바람 섬들(The Hushwind Isles)

잿빛 바람(the Hushwind)이 네 섬을 지나가며 모두의 입에서 낱말을 쓸어 갔습니다. 낱말을 잃은 섬 주민들은 마음이 엉켜 글자와 잉크를 던집니다. 아이는 종이 등불을 든 **등불지기(Keeper)** 입니다. 등불은 말을 담고, 아이의 영혼은 작은 말풍선입니다. 다정한 영어로 말을 걸면 주민이 진정하고, 친구가 되면 잃었던 그날의 낱말을 돌려줍니다.

| 장 | 섬 | 수호자(마지막 만남) | 길에서 만나는 주민 | LCW 문장 뱅크 상황 | 기본 낱말(문서 자료가 없을 때) |
|---|---|---|---|---|---|
| 1 | 이끼종 숲 Mossbell Woods | 브램블번 Bramblebun — 등에 방울 달린 이끼 고슴도치빵, 외로워서 숨음 | 루틀 Rootle(새싹 뿌리) · 콘킨 Conekin(솔방울) | `guide` 길 묻기 | animals: puppy, eagle, turtle |
| 2 | 소금유리 해변 Saltglass Shore | 클래터클로 선장 Captain Clatterclaw — 찻주전자 껍데기를 진 게, 아무것도 바꿔 주지 않음 | 버블릿(거품 해파리) · 셸밥(소라 굴러 다니기) | `trade_shop` 물물교환 | ocean: shell, island, boat |
| 3 | 부스러기 마을 Crumbtown | 오베나 Ovenna — 빵 모자를 쓴 걸어 다니는 화덕, 아무도 주문하지 않아 불이 식음 | 도우닷(반죽 방울) · 슈가플라이(설탕 나비) | `cafe` 주문 | food: sweet, snack, bake |
| 4 | 별다락 탑 Starloft Tower | 휘파람 바람 the Hushwind — 목도리를 두른 잿빛 구름, 아무도 말을 걸어 주지 않아 낱말을 모았음 | 블로틀링 Blotling(잉크 방울) · 페이퍼카이트(종이 연) | `errand` + 1~3장 복습 | 1~3장 낱말 복습 + space: star, moon, rocket |

### 1.2 하루에 한 장 (4장)

- 1장은 늘 열립니다. k장(k ≥ 2)은 k−1장을 끝내면 **바로(같은 날)** 열립니다(R2734: 이야기가 프롤로그→네 섬→마지막 보스→엔딩으로 한 번에 이어짐). 아래의 수업 날 규칙은 옛 기록입니다 — 옛 규칙: k−1장을 끝낸 **수업 날**보다 뒤의 수업 날에 열립니다. 수업 날은 학생 문서 링크로 열었을 때 그 링크의 날(`edd`, 없으면 문서 자료의 `date`)이고 — 문서에 새 수업 날이 생겨야 다음 섬이 열립니다 — 링크 없이 열면 한국 시간 달력 날입니다. 끝낸 장은 언제든 다시 할 수 있습니다. 잠긴 섬에는 링크로 열었으면 "Opens on your next lesson day"(다음 수업 날 열려요), 링크 없이 열었으면 "Opens tomorrow"(내일 열려요)만 보입니다 — 날짜·시계는 보이지 않습니다.
- 섬 고르기의 시작 단추는 문서 자료와 서버 진행을 다 읽을 때까지(최대 `bootWaitMs` 4초) "Getting your islands ready…" 로 잠겨 있습니다 — 단계와 열린 섬이 그 둘에 달려 있기 때문입니다. 단계는 장을 시작할 때 계획에 고정되고, 채점도 그 단계로 합니다.
- 문서 페이지가 여는 링크(3장)는 그날 문서 자료(`today.json`)의 낱말로 다음 장을 엽니다. 수업 시연·점검용 `?unlock=all` 은 네 장을 모두 엽니다.
- 진행은 기기의 `localStorage`(`lcw.adventure.v1`)에 두고, 연결된 아이 기기(`lcw.deviceToken`)면 `GET/PUT /v1/settings`(`19` 3장: 키 ≤ 40개·값 ≤ 32자이고 월드가 이미 대부분을 써서, 모험은 **키 하나** `adv` = "1" + 장마다 5글자[끝낸 수업 날(2024-01-01부터 날 수, 36진 3자리)·별(0~3)·결과(s 친구/f 찌르기/q 멈춤/- 없음)], 안 끝낸 장은 `-----`. 낱말은 기기에만 둡니다 — 새 기기에서는 섬 낱말로 다시 합니다)에도 둡니다. 다른 기기에서 열어도 같은 장부터 이어집니다. 설정은 읽어서 합친 뒤 씁니다(다른 설정을 지우지 않음). 읽기가 실패하면 쓰지 않고(PUT 은 행 전체를 바꾸므로), 키가 40개를 넘게 되면 쓰지 않으며, 응답이 OK 인지 확인합니다. 시작할 때 서버에 이 기기 진행이 없으면(다른 화면이 행을 다시 썼으면) 다시 써 넣습니다.

### 1.3 영어 학습 장치

| 장치 | 어디서 | 어떻게 |
|---|---|---|
| 말하기(TALK) | 만남의 내 차례 | 세 가지 말 걸기 중 하나를 고르면 그 방식으로 문장을 냅니다. 🗣 말하기(마이크 = LCW 대화와 같은 서버 Whisper 경로 `POST /v1/converse/stt`, 토큰이 없으면 그 자리에서 수업 코드 넣기, 못 알아들으면 "다시 말해 봐요", 마이크가 없거나 거절되면 타이핑) · 🧩 문장 조립(낱말 조각 순서대로) · ✅ 고르기(상대 말에 맞는 대답) · 🔤 철자(글자 조각, 또는 타이핑). 채점은 `@lcw/converse` `scoreUtterance`(레벨 통과선 `LEVEL_DEFINITIONS`) 그대로, 별 3 = 0.9 이상, 별 2 = 0.75 이상, 별 1 = 통과 |
| 모범 문장 듣기 | TALK 판의 🔊 | 신경망 목소리 `/v1/tts`(배역 팩 `modelVoice`), 꺼져 있거나 1.5초 안에 안 오면 기기 목소리 |
| 철자 조각 잡기 | 상대 차례(탄막) | 그날 낱말의 글자가 섞여 떨어집니다. 다음 글자만 잡으면 마음이 오르고, 다른 글자에 닿으면 조금 아픕니다. 낱말을 다 모으면 큰 마음 |
| 맞는 철자 거품 | 상대 차례 | 같은 낱말의 바른 철자 하나와 틀린 철자 둘이 떠다닙니다. 바른 것만 잡습니다 |
| 뜻 맞히기 쿠키 | 상대 차례 | 그림(이모지)·한국어 뜻(도움말 켬)에 맞는 낱말 쿠키만 잡습니다 |
| 낱말 돌 | 섬 길 | 그날 낱말 셋이 길가 돌에 새겨져 있습니다. 다가가면 읽어 주고 따라 말할 수 있습니다 |
| 4장 복습 | 별다락 탑 | 1~3장에 쓴 낱말·문장이 다시 나옵니다(문서 자료의 `review_words` 포함) |

문장은 학생 단계(L1~L3, L4 이상은 L3 문장)에 맞춥니다. 단계는 ① 문서 자료 `level` ② 주소 `?level=L2` ③ 연결된 기기 `GET /v1/device/me` 의 `level` ④ L1 순서로, 둘 다 읽은 뒤 한 번에 정합니다. 봉투의 `extra.level` 에는 아이의 원래 단계(L1~L6)를 그대로 적습니다. 한 장의 문장 묶음(`buildChapterPlan`, `apps/adventure/src/core/plan.ts`):

1. 그날 문장: 문서 자료의 `sentence`·`typing[]`(그날 단계 맞춤 문장). 없으면 낱말마다 품사 틀(`ADVENTURE_WORD_FRAMES`) — 명사 "I see a puppy." / 형용사 "It is so sweet!" / 동사 "Let's bake together!".
2. 기분 문장: 문서 오프너의 기분 틀과 같은 모양(L1 "I am happy." · L2 "I feel happy today because …" · L3 "Actually, I feel …").
3. LCW 문장: 그 섬 상황의 문장 뱅크(`PHRASE_BANK`, 레벨별) — 월드에서 말하는 문장과 같은 문장이라 3D 월드와 이어집니다.
4. 인사·친구 문장: 장마다 고정, 레벨별 3단.

학생 화면은 영어가 중심이고, 위쪽 `한국어 도움말` 스위치(기본 켬, 기기에 기억)를 켜면 문장·단추 밑에 한국어가 붙습니다.

## 2. 화면

| ID | 화면 | 대상 | 핵심 요소 | 빈 상태 / 오류 상태 |
|---|---|---|---|---|
| A01 | 섬 지도(모험 시작) | 플레이어 | 네 섬, 열린 섬·끝낸 섬(별)·잠긴 섬, 한국어 도움말 스위치, 소리 스위치 | 문서 자료를 못 읽으면 내장 낱말로 시작(안내 한 줄), 저장소가 막히면 이 탭 동안만 기억 |
| A02 | 섬 탐험 | 플레이어 | 탑다운 걷기(방향키·WASD·화면 방향판·탭 이동), 낱말 돌, 종 기둥(쉼·회복), 주민 말풍선 | 마이크 없이도 끝까지 갈 수 있음 |
| A03 | 만남 | 플레이어 | 상대 그림·대사, 공책 무대 안 말풍선 영혼, 탄막, 내 기운·상대 마음 막대, POKE·TALK·SKILL·POUCH·FRIEND, 수호자 단계 표시 | 기운이 다 떨어지면 "Out of voice…" 쓰러짐 화면 → 마지막 랜턴 기둥에서 기운 가득 깨어남(가진 것 그대로, 수호자 재도전은 탄막이 느려짐) |
| A04 | 말 걸기 판 | 플레이어 | 목표 문장(22px 이상), 🔊 모범 문장, 🎤 말하기·⌨ 타이핑·조각 고르기, 별 1~3 | 토큰이 없으면 수업 코드 칸(6자리, `/v1/join`), 조용하거나 못 알아들으면 다시 말하기 안내, 인식이 없거나 마이크가 거절되면 타이핑 칸과 조각으로 바로 바뀜 |
| A05 | 장 끝 | 플레이어 | 친구가 된 주민, 돌려받은 낱말, 별, 문서로 돌아가기(`edr`), 다음 섬 안내 | 결과를 못 보내도 화면은 같음(다음 장 끝이나 페이지를 떠날 때 다시 보냄) |
| A06 | 보호자 요약 | 학부모 | 한국어: 장별 결과·걸린 시간·말한 문장·잡은 낱말·별 | 아직 한 장도 안 했으면 "아직 모험 기록이 없어요" |

## 3. 다른 곳과의 연결

- **학생 문서(english-day)**: 계약은 자동화 저장소 `docs/handbook/06-pipelines/english-day-results.md`(결과 계약 v1)입니다.
  - 문서 페이지가 `/adventure/?ed=<학생키>&edd=<수업 날>&edk=<쓰기 키>&edr=<문서 주소>` 로 엽니다. 모험은 네 값을 `sessionStorage`(`lcw.adventure.ed`)에 두고 `https://english-day.pages.dev/<ed>/days/<edd>.json`(없으면 `today.json`)을 읽어 그날 낱말·문장·단계를 씁니다.
  - 장이 끝날 때마다 `POST https://english-day.pages.dev/api/result?k=<edk>`(text/plain, 봉투)를 보내고 응답을 기다립니다. 실패하면 1.5초·4초 뒤 두 번 더 보내고, 그래도 안 되면 화면은 그대로 두고 다음 장 끝이나 페이지를 떠날 때(`pagehide`·탭 숨김, `navigator.sendBeacon`) 같은 봉투를 다시 보냅니다(같은 장 id 는 덮어씀). 장 끝 화면의 '저장했어요 ✓' 는 응답 OK 를 받은 뒤에만 보입니다. `ed` 없이 열리면 보내지 않습니다.
  - 봉투: `{v:1, source:'lcw-adventure', student, date, activities:[{id:'ch<N>', kind:'chapter', label:'모험 N장', startedAt, endedAt, seconds, stars, starsMax:3, correct, total, words:[{w, ok, caught, missed}], lines:[{en, ko, mode:'voice'|'typed'|'pick'|'spell', ok, tries}], extra:{outcome:'spared'|'fought'|'quit', hp_lost, level, lessonDate?}}], summaryKo}` — `packages/schemas/src/adventure.ts` 가 모양과 한도(64KB, words·lines ≤ 60, 문자열 ≤ 300자)를 검사합니다.
  - `words[].caught` 는 철자 조각·거품·쿠키로 잡은 수에 더해, 아이가 말하거나 친 문장(TALK 말하기·친구 되기) 안에 그 낱말이 온전한 낱말로 들어 있으면 한 번씩 셉니다(`core/record.ts` `wordsSaid`, "good bye"·"thankyou" 처럼 띄어쓰기만 다른 것과 복수형 shells·puppies 도 같고, she'll·we're 같은 줄임말은 앞 낱말로만 봄). 말하기로 섬을 끝내도 보호자가 보는 그날 낱말 칸이 '안 함'으로 남지 않습니다.
  - 날짜: 문서는 학생 키로 KST 오늘 -10일~+2일의 `date` 만 받습니다. 수업 날이 그 밖이면(오래된 링크) `date` 는 오늘, 원래 수업 날은 활동의 `extra.lessonDate` 에 넣습니다 — 학부모·선생님 화면은 '지난 수업 복습'으로 따로 보입니다(문서 레인 합의 11-18).
  - 같은 장 id 가 다시 오면 문서가 장별 최고(결과 spared > fought > quit, 같으면 별, 그다음 correct)를 남깁니다. 모험도 같은 탭 안에서는 더 나쁜 다시 하기를 보내지 않고, 보호자 요약의 마지막 기록도 그 섬의 최고를 둡니다.
  - 문서로는 아이 별명·문장만 갑니다. 마이크 말하기는 LCW 대화와 같은 하나의 경로입니다(`apps/client/src/dialog/server-stt.ts` `createServerSpeechEngine` 를 그대로 씀): 한 차례를 Opus 16kbps 로 녹음해 아이 토큰과 함께 `POST /v1/converse/stt`(Workers AI Whisper, 한도 계기 통과)로 한 번 보내고, 서버도 이 페이지도 소리를 남기지 않습니다(edge `stt.ts`). 브라우저 자체 음성 인식(`SpeechRecognition`)은 쓰지 않습니다. 소리가 그친 뒤 2.5초(LCW 대화와 같은 `AUDIO_LIMITS.DIALOG_MIC_AUTO_STOP_SILENCE_MS`)면 차례가 끝나고, 7초 동안 아무 말이 없거나 20초가 넘으면 멈춥니다. 서버가 토큰을 거절하면(401·403, 지난 수업 탭) 수업 코드 칸이 다시 나오고, 한도가 쉬면(429) 그 페이지 동안 타이핑입니다(`ADV.listen`). 문서로는 인식된 글자만 갑니다. 마이크를 쓰고 싶지 않으면 늘 타이핑으로 답할 수 있습니다.
  - 토큰: 이 탭의 수업 토큰(`sessionStorage lcw.studentToken`) 또는 연결된 기기 토큰(`localStorage lcw.deviceToken`), LCW 와 같은 키와 순서입니다. 둘 다 없으면 말하기 자리에 **수업 코드 칸**이 나옵니다. 선생님 콘솔의 6자리 코드를 넣으면 LCW 와 같은 `POST /v1/join` 으로 학생 토큰을 받아 같은 키(`saveStudentSession`)에 둡니다. 코드는 남기지 않고, 토큰은 그 탭 밖으로 나가지 않습니다. 문서 링크에는 토큰을 싣지 않습니다(공개 링크).
  - 조용함 판정: 미터가 1초 넘게 돌면서 소리를 분명히 못 들었을 때만 올리지 않습니다(`vad_quiet`). 미터가 안 돌았거나 짧게 돌았거나, 가장 큰 소리가 경계(`VOICE_RMS_BORDER` 0.005, 말소리 기준 `VOICE_RMS` 0.02 아래)를 넘었으면 서버 Whisper 로 보냅니다. Whisper 가 빈 글자를 돌려주면 조용함(`stt_empty`)입니다. 예외: Whisper 가 무음·잡음에서 지어내는 문구(`WHISPER_HALLUCINATIONS`: Thank you. · Thanks for watching. · you · Bye. 등)는, 그 턴에 말소리 증거가 없으면 `stt_hallucination`(조용함)입니다. 말소리 증거는 미터가 돌았고, 말소리 수준(`VOICE_RMS`) 프레임이 3개 이상이고, 가장 큰 소리가 `HALLUCINATION_PEAK_RMS`(0.02) 이상이며, 서버의 Whisper no-speech 확률이 0.6 미만인 것입니다. 미터가 돌지 않은 기기(R2627)에서는 Whisper no-speech 확률이 있고 0.6 미만일 때만 받습니다. "Thank you. Thank you." 처럼 문장마다 무음 문구인 것도 같습니다. 그래서 아이가 말하지 않은 "thank you" 는 낱말 caught·통과·별이 되지 않고, 실제로 말한 "thank you" 는 받습니다(apps/client `dialog/server-stt.ts`, LCW 대화와 같은 코드).
  - Workers AI 가 실패하면(502) 서버가 한 번 더 부릅니다(`apps/edge/src/stt.ts` `STT_RETRIES`, 두 번째 호출도 할당량 미터를 거침, 응답 `retried: true`). 두 번 다 실패하면 전처럼 "다시 말해 봐요"입니다.
  - 마이크 장부: 모험의 턴도 LCW 대화와 같은 `lcw.micStatus`·`lcw.micIssue`·`lcw.micTurns`(R2627)에 남습니다. 수업 중이면 1분 조회(`away=adventure`)에 실어 보내, 콘솔의 마이크 줄과 턴 장부(시작·보냄·잃음·원인)가 모험에서도 이어집니다. 모험의 '보냄'은 서버 Whisper 가 그 턴의 말을 알아들은 것입니다(모험은 수업 발화를 보내지 않음). 그래서 콘솔의 보냄 수가 수업 발화 수보다 클 수 있습니다. 토큰 거절(401·403)은 `token_refused`, 턴 도중 창을 닫으면 `closed` 로 잃음입니다. 토큰 거절은 마이크 줄을 '마이크 없음'으로 바꾸지 않습니다.
  - 수업 유지: 이 탭에 학생 토큰이 있으면 모험이 1분마다 `GET /v1/lesson/state?away=adventure` 를 보냅니다(`audio/presence.ts`). 1PC 수업에서 월드와 선생님 패널이 화면에 없어도 수업이 15분 무활동 자동 종료(edge `LESSON_IDLE_CLOSE_MS`)로 닫히지 않고, 콘솔에는 아이가 모험에 있다고 보입니다(scene `adventure`). 그동안 월드 단계의 아이 시간은 흐르지 않고 단계도 저절로 넘어가지 않습니다. 토큰이 거절되면(수업이 끝남) 다음 🎤 에서 수업 코드 칸이 나옵니다.
  - 실패: 아무 소리가 없으면 "I did not hear anything", 업로드·모델 실패면 "I could not catch that. Tap 🎤 and say it again!", 한도가 쉬면 타이핑으로 넘어갑니다.
- **신경망 목소리**: 섬 주민은 인물마다 자기 Kokoro 목소리가 있습니다(`npc-cast.ts` 배역 팩의 `islanders` 표 하나, 인물 id 또는 마을 사람 영어 이름 → 목소리, `islanderVoice`). 16명 모두 서로 다르고 모범 문장 목소리(af_sarah)와도 다릅니다. 모범 문장처럼 집 PC GPU 가 만들어 올리고(0 뉴런, 매일 밤 Dan-LCW-TTS-Local), Workers AI 사전 생성·크론은 건너뜁니다(R2625, 11-19: 섬 3·4 대사 55줄이 밤 크론을 기다리며 기계음이던 것). 아이 문장은 `modelVoice`. 고정 대사와 내장 낱말 문장은 `fixedTtsLines()` 에 들어 있어 손님도 신경망 목소리를 듣고, 문서 자료에서 온 새 문장은 아이 토큰이 있을 때만 서버가 만듭니다(없으면 기기 목소리).
- **LCW 월드**: 장마다 같은 상황의 문장 뱅크 문장을 써서, 모험에서 연습한 문장을 `/world/` 카페·상점·안내인에게 그대로 씁니다. 장 끝 화면에 `/world/` 로 가는 단추가 있습니다.

## 4. 숫자 (`apps/adventure/src/core/tuning.ts` 한 곳)

| 항목 | 값 | 이유 |
|---|---|---|
| 내 기운(HP) | 20, 맞으면 2~4, 맞은 뒤 1초 무적 | 아이가 서너 번 실수해도 끝까지 |
| 마음(Calm) 최대 | 길 주민 50 · 수호자 240 · 휘파람 바람 320 | 길 주민은 말 한 번, 수호자는 완벽한 말 네 번(그 사이 단계마다 세지는 탄막 세 차례), 휘파람 바람은 여섯 번 — R2734 "보스가 너무 쉬움" |
| 말 한 번의 마음 | 별 3 = 60 · 별 2 = 45 · 별 1 = 35 · 다시 = 5 | 길게·정확히 말할수록 빨리 친구 |
| 탄막 한 차례 | 길 주민 5~6초 · 수호자 7~9초 | 집중이 끊기지 않는 길이 |
| 장 별 | 수호자와 친구 + 모든 만남 친구 + 말한 문장 3개 이상(별 2 이상) = 별 3 · 수호자와 친구 = 별 2 · 끝냄 = 별 1 | 말로 화해를 가장 높게 |
| 기운이 바닥나면 | 쓰러짐 → 마지막 랜턴 기둥에서 기운 가득, 동전·주머니·장비·스킬 그대로, 수호자 재도전마다 탄막 10% 느리게(최저 70%) | 진짜 죽음과 부활, 벌 대신 쉬운 길 |
| 깜빡임 | 초당 3번 이하, 화면 흔들림 0.3도·300ms 이하 | `MOTION_TOKENS` |
| 결과 다시 보내기 | 처음 + 1.5초 뒤 + 4초 뒤 | 문서 쪽이 잠깐 없거나 바빠도 결과를 잃지 않게 |
| 프레임 | 논리 화면 320×240, 고정 60Hz 갱신, 그리기는 rAF | 1440·390·844 폭 모두 30fps 이상 |

## 5. 확인하는 법

- 자동 시험: `pnpm test` 의 `apps/adventure/src/__tests__/` — 핵심 규칙(`adventure-core.test.ts`: 계획·채점·섬 열림·봉투·탄막·만남·수호자 단계·SKILL·상자·수레·쓰러짐과 랜턴 기둥·섬·길찾기), 화면(`adventure-screens.test.tsx`: A01~A06 과 빈·오류 상태, 대화 선택지·수레·쓰러짐·이야기 화면), 독창성(`adventure-originality.test.ts`: 빌려 온 이름·장소·용어, 유명한 네 명령어, 하트 표지가 없음), 키로만 끝까지(`adventure-playthrough.test.ts`, 6장), 12살 영어(`adventure-english.test.ts`), 수호자 난이도(`adventure-difficulty.test.ts`).
- 실화면: `pnpm --filter @lcw/adventure build` 뒤 `npx vite preview --port 8994`(apps/adventure) 를 띄우고 `PLAYWRIGHT_CORE=<playwright-core/index.mjs> node tools/adventure-play.mjs http://127.0.0.1:8994/adventure/ shots/adventure` 를 돌립니다. 헤드리스·소리 끔으로 1440(키보드)·390(터치)·844×390(터치·키보드)에서 네 장을 끝까지 하고, 말하기 네 방식(say·build·spell·pick)을 모두 쓰며, 페이지가 스스로 센 프레임으로 30fps 이상, 페이지 오류 0, 보호자 요약, 그리고 문서 링크를 붙인 1440 실행에서 그날 파일 읽기와 계약 v1 봉투(활동 4개)를 확인합니다. english-day 와 `/v1/*` 는 브라우저 안에서 대신 답하므로 실제 학생·문서에는 아무것도 가지 않습니다. 하나라도 어긋나면 종료 코드 1.
- 말로만 실측: `ADV_VOICE_DIR=<폴더>` 를 주면 크롬의 가짜 마이크(`--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<폴더>/turn.wav`)로 답마다 Windows 음성으로 만든 WAV(`tools/say-wav.ps1`, 앞 0.7초·뒤 3.5초 조용함)를 넣고 모든 답을 말로만 합니다(🗣 말하기만 고름). 크롬은 마이크를 열 때마다 파일을 다시 읽으므로 차례마다 다른 문장이 들어갑니다. 첫 차례는 조용한 파일로 "다시 말해 봐요" 안내를 확인합니다. 토큰이 없으면 `ADV_JOIN_CODE`(smoke 학생 수업의 코드)를 코드 칸에 넣습니다. 로컬 빌드는 `ADV_API_BASE=https://lcw.worldwidesomething.com` 으로 `/v1/join`·`/v1/converse/stt` 두 호출만 운영 서버로 넘깁니다. 보고의 `voice` 에 차례 수, STT 응답(상태·인식 글자), 참여 응답 상태(토큰은 남기지 않음)가 남습니다.
- 운영 학생 문서 실측(문서 사이트 배포 뒤): `ADV_LIVE_SECRET=<english-day.secret 경로> MAXCH=1 … adventure-play.mjs <주소> <출력> d1440-keys` 는 진짜 `https://engday.pages.dev` 에 smoke 학생 `smoke-adv` 로만 결과를 보냅니다. 쓰기 키는 도구 안에서 HMAC 으로 만들고 출력하지 않습니다. 그날 파일은 `ADV_LIVE_DAY_FROM`(꼭 적어야 함) 학생 페이지의 것을 읽기만 합니다. smoke- 학생은 보고와 교사 화면에서 빠집니다. 이 방식에서는 화면마다(390 터치 포함) 문서 링크를 답니다. 2026-11-18 실측: POST 200, ACAO `*`, 활동 1개.
- 운영 확인은 `smoke-` 로 시작하는 학생 키로만 합니다(학생 문서 쪽이 보고서·누적·선생님 화면에서 뺍니다).

## 6. R2734 개편 — 진짜 모험으로 (2026-11-21)

- 운영자 말(2026-11-19, 오레오 실수업 뒤): 언더테일 느낌이 부족하고 재미가 없음 · Z 로 진행이 안 됨 · 체력이 제대로 안 됨 · 엔딩·죽음·부활이 있어야 함 · 대화·상자가 없음 · 보스가 너무 쉬움 · 음악도 · 상점·스킬·스토리가 없음 · 영어가 다 12살 수준이 아님.

| 요구 | 만든 것 | 코드 | 확인 |
|---|---|---|---|
| Z/Enter 가 멈추지 않음 | 모든 장면이 `engine.confirm()` 으로 다음으로 가고, 엔진이 할 일이 없으면 그 단계의 패널 단추(포커스 또는 `data-primary`)를 누름. 목록(지도·전투 메뉴·대답·수레·말 걸기·스킬·주머니)은 방향키 커서 | `engine.ts confirm/menuMove/wantsArrows`, `ui/App.tsx` | 키 전용 진행에서 Z 를 누를 때마다 화면 서명(`zSignature`)이 바뀜 = 정지 0 |
| 진짜 체력 | 여행 기운(`run.hp`, 최대 20 + 목도리 6)이 만남 사이에 이어짐. 맞으면 줄고, 간식·따뜻한 빛 스킬·랜턴 기둥으로 회복 | `core/run.ts`, `core/battle.ts` | `adventure-core` trip 시험 |
| 죽음과 부활 | 기운 0 → 쓰러짐 화면 → 마지막으로 들른 랜턴 기둥에서 깨어남, 수호자 재도전은 느려짐 | `engine.ts down`, `run.ts revive/retrySpeed` | 키 전용 진행이 섬1 수호자에게 일부러 지고(최저 기운 0) 기둥에서 깨어나 다시 이김 |
| 이야기 전체 | 프롤로그 → 섬 넷(도착·수호자 등장·수호자 뒤) → 배 → 마지막 보스(휘파람 바람) → 엔딩 → 크레딧 "The End" → 지도 | `packages/content/src/adventure-story.ts` | 진행 끝에 `ending` 표지 |
| 대화와 갈래 | 섬마다 주민(대화 나무, 선택지 2~3, 퀴즈 → 동전) · 상인 텀블 | 같은 파일 `tree` | 섬마다 대답 1개 이상 |
| 상자 | 섬마다 상자 둘(동전·간식) | `chests`, `run.openChest` | 섬마다 상자 표지 |
| 상점 | 텀블의 수레: 간식·장비(외투 −1 피해, 목도리 +6 기운, 등불 마음 ×1.25)·스킬(마법의 말) | `shopRows`, `run.buy` | 섬마다 구매 |
| 스킬 | SKILL: 마법의 말을 고르거나 말하면 만남마다 한 번 — 따뜻한 빛(회복)·방패 노래·느린 바람·밝은 불꽃(마음) | `battle.cast` | 진행에서 네 가지 모두 사용 |
| 어려운 보스 | 수호자마다 단계 3~4(마음이 찰수록 새 패턴·빨라짐·피해 증가, 단계 대사), 빵·설탕 패턴은 말풍선을 노림, 마음 240/320 | `adventure-story.ts stages`, `core/bullets.ts`, `tuning.ts` | `adventure-difficulty.test.ts`: 피하지 않고 완벽히 말하면 섬마다 세 번 중 2번 이상 쓰러짐, 피하면 이김(휘파람 바람은 3번 중 2번) |
| 음악 | 섬 넷·수호자 넷·마지막 폭풍·수레·기둥·쓰러짐·배·이야기·엔딩·친구·전투·제목 곡(모두 Web Audio 합성 새 곡) | `audio/tracks.ts` | 브라우저에서 AudioContext `running`, 곡마다 실제로 낸 음 수 > 0 |
| 12살 영어 | 모든 문장 14낱말 이하, 낱말은 일상어·이야기 낱말·이름·수업 낱말만. 은행 문장은 그 단계에서 14낱말 이하인 가장 높은 문장 | `packages/content/src/kid-english.ts`, `adventureBankSentences` | `adventure-english.test.ts` |
| 막대가 화면 안 | 공책(회피 칸) 위쪽 112 — 가장 높은 칸(112) 아래에도 기운·마음 막대가 240 화면 안(390 화면 실측에서 잘렸던 것) | `core/bullets.ts ARENA_TOP`, `render.ts` | `adventure-difficulty.test.ts` 'the voice and calm bars stay on screen' |

키 전용 진행: `tools/adventure-autoplay.mjs` 한 두뇌가 엔진 시험(`adventure-playthrough.test.ts`)과 실제 브라우저(`tools/adventure-keys.mjs`)를 같이 움직입니다. 브라우저는 `pnpm --filter @lcw/adventure build` → `npx vite preview --port 8994`(apps/adventure) → `PLAYWRIGHT_CORE=<playwright-core/index.mjs> node tools/adventure-keys.mjs http://localhost:8994/adventure/ <출력> p390 d1440`. 학생 id·수업 코드 없이 열고(`?autopilot=1` 은 피하기만 대신, 키를 누르는 동안은 꺼짐), 화면마다 스크린샷과 `keys-<화면>.json`(정지·쓰러짐·상자·구매·스킬·대답·단계·곡과 음 수·AudioContext 상태)을 남깁니다.
