import { ECHO_TRANSITION_LINE, type LangLevel } from '@lcw/content';
import type { HintLevel, NpcContext, UnderstandResponse } from '@lcw/schemas';
import { QuotaMeter } from '@lcw/quota';
import { parseIntentAndSlots, understandFromBoard, understandUtterance, type BoardSelection } from './parser.js';
import { scoreUtterance, type ScoringResult } from './scoring.js';

export type DialogState =
  | 'IDLE'
  | 'PROMPT'
  | 'CAPTURE'
  | 'UNDERSTAND'
  | 'BOARD'
  | 'OFFER'
  | 'REPEAT'
  | 'SCORE'
  | 'ECHO'
  | 'REWARD'
  | 'LOG';

export type SttChannel = 'device' | 'workers_ai' | 'board';

export function selectSttChannel(params: {
  micAvailable: boolean;
  deviceSttSupported: boolean;
  deviceConfidence?: number;
  seatId: string;
  isLesson: boolean;
  quotaMeter?: QuotaMeter;
  nowMs: number;
}): SttChannel {
  if (!params.micAvailable) return 'board';
  if (params.deviceSttSupported && (params.deviceConfidence ?? 1) >= 0.55) {
    return 'device';
  }
  const canServer = params.quotaMeter
    ? params.quotaMeter.canUseServerStt({
        seatId: params.seatId,
        isLesson: params.isLesson,
        hasDeviceStt: params.deviceSttSupported,
        nowMs: params.nowMs
      })
    : true;
  if (canServer) return 'workers_ai';
  return 'board';
}

export class ConversationMachine {
  state: DialogState = 'IDLE';
  ctx: NpcContext;
  level: LangLevel;
  understandFailures = 0;
  repeatAttempts = 0;
  chosenStars: 1 | 2 | 3 = 1;
  inputMode: 'voice' | 'keyboard' | 'board' = 'voice';
  currentUnderstand: UnderstandResponse | null = null;
  lastScore: ScoringResult | null = null;
  highlightMissedWords: string[] = [];
  grantedStars: 1 | 2 | 3 = 1;
  hintTagsVisible = false;
  /** NPC line to play on entering ECHO (docs/04 4.1); null outside ECHO. */
  echoLine: typeof ECHO_TRANSITION_LINE | null = null;

  constructor(ctx: NpcContext, level: LangLevel) {
    this.ctx = ctx;
    this.level = level;
  }

  start(): DialogState {
    if (this.state !== 'IDLE') throw new Error(`Cannot start from ${this.state}`);
    this.state = 'PROMPT';
    this.understandFailures = 0;
    this.repeatAttempts = 0;
    this.highlightMissedWords = [];
    this.hintTagsVisible = false;
    this.echoLine = null;
    return this.state;
  }

  onPromptAudioComplete(): DialogState {
    if (this.state !== 'PROMPT') throw new Error(`Expected PROMPT, got ${this.state}`);
    this.state = 'CAPTURE';
    return this.state;
  }

  onCaptureSilenceTimeout6s(): DialogState {
    if (this.state !== 'CAPTURE') throw new Error(`Expected CAPTURE, got ${this.state}`);
    this.hintTagsVisible = true;
    this.state = 'PROMPT';
    return this.state;
  }

  openBoardDirectly(): DialogState {
    if (this.state !== 'CAPTURE' && this.state !== 'UNDERSTAND') {
      throw new Error(`Cannot open BOARD from ${this.state}`);
    }
    this.inputMode = 'board';
    this.state = 'BOARD';
    return this.state;
  }

  submitCapture(
    transcript: string,
    opts?: { quotaMeter?: QuotaMeter; seatId?: string; isLesson?: boolean; nowMs?: number }
  ): { state: DialogState; understand: UnderstandResponse | null } {
    if (this.state !== 'CAPTURE') throw new Error(`Expected CAPTURE, got ${this.state}`);
    this.state = 'UNDERSTAND';
    const parsed = parseIntentAndSlots(this.ctx, transcript);
    if (!transcript.trim() || !parsed.matchedAnySlot) {
      this.understandFailures++;
      if (this.understandFailures >= 2) {
        this.state = 'BOARD';
        return { state: this.state, understand: null };
      }
      this.state = 'CAPTURE';
      return { state: this.state, understand: null };
    }

    this.currentUnderstand = understandUtterance({
      ctx: this.ctx,
      level: this.level,
      transcript,
      quotaMeter: opts?.quotaMeter,
      seatId: opts?.seatId,
      isLesson: opts?.isLesson,
      nowMs: opts?.nowMs
    });
    this.state = 'OFFER';
    return { state: this.state, understand: this.currentUnderstand };
  }

  submitBoardSelection(selection: BoardSelection): {
    state: DialogState;
    understand: UnderstandResponse;
  } {
    if (this.state !== 'BOARD' && this.state !== 'CAPTURE') {
      throw new Error(`Cannot submit board from ${this.state}`);
    }
    this.inputMode = 'board';
    this.currentUnderstand = understandFromBoard({
      ctx: this.ctx,
      level: this.level,
      selection
    });
    this.state = 'OFFER';
    return { state: this.state, understand: this.currentUnderstand };
  }

  chooseOffer(stars: 1 | 2 | 3, inputMode: 'voice' | 'keyboard' | 'board' = 'voice'): DialogState {
    if (this.state !== 'OFFER') throw new Error(`Expected OFFER, got ${this.state}`);
    this.inputMode = inputMode;
    // Keyboard fallback caps at 2 stars (docs/04 4.1)
    this.chosenStars = inputMode === 'keyboard' && stars === 3 ? 2 : stars;
    this.repeatAttempts = 0;
    this.state = 'REPEAT';
    return this.state;
  }

  submitRepeat(
    transcript: string,
    hintLevel: HintLevel = 'full'
  ): { state: DialogState; result: ScoringResult; echoLine?: typeof ECHO_TRANSITION_LINE } {
    if (this.state !== 'REPEAT') throw new Error(`Expected REPEAT, got ${this.state}`);
    if (!this.currentUnderstand) throw new Error('Missing offers in REPEAT');
    this.state = 'SCORE';
    const offer = this.currentUnderstand.offers.find((o) => o.stars === this.chosenStars)!;
    this.repeatAttempts++;
    const result = scoreUtterance({
      targetText: offer.text,
      spokenTranscript: transcript,
      level: this.level,
      hintLevel,
      stars: this.chosenStars,
      hintTags: this.currentUnderstand.hint_tags
    });
    this.lastScore = result;

    if (result.pass) {
      // docs/04 4.6: 3-star without any core-pattern token is capped at 2 stars
      this.grantedStars = Math.min(this.chosenStars, result.starCap) as 1 | 2 | 3;
      this.state = 'REWARD';
      return { state: this.state, result };
    }

    if (this.repeatAttempts >= 3) {
      this.state = 'ECHO';
      this.echoLine = ECHO_TRANSITION_LINE;
      return { state: this.state, result, echoLine: ECHO_TRANSITION_LINE };
    }

    if (this.repeatAttempts === 2) {
      this.highlightMissedWords = result.missed;
    }
    this.state = 'REPEAT';
    return { state: this.state, result };
  }

  completeEcho(): DialogState {
    if (this.state !== 'ECHO') throw new Error(`Expected ECHO, got ${this.state}`);
    // Downgrade by 1 star, minimum 1 star so player never leaves empty-handed (docs/04 4.1)
    this.grantedStars = (this.chosenStars > 1 ? this.chosenStars - 1 : 1) as 1 | 2 | 3;
    this.state = 'REWARD';
    return this.state;
  }

  commitRewardAndLog(): { state: DialogState; grantedStars: 1 | 2 | 3 } {
    if (this.state !== 'REWARD') throw new Error(`Expected REWARD, got ${this.state}`);
    this.state = 'LOG';
    const grantedStars = this.grantedStars;
    this.state = 'IDLE';
    return { state: this.state, grantedStars };
  }
}
