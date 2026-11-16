/**
 * World HUD in plain DOM over the canvas (docs/08 8.1, 7.2): goal line, scene chip, star counter, speech
 * bubbles, talk prompt, 5-slot hotbar, item toast, star celebration, scene title card, touch controls.
 * Colors, type and motion come from @lcw/ui tokens only (AGENTS 6). No prices or payment on this screen (AGENTS 4.9).
 */
import { COLOR_TOKENS as C, MOTION_TOKENS as M, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import { WORLD_STRINGS as W, itemNameKo } from './strings.js';
import { bandOf, clockLabel, hotbarCaption, isNight, placeLabel, type BandId } from '../frame/status.js';

const STYLE_ID = 'lcw-world-hud-style';

function css(): string {
  const night = `${C['night-900']}D9`; // 85% (docs/08 2.1)
  return `
.lw-hud{position:absolute;inset:0;pointer-events:none;font-family:${T.fonts.ui};color:${C['ink-900']};user-select:none;-webkit-user-select:none;overflow:hidden;touch-action:none}
.lw-hud *{box-sizing:border-box}
.lw-card{background:${C['paper-50']};border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;box-shadow:${S.shadowDefault}}
.lw-goal{position:absolute;top:12px;left:50%;transform:translate(-50%,-140%);max-width:min(720px,calc(100% - 32px));padding:8px 16px;display:flex;flex-direction:column;align-items:center;gap:2px;transition:transform ${M.slowMs}ms ease-out;text-align:center}
.lw-goal.on{transform:translate(-50%,0)}
.lw-hud.dlg .lw-goal{opacity:0;transition:opacity ${M.slowMs}ms ease-out}
/* a dialog window covers the bottom (or the right on a landscape phone): the hotbar and help hide under it */
.lw-hud.dlg .lw-hotbar,.lw-hud.dlg .lw-help{opacity:0;visibility:hidden;transition:opacity ${M.slowMs}ms ease-out,visibility 0s linear ${M.slowMs}ms}
.lw-goal .k{font-size:${T.scale.small.sizePx}px;line-height:${T.scale.small.lineHeightPx}px;font-weight:700;color:${C['brand-d']}}
.lw-goal .g{font-size:${T.scale['body-l'].sizePx}px;line-height:${T.scale['body-l'].lineHeightPx}px;font-weight:700}
.lw-goal .t{font-family:${T.fonts.target};font-size:${T.scale.h3.sizePx}px;line-height:${T.scale.h3.lineHeightPx}px;font-weight:700;color:${C['sky-d']}}
.lw-chip{position:absolute;top:12px;left:12px;display:flex;gap:8px;align-items:center}
.lw-chip .s{background:${night};color:${C['paper-0']};padding:6px 12px;border-radius:${S.radiusButtonPx}px;font-weight:700;font-size:${T.scale.small.sizePx}px}
.lw-chip .l{background:${C.sky};color:${C['ink-900']};padding:4px 8px;border-radius:${S.radiusButtonPx}px;font-weight:700;font-size:${T.scale.micro.sizePx}px;border:2px solid ${C['ink-900']};display:none}
.lw-chip .l.on{display:inline-block}
.lw-chip .s{display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px}
.lw-chip .w{display:inline-flex;align-items:center;gap:6px;font-size:${T.scale.micro.sizePx}px;line-height:${T.scale.micro.lineHeightPx}px;font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.9}
.lw-chip .w:empty,.lw-chip .w.none{display:none}
.lw-chip .w i{width:10px;height:10px;border-radius:50%;background:${C.sun};box-shadow:0 0 0 2px ${C['sun-d']};flex:none}
.lw-chip .w.night i{background:transparent;box-shadow:inset -4px -2px 0 0 ${C.silver}}
.lw-chip .w.snow i{background:${C['paper-0']};box-shadow:0 0 0 2px ${C.silver}}
.lw-chip .s{white-space:nowrap}
.lw-net{position:absolute;top:0;left:0;right:0;display:none;align-items:center;justify-content:center;gap:8px;padding:4px 12px;background:${C.sun};color:${C['ink-900']};border-bottom:${S.borderWidthPx}px solid ${C['ink-900']};font-weight:700;font-size:${T.scale.small.sizePx}px;line-height:${T.scale.small.lineHeightPx}px}
.lw-net i{width:10px;height:10px;border-radius:50%;background:${C['ink-900']};flex:none}
.lw-hud.off .lw-net{display:flex}
.lw-hud.off .lw-chip,.lw-hud.off .lw-stars{top:44px}
.lw-hud.off .lw-goal.on{transform:translate(-50%,32px)}
.lw-hud.off .lw-touch{top:32px}
.lw-aim{position:absolute;left:50%;top:50%;width:20px;height:20px;transform:translate(-50%,-50%);display:none}
.lw-aim::before,.lw-aim::after{content:"";position:absolute;background:${C['paper-0']};box-shadow:0 0 0 1px ${C['ink-900']}}
.lw-aim::before{left:9px;top:2px;width:2px;height:16px}
.lw-aim::after{left:2px;top:9px;width:16px;height:2px}
.lw-hud.first .lw-aim{display:block}
.lw-hud.dlg .lw-aim{display:none}
.lw-stars{position:absolute;top:12px;right:12px;background:${night};color:${C.sun};padding:6px 12px;border-radius:${S.radiusButtonPx}px;font-family:${T.fonts.pixel};font-size:24px;line-height:24px;display:flex;gap:6px;align-items:center}
.lw-stars.pop{animation:lwpop ${M.popMs}ms ease-out}
.lw-stars .cs,.lw-stars .ci,.lw-stars .cn{display:none}
.lw-stars.coins .cs,.lw-stars.coins .ci,.lw-stars.coins .cn{display:inline-block}
.lw-stars .cs{width:2px;height:20px;background:${C['paper-0']};opacity:.35;margin:0 4px}
.lw-stars .ci{width:18px;height:18px;border-radius:50%;background:${C.sun};box-shadow:inset 0 -3px 0 ${C['sun-d']}}
@keyframes lwpop{0%{transform:scale(1)}50%{transform:scale(1.15)}100%{transform:scale(1)}}
.lw-bub{position:absolute;left:0;top:0;transform:translate(-50%,-100%);max-width:min(360px,70vw);padding:8px 12px;font-family:${T.fonts.target};font-size:${T.scale.h3.sizePx}px;line-height:${T.scale.h3.lineHeightPx}px;font-weight:700;white-space:normal;opacity:0;transition:opacity ${M.baseMs}ms ease-out;will-change:transform}
.lw-bub.on{opacity:1}
.lw-bub::after{content:"";position:absolute;left:50%;bottom:-12px;width:14px;height:14px;background:${C['paper-50']};border-right:${S.borderWidthPx}px solid ${C['ink-900']};border-bottom:${S.borderWidthPx}px solid ${C['ink-900']};transform:translateX(-50%) rotate(45deg)}
.lw-bub .n{display:block;font-family:${T.fonts.ui};font-size:${T.scale.micro.sizePx}px;line-height:${T.scale.micro.lineHeightPx}px;color:${C['ink-700']};font-weight:700}
.lw-bub.me{background:${C.brand};}
.lw-bub.me::after{background:${C.brand}}
.lw-bub.pos{border-color:${C['sun-d']};box-shadow:4px 4px 0 ${C.sun},0 0 0 3px ${C.sun}}
.lw-bub.pos .n::before{content:"\\2726 ";color:${C['sun-d']}}
.lw-prompt{position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:none;pointer-events:auto;cursor:pointer;background:${C['brand-d']};color:${C['paper-0']};border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;box-shadow:${S.shadowDefault};padding:8px 14px;font-weight:700;font-size:${T.scale.body.sizePx}px;min-height:${S.touchTargetMinPx}px;align-items:center;gap:8px}
.lw-prompt.on{display:flex}
.lw-plate{position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:none;background:${C['ink-900']};color:${C['paper-0']};border-radius:${S.radiusButtonPx}px;padding:2px 8px;font-family:${T.fonts.ui};font-size:${T.scale.micro.sizePx}px;line-height:${T.scale.micro.lineHeightPx}px;font-weight:700;opacity:.85;white-space:nowrap}
.lw-plate.on{display:block}
.lw-prompt kbd{font-family:${T.fonts.pixel};background:${C['paper-0']};color:${C['ink-900']};border-radius:2px;padding:0 6px;font-size:12px}
.lw-prompt:active{box-shadow:${S.shadowPressed};transform:translate(-50%,-100%) translate(3px,3px)}
.lw-hotbar{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:4px;align-items:center}
.lw-slot{width:56px;height:56px;background:${night};border:2px solid ${C['night-700']};border-radius:${S.radiusHudSlotPx}px;display:flex;align-items:center;justify-content:center;position:relative;cursor:pointer}
.lw-slot.empty{background:${C['night-900']}73}
.lw-slot.empty::after{content:"";position:absolute;inset:16px;border:2px dashed ${C.silver}8C;border-radius:${S.radiusHudSlotPx}px}
.lw-slot.sel{border-color:${C['paper-0']};box-shadow:0 0 0 2px ${C['ink-900']}}
.lw-slot .i{font-family:${T.fonts.pixel};font-size:12px;position:absolute;left:3px;top:2px;color:${C.silver}}
.lw-cap{position:absolute;bottom:80px;left:50%;transform:translateX(-50%);max-width:calc(100% - 32px);background:${night};color:${C['paper-0']};padding:4px 12px;border-radius:${S.radiusButtonPx}px;font-weight:700;font-size:${T.scale.small.sizePx}px;line-height:${T.scale.small.lineHeightPx}px;text-align:center;opacity:0;transition:opacity ${M.baseMs}ms ease-out;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lw-cap.on{opacity:1}
.lw-hud.dlg .lw-cap{opacity:0}
.lw-slot img{width:36px;height:36px;image-rendering:pixelated}
.lw-slot.pop{animation:lwpop ${M.popMs}ms ease-out}
.lw-slot .c{position:absolute;right:3px;bottom:1px;font-family:${T.fonts.pixel};font-size:12px;color:${C['paper-0']};text-shadow:1px 1px 0 ${C['ink-900']}}
.lw-slot.build img{width:40px;height:40px;image-rendering:auto}
.lw-toast{position:absolute;bottom:84px;left:50%;transform:translateX(-50%) translateY(20px);opacity:0;padding:8px 16px;font-weight:700;transition:all ${M.baseMs}ms ease-out;display:flex;gap:8px;align-items:center}
.lw-toast.on{opacity:1;transform:translateX(-50%) translateY(0)}
.lw-toast img{width:28px;height:28px;image-rendering:pixelated}
.lw-cele{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}
.lw-cele .row{display:flex;gap:12px}
.lw-cele .st{font-size:72px;line-height:72px;transform:scale(0);color:${C.sun};-webkit-text-stroke:3px ${C['ink-900']};text-shadow:4px 4px 0 ${C['ink-900']}}
.lw-cele .st.s1{color:${C.silver}}
.lw-cele .st.s2{color:${C.sky}}
.lw-cele .st.go{animation:lwstar 520ms cubic-bezier(.2,1.6,.4,1) forwards}
@keyframes lwstar{0%{transform:scale(0) rotate(-40deg)}60%{transform:scale(1.15) rotate(8deg)}100%{transform:scale(1) rotate(0)}}
.lw-cele .msg{font-size:${T.scale.h2.sizePx}px;font-weight:800;opacity:0;padding:4px 16px}
.lw-cele .msg.go{opacity:1;transition:opacity ${M.baseMs}ms}
.lw-cele.out{opacity:0;transition:opacity 400ms ease-in}
.lw-fade{position:absolute;inset:0;background:${C['paper-50']};opacity:0;transition:opacity ${M.slowMs}ms ease-in-out;display:flex;align-items:center;justify-content:center}
.lw-fade.on{opacity:1}
.lw-fade .ttl{font-family:${T.fonts.pixel};font-size:48px;line-height:56px;padding:16px 32px;transform:translateY(8px)}
.lw-load{position:absolute;inset:0;background:${C['paper-50']};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;transition:opacity 500ms ease-out;pointer-events:auto}
.lw-load.done{opacity:0;pointer-events:none}
.lw-load .b{width:min(320px,70vw);height:20px;border:2px solid ${C['ink-900']};background:${C['paper-0']};box-shadow:${S.shadowDefault}}
.lw-load .b i{display:block;height:100%;width:0;background:${C.leaf};transition:width 200ms}
.lw-load .h{font-size:${T.scale.h2.sizePx}px;font-weight:800}
.lw-load .p{color:${C['ink-500']};font-size:${T.scale.small.sizePx}px}
.lw-load .cubes{display:flex;gap:6px}
.lw-load .cubes span{width:18px;height:18px;border:2px solid ${C['ink-900']};animation:lwhop 900ms ease-in-out infinite}
.lw-load .cubes span:nth-child(1){background:${C.brand}}
.lw-load .cubes span:nth-child(2){background:${C.sun};animation-delay:150ms}
.lw-load .cubes span:nth-child(3){background:${C.leaf};animation-delay:300ms}
.lw-load .cubes span:nth-child(4){background:${C.sky};animation-delay:450ms}
@keyframes lwhop{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.lw-help{position:absolute;bottom:80px;left:12px;color:${C['paper-0']};background:${night};padding:6px 10px;border-radius:${S.radiusButtonPx}px;font-size:${T.scale.micro.sizePx}px;transition:opacity 600ms}
.lw-help.off{opacity:0}
.lw-touch{position:absolute;inset:0;display:none}
.lw-touch.on{display:block}
.lw-stick{position:absolute;width:120px;height:120px;border-radius:50%;border:3px solid ${C['paper-0']};background:${C['night-900']}55;transform:translate(-50%,-50%);display:none}
.lw-stick.on{display:block}
.lw-stick i{position:absolute;left:50%;top:50%;width:52px;height:52px;border-radius:50%;background:${C['paper-0']};border:2px solid ${C['ink-900']};transform:translate(-50%,-50%)}
.lw-btn{position:absolute;pointer-events:auto;min-width:${S.gameButtonMinPx}px;height:${S.gameButtonMinPx}px;border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;box-shadow:${S.shadowDefault};background:${C['paper-50']};font-weight:800;font-size:${T.scale.small.sizePx}px;padding:0 12px;display:flex;align-items:center;justify-content:center;touch-action:none}
.lw-btn:active,.lw-btn.down{box-shadow:${S.shadowPressed};transform:translate(3px,3px)}
.lw-btn.talk{height:${S.micButtonPx}px;min-width:${S.micButtonPx * 1.6}px;background:${C['brand-d']};color:${C['paper-0']};font-size:${T.scale['body-l'].sizePx}px;display:none}
.lw-btn.talk.on{display:flex}
.lw-dir{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 800ms}
.lw-dir.on{opacity:1}
.lw-dir.blackout{background:${C['night-900']}A6}
.lw-dir.snow{background:radial-gradient(circle at 20% 30%,${C['paper-0']}CC 0 2px,transparent 3px) 0 0/48px 48px,radial-gradient(circle at 70% 60%,${C['paper-0']}AA 0 2px,transparent 3px) 0 0/64px 64px;animation:lwsnow 3s linear infinite}
@keyframes lwsnow{from{background-position:0 0,0 0}to{background-position:-48px 96px,32px 128px}}
.lw-fps{position:absolute;bottom:4px;right:4px;font-family:${T.fonts.pixel};font-size:12px;color:${C['paper-0']};background:${night};padding:2px 6px;display:none}
.lw-fps.on{display:block}
@media (max-width:600px){.lw-slot{width:44px;height:44px}.lw-slot.empty::after{inset:13px}.lw-slot img{width:28px;height:28px}.lw-cap{bottom:64px;font-size:${T.scale.micro.sizePx}px;line-height:${T.scale.micro.lineHeightPx}px}.lw-help{bottom:96px}.lw-goal .t{font-size:${T.scale.h3.sizePx}px}.lw-chip .s{font-size:${T.scale.micro.sizePx}px}
.lw-goal{top:68px;left:12px;right:84px;max-width:none;transform:translate(0,-240%)}.lw-goal.on{transform:translate(0,0)}.lw-hud.off .lw-goal.on{transform:translate(0,32px)}}
@media (prefers-reduced-motion:reduce){.lw-cele .st.go{animation:none;transform:scale(1)}.lw-dir.snow{animation:none}}
`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

/** Tiny pixel-art icon per item key (16 x 16, drawn here; no external art). */
export function itemIconDataUrl(key: string): string {
  if (typeof document === 'undefined') return '';
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const g = c.getContext('2d');
  if (!g) return '';
  const px = (x: number, y: number, w: number, h: number, col: string): void => {
    g.fillStyle = col;
    g.fillRect(x, y, w, h);
  };
  const drink = /tea|latte|choco|juice|lemonade|milk|smoothie|coffee|cocoa/.test(key);
  const food = /cookie|muffin|cake|sandwich|bread|apple|banana/.test(key);
  if (drink) {
    const liquid = /choco|cocoa|latte|coffee/.test(key) ? '#8a5a2b' : /lemon|juice|orange/.test(key) ? '#ffb347' : /milk/.test(key) ? '#ffffff' : /smoothie/.test(key) ? '#ff9cc2' : '#ffc53d';
    px(3, 4, 10, 11, '#1b1f2a');
    px(4, 5, 8, 9, '#fff9ee');
    px(4, 6, 8, 3, liquid);
    px(12, 7, 3, 1, '#1b1f2a');
    px(14, 7, 1, 4, '#1b1f2a');
    px(12, 10, 3, 1, '#1b1f2a');
    if (/warm|hot|tea|latte|choco/.test(key) && !/iced/.test(key)) {
      px(5, 1, 1, 2, '#c9ced9');
      px(8, 0, 1, 3, '#c9ced9');
      px(11, 1, 1, 2, '#c9ced9');
    }
    if (/honey/.test(key)) px(6, 10, 4, 2, '#ffc53d');
  } else if (food) {
    const col = /apple/.test(key) ? '#e5484d' : /banana/.test(key) ? '#ffc53d' : /cake/.test(key) ? '#ff9cc2' : '#c98a4a';
    px(3, 4, 10, 10, '#1b1f2a');
    px(4, 5, 8, 8, col);
    px(5, 6, 2, 2, '#fff9ee');
    if (/cookie/.test(key)) {
      px(7, 9, 1, 1, '#4a3322');
      px(10, 7, 1, 1, '#4a3322');
      px(6, 11, 1, 1, '#4a3322');
    }
    if (/apple/.test(key)) px(8, 2, 1, 3, '#3dbe6b');
  } else {
    px(2, 5, 12, 10, '#1b1f2a');
    px(3, 6, 10, 8, '#ff6b4a');
    px(7, 6, 2, 8, '#ffc53d');
    px(2, 3, 12, 3, '#1b1f2a');
    px(3, 4, 10, 1, '#ff8a6a');
    px(5, 1, 2, 2, '#ffc53d');
    px(9, 1, 2, 2, '#ffc53d');
  }
  return c.toDataURL();
}

export interface HudHandlers {
  onTalk(): void;
  onJump(down: boolean): void;
  onView(): void;
  onStick(dx: number, dz: number, active: boolean): void;
  onLook(dx: number, dy: number): void;
  onSlot(i: number): void;
}

export class WorldHud {
  readonly root: HTMLDivElement;
  private goal: HTMLDivElement;
  private goalG: HTMLDivElement;
  private goalT: HTMLDivElement;
  private sceneChip: HTMLSpanElement;
  private lessonChip: HTMLSpanElement;
  /** weather + world clock chip (docs/08 8.1 "맑음 08:45") */
  private clockChip: HTMLSpanElement;
  private clockText: HTMLSpanElement;
  private sceneTitle = '';
  private bandId: BandId | '' = '';
  private clockKey = '';
  private weather: 'clear' | 'snow' = 'clear';
  private cap: HTMLDivElement;
  private capTimer = 0;
  private starsEl: HTMLDivElement;
  private starsN: HTMLSpanElement;
  private coinsN: HTMLSpanElement;
  private coinTotal: number | null = null;
  private prompt: HTMLDivElement;
  private plate: HTMLDivElement;
  private slots: HTMLDivElement[] = [];
  /** item slot contents, kept while the hotbar shows build stacks */
  private itemSlots: Array<{ src: string; title: string } | null> = [null, null, null, null, null];
  private buildSlotsOn = false;
  private toast: HTMLDivElement;
  private toastTimer = 0;
  private cele: HTMLDivElement;
  private fade: HTMLDivElement;
  private fadeTitle: HTMLDivElement;
  private load: HTMLDivElement;
  private loadBar: HTMLElement;
  private help: HTMLDivElement;
  private touch: HTMLDivElement;
  private stick: HTMLDivElement;
  private stickKnob: HTMLElement;
  private talkBtn: HTMLDivElement;
  private dirLayer: HTMLDivElement;
  private fpsEl: HTMLDivElement;
  private bubbles = new Map<
    string,
    { el: HTMLDivElement; text: HTMLSpanElement; until: number; full: string; shown: number; sx: number; sy: number; vis: boolean; live: boolean }
  >();
  starTotal = 0;
  /** Set by setStars: an outside count owns the chip (a lesson), celebrate() only plays the burst. */
  private starsExternal = false;
  /** The world's own count (celebrate), kept while a lesson shows its own, so the chip can go back to it. */
  private ownStars = 0;
  private selected = 0;

  constructor(parent: HTMLElement, private h: HudHandlers) {
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = css();
      document.head.appendChild(st);
    }
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    this.root = el('div', 'lw-hud', parent);

    this.dirLayer = el('div', 'lw-dir', this.root);
    this.goal = el('div', 'lw-goal lw-card', this.root);
    const k = el('div', 'k', this.goal);
    k.textContent = W.goalLabel;
    this.goalG = el('div', 'g', this.goal);
    this.goalT = el('div', 't', this.goal);
    this.goalT.lang = 'en';

    const chip = el('div', 'lw-chip', this.root);
    // one compact chip, two lines: "중앙 광장 · 지상" over "맑음 10:30" (the lesson tag keeps its place next to it)
    const sc = el('span', 's', chip);
    this.sceneChip = el('span', 'p', sc);
    this.clockChip = el('span', 'w none', sc);
    el('i', '', this.clockChip);
    this.clockText = el('span', '', this.clockChip);
    this.lessonChip = el('span', 'l', chip);
    this.lessonChip.textContent = W.lessonBadge;
    // G01 empty state: the connection dropped, the world keeps going on this device (docs/08 8.6).
    const net = el('div', 'lw-net', this.root);
    net.setAttribute('role', 'status');
    el('i', '', net);
    el('span', '', net).textContent = W.offlineBand;
    el('div', 'lw-aim', this.root);

    this.starsEl = el('div', 'lw-stars', this.root);
    const si = el('span', '', this.starsEl);
    si.textContent = '★';
    this.starsN = el('span', '', this.starsEl);
    this.starsN.textContent = '0';
    // coin balance from the server ledger (hidden until a ledger total arrives)
    el('span', 'cs', this.starsEl);
    const ci = el('span', 'ci', this.starsEl);
    ci.setAttribute('aria-label', W.coinsLabel);
    this.coinsN = el('span', 'cn', this.starsEl);

    this.plate = el('div', 'lw-plate', this.root);
    this.prompt = el('div', 'lw-prompt', this.root);
    this.prompt.innerHTML = '';
    const kbd = el('kbd', '', this.prompt);
    kbd.textContent = W.talkKey;
    const pl = el('span', '', this.prompt);
    pl.textContent = W.talk;
    this.prompt.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.h.onTalk();
    });

    const bar = el('div', 'lw-hotbar', this.root);
    for (let i = 0; i < 5; i++) {
      const s = el('div', 'lw-slot empty', bar);
      s.style.pointerEvents = 'auto';
      const n = el('span', 'i', s);
      n.textContent = String(i + 1);
      s.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.h.onSlot(i);
      });
      this.slots.push(s);
    }
    this.cap = el('div', 'lw-cap', this.root);
    this.selectSlot(0, false);

    this.toast = el('div', 'lw-toast lw-card', this.root);
    this.cele = el('div', 'lw-cele', this.root);
    this.help = el('div', 'lw-help', this.root);

    // Touch layer (docs/08 7.2): left half stick, right half look, buttons on the right.
    this.touch = el('div', 'lw-touch', this.root);
    this.stick = el('div', 'lw-stick', this.touch);
    this.stickKnob = el('i', '', this.stick);
    const jump = el('div', 'lw-btn', this.touch);
    jump.textContent = W.jump;
    jump.style.right = '24px';
    jump.style.bottom = '96px';
    jump.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      jump.classList.add('down');
      this.h.onJump(true);
    });
    const up = (): void => {
      jump.classList.remove('down');
      this.h.onJump(false);
    };
    jump.addEventListener('pointerup', up);
    jump.addEventListener('pointercancel', up);
    const view = el('div', 'lw-btn', this.touch);
    view.textContent = W.view;
    view.style.right = '12px';
    view.style.top = '60px';
    view.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.h.onView();
    });
    this.talkBtn = el('div', 'lw-btn talk', this.touch);
    this.talkBtn.textContent = W.talk;
    this.talkBtn.style.right = '96px';
    this.talkBtn.style.bottom = '160px';
    this.talkBtn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.h.onTalk();
    });
    this.bindTouch();

    this.fade = el('div', 'lw-fade', this.root);
    this.fadeTitle = el('div', 'ttl lw-card', this.fade);
    this.fpsEl = el('div', 'lw-fps', this.root);

    this.load = el('div', 'lw-load', this.root);
    const cubes = el('div', 'cubes', this.load);
    for (let i = 0; i < 4; i++) el('span', '', cubes);
    const lh = el('div', 'h', this.load);
    lh.textContent = W.loading;
    const b = el('div', 'b', this.load);
    this.loadBar = el('i', '', b);
    const lp = el('div', 'p', this.load);
    lp.textContent = W.loadingHint;
  }

  private bindTouch(): void {
    let stickId = -1;
    let lookId = -1;
    let sx = 0;
    let sy = 0;
    let lx = 0;
    let ly = 0;
    const R = 50;
    this.touch.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      const rect = this.root.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      if (x < rect.width / 2 && stickId < 0) {
        stickId = e.pointerId;
        sx = x;
        sy = y;
        this.stick.style.left = `${x}px`;
        this.stick.style.top = `${y}px`;
        this.stick.classList.add('on');
        this.stickKnob.style.transform = 'translate(-50%,-50%)';
      } else if (lookId < 0) {
        lookId = e.pointerId;
        lx = e.clientX;
        ly = e.clientY;
      }
      this.touch.setPointerCapture?.(e.pointerId);
    });
    this.touch.addEventListener('pointermove', (e) => {
      if (e.pointerId === stickId) {
        const rect = this.root.getBoundingClientRect();
        let dx = e.clientX - rect.left - sx;
        let dy = e.clientY - rect.top - sy;
        const d = Math.hypot(dx, dy);
        if (d > R) {
          dx = (dx / d) * R;
          dy = (dy / d) * R;
        }
        this.stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        this.h.onStick(dx / R, dy / R, true);
      } else if (e.pointerId === lookId) {
        this.h.onLook(e.clientX - lx, e.clientY - ly);
        lx = e.clientX;
        ly = e.clientY;
      }
    });
    const end = (e: PointerEvent): void => {
      if (e.pointerId === stickId) {
        stickId = -1;
        this.stick.classList.remove('on');
        this.h.onStick(0, 0, false);
      }
      if (e.pointerId === lookId) lookId = -1;
    };
    this.touch.addEventListener('pointerup', end);
    this.touch.addEventListener('pointercancel', end);
  }

  setTouch(on: boolean): void {
    this.touch.classList.toggle('on', on);
    this.touch.style.pointerEvents = on ? 'auto' : 'none';
    this.help.textContent = on ? W.controlsTouch : W.controlsDesktop;
    this.help.classList.remove('off');
    window.setTimeout(() => this.help.classList.add('off'), 9000);
  }

  setTouchPaused(paused: boolean): void {
    this.touch.style.visibility = paused ? 'hidden' : 'visible';
  }

  setLoading(fraction: number, done: boolean): void {
    this.loadBar.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
    if (done && !this.load.classList.contains('done')) {
      this.load.classList.add('done');
      // an all-empty bar says what it is for once, so five dark boxes never read as unfinished
      if (this.allEmpty()) this.showCaption(6000);
    }
  }

  /** Scene title, band, weather and world clock (docs/08 8.1 top line). Called every frame; DOM only on change. */
  tickStatus(hour: number, y: number): void {
    const band = bandOf(y);
    if (band !== this.bandId) {
      this.bandId = band;
      this.drawScene();
    }
    // compare whole minutes first: the label string is built only when the minute or the weather changes
    const minute = Math.floor((((hour % 24) + 24) % 24) * 60 + 1e-6);
    const mk = `${minute}${this.weather}`;
    if (mk === this.clockKey) return;
    this.clockKey = mk;
    const night = isNight(hour);
    this.clockText.textContent = clockLabel(hour, this.weather);
    this.clockChip.classList.remove('none');
    this.clockChip.classList.toggle('night', night && this.weather === 'clear');
    this.clockChip.classList.toggle('snow', this.weather === 'snow');
  }

  /** Connection to the server: false shows the "혼자 모드로 계속 중" band (the world keeps running). */
  setOnline(on: boolean): void {
    this.root.classList.toggle('off', !on);
  }

  /** Camera mode from the world: the centre crosshair shows only in first person (hidden under a dialog). */
  setCamMode(mode: 'first' | 'third' | 'mirror'): void {
    this.root.classList.toggle('first', mode === 'first');
  }

  private drawScene(): void {
    this.sceneChip.textContent = this.bandId ? placeLabel(this.sceneTitle, this.bandId) : this.sceneTitle;
  }

  private allEmpty(): boolean {
    return !this.buildSlotsOn && this.itemSlots.every((x) => x === null);
  }

  /** Name of the selected slot over the bar (or what an empty bar is for); fades after `ms`. */
  private showCaption(ms = 2400): void {
    const text = this.buildSlotsOn ? (this.slots[this.selected]?.title ?? '') : hotbarCaption(this.itemSlots, this.selected);
    window.clearTimeout(this.capTimer);
    if (!text) {
      this.cap.classList.remove('on');
      return;
    }
    this.cap.textContent = text;
    this.cap.classList.add('on');
    this.capTimer = window.setTimeout(() => this.cap.classList.remove('on'), ms);
  }

  /** A panel covers the bottom (dialog window): the goal card steps aside so the NPC's face shows in the strip. */
  setDialogOpen(on: boolean): void {
    this.root.classList.toggle('dlg', on);
  }

  setGoal(goalKo: string, targetEn?: string): void {
    const on = goalKo.trim().length > 0 || !!targetEn;
    this.goalG.textContent = goalKo;
    this.goalT.textContent = targetEn ?? '';
    this.goalT.style.display = targetEn ? 'block' : 'none';
    this.goal.classList.toggle('on', on);
  }

  setScene(titleKo: string): void {
    this.sceneTitle = titleKo;
    this.drawScene();
  }

  /** Outside star count (a lesson's stars): the chip shows it, celebrate() stops adding. null = back to celebrate(). */
  setStars(total: number | null): void {
    if (total === null || !Number.isFinite(total)) {
      if (!this.starsExternal) return;
      this.starsExternal = false;
      this.starTotal = this.ownStars;
      this.starsN.textContent = String(this.ownStars);
      return;
    }
    this.starsExternal = true;
    const n = Math.max(0, Math.round(total));
    if (n === this.starTotal) return;
    const grew = n > this.starTotal;
    this.starTotal = n;
    this.starsN.textContent = String(n);
    if (grew) {
      this.starsEl.classList.remove('pop');
      void this.starsEl.offsetWidth;
      this.starsEl.classList.add('pop');
    }
  }

  /** Server ledger balance (one ledger, docs/19): null hides the coin chip. */
  setCoins(total: number | null): void {
    const n = total === null || !Number.isFinite(total) ? null : Math.max(0, Math.round(total));
    if (n === this.coinTotal) return;
    const grew = n !== null && this.coinTotal !== null && n > this.coinTotal;
    this.coinTotal = n;
    this.starsEl.classList.toggle('coins', n !== null);
    this.coinsN.textContent = n === null ? '' : String(n);
    if (grew) {
      this.starsEl.classList.remove('pop');
      void this.starsEl.offsetWidth;
      this.starsEl.classList.add('pop');
    }
  }

  setLessonBadge(on: boolean): void {
    this.lessonChip.classList.toggle('on', on);
  }

  selectSlot(i: number, caption = true): void {
    this.selected = i;
    this.slots.forEach((s, k) => s.classList.toggle('sel', k === i));
    if (caption) this.showCaption();
  }

  putItem(slot: number, key: string): void {
    const s = this.slots[slot];
    if (!s) return;
    this.itemSlots[slot] = { src: itemIconDataUrl(key), title: itemNameKo(key) };
    if (!this.buildSlotsOn) this.drawSlot(slot, this.itemSlots[slot], null);
    const img = { src: this.itemSlots[slot]!.src };
    s.classList.remove('pop');
    void s.offsetWidth;
    s.classList.add('pop');
    // the toast names the new thing; the caption stays quiet so the two never stack
    this.selectSlot(slot, false);
    this.cap.classList.remove('on');
    // toast
    this.toast.innerHTML = '';
    const ti = document.createElement('img');
    ti.src = img.src;
    ti.alt = '';
    this.toast.appendChild(ti);
    const tt = document.createElement('span');
    tt.textContent = W.itemGot(itemNameKo(key));
    this.toast.appendChild(tt);
    this.toast.classList.add('on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('on'), 2600);
  }

  /** Empty an item slot (the item was handed over); the build bar keeps drawing while building is on. */
  clearItem(slot: number): void {
    if (!this.slots[slot]) return;
    this.itemSlots[slot] = null;
    if (!this.buildSlotsOn) this.drawSlot(slot, null, null);
  }

  private drawSlot(i: number, c: { src: string; title: string } | null, count: number | null): void {
    const s = this.slots[i];
    if (!s) return;
    s.querySelector('img')?.remove();
    s.querySelector('.c')?.remove();
    s.title = c?.title ?? '';
    s.classList.toggle('build', this.buildSlotsOn);
    s.classList.toggle('empty', !c);
    if (!c) return;
    const img = document.createElement('img');
    img.alt = c.title;
    img.src = c.src;
    s.appendChild(img);
    if (count !== null) el('span', 'c', s).textContent = String(count);
  }

  /**
   * On my plot the hotbar shows the five carried build stacks (icon + count, docs/03 D13); null puts the item
   * slots back. Only changed slots are redrawn.
   */
  setBuildSlots(slots: Array<{ icon: string; count: number; name: string } | null> | null): void {
    const key = slots ? JSON.stringify(slots.map((x) => (x ? [x.name, x.count] : null))) : '';
    if (key === this.buildKey && (slots !== null) === this.buildSlotsOn) return;
    this.buildKey = key;
    this.buildSlotsOn = slots !== null;
    for (let i = 0; i < this.slots.length; i++) {
      if (slots) {
        const b = slots[i] ?? null;
        this.drawSlot(i, b ? { src: b.icon, title: b.name } : null, b ? b.count : null);
      } else this.drawSlot(i, this.itemSlots[i] ?? null, null);
    }
  }
  private buildKey = '';

  get selectedSlot(): number {
    return this.selected;
  }

  celebrate(stars: 0 | 1 | 2 | 3, reduceMotion: boolean, add: number = stars): void {
    this.cele.innerHTML = '';
    this.cele.classList.remove('out');
    const row = el('div', 'row', this.cele);
    const msg = el('div', 'msg lw-card', this.cele);
    msg.textContent = stars === 0 ? W.starsAgain : W.starsGot(stars);
    for (let i = 0; i < stars; i++) {
      const s = el('span', `st s${stars}`, row);
      s.textContent = '★';
      window.setTimeout(() => s.classList.add('go'), reduceMotion ? 0 : 120 + i * 160);
    }
    window.setTimeout(() => msg.classList.add('go'), 80 + stars * 160);
    window.setTimeout(() => this.cele.classList.add('out'), 1900);
    window.setTimeout(() => {
      if (this.cele.classList.contains('out')) this.cele.innerHTML = '';
    }, 2400);
    if (stars > 0 && add > 0 && !this.starsExternal) {
      window.setTimeout(() => {
        this.ownStars += add;
        if (this.starsExternal) return;
        this.starTotal += add;
        this.starsN.textContent = String(this.starTotal);
        this.starsEl.classList.remove('pop');
        void this.starsEl.offsetWidth;
        this.starsEl.classList.add('pop');
      }, 1300);
    }
  }

  /** Fade out, run `mid` (it may wait, e.g. for the ground at the new spot; the card stays up meanwhile), fade in. */
  async fadeTo(titleKo: string, mid: () => void | Promise<void>): Promise<void> {
    this.fadeTitle.textContent = titleKo;
    this.fade.classList.add('on');
    await wait(360);
    await mid();
    await wait(420);
    this.fade.classList.remove('on');
    await wait(340);
  }

  bubble(id: string, name: string, text: string, opts: { me?: boolean; possessed?: boolean }, nowMs: number): void {
    let b = this.bubbles.get(id);
    if (!b) {
      const e = el('div', 'lw-bub lw-card', this.root);
      e.lang = 'en';
      const n = el('span', 'n', e);
      n.lang = 'ko';
      const t = el('span', 'x', e);
      b = { el: e, text: t, until: 0, full: '', shown: 0, sx: 0, sy: 0, vis: false, live: false };
      this.bubbles.set(id, b);
    }
    (b.el.firstChild as HTMLElement).textContent = name;
    b.el.classList.toggle('me', !!opts.me);
    b.el.classList.toggle('pos', !!opts.possessed);
    b.full = text;
    b.shown = 0;
    b.text.textContent = '';
    // Reading time: 2.5 s + 70 ms per character, capped (docs/08 5장 rhythm).
    b.until = nowMs + Math.min(11000, 2500 + text.length * 70);
    b.el.classList.add('on');
  }

  /** Is a bubble still typing (drives the mouth animation). */
  bubbleTyping(id: string): boolean {
    const b = this.bubbles.get(id);
    return !!b && b.shown < b.full.length;
  }

  updateBubble(id: string, sx: number, sy: number, visible: boolean, nowMs: number, dt: number): void {
    const b = this.bubbles.get(id);
    if (!b) return;
    if (nowMs > b.until) {
      b.el.classList.remove('on');
      b.live = false;
      return;
    }
    if (b.shown < b.full.length) {
      b.shown = Math.min(b.full.length, b.shown + dt * 45);
      b.text.textContent = b.full.slice(0, Math.ceil(b.shown));
    }
    b.sx = sx;
    b.sy = sy;
    b.vis = visible;
    b.live = true;
  }

  /**
   * Place this frame's bubbles. Two people talking stand close, so their bubbles would cover each other:
   * the lowest bubble keeps its anchor and every other one is lifted above whatever it overlaps.
   */
  flushBubbles(): void {
    const live = [...this.bubbles.values()].filter((b) => {
      if (!b.live) {
        // not updated this frame: expired or its speaker is gone, so it must not linger on screen
        b.el.classList.remove('on');
        b.el.style.visibility = 'hidden';
        return false;
      }
      b.live = false;
      b.el.style.visibility = b.vis ? 'visible' : 'hidden';
      return b.vis;
    });
    live.sort((a, b) => b.sy - a.sy);
    const placed: Array<{ l: number; r: number; t: number; b: number }> = [];
    const gap = 6;
    for (const b of live) {
      const w = b.el.offsetWidth || 200;
      const h = b.el.offsetHeight || 60;
      let y = b.sy;
      for (let guard = 0; guard < 6; guard++) {
        const hit = placed.find((p) => b.sx - w / 2 < p.r + gap && b.sx + w / 2 > p.l - gap && y - h < p.b + gap && y > p.t - gap);
        if (!hit) break;
        y = hit.t - gap;
      }
      y = Math.max(h + 8, y);
      placed.push({ l: b.sx - w / 2, r: b.sx + w / 2, t: y - h, b: y });
      b.el.style.transform = `translate(${b.sx}px, ${y}px) translate(-50%, -100%)`;
    }
  }

  /** Drop every bubble at once (scene change by fade: old lines belong to the old place). */
  clearBubbles(): void {
    for (const b of this.bubbles.values()) {
      b.until = 0;
      b.live = false;
      b.el.classList.remove('on');
      b.el.style.visibility = 'hidden';
    }
  }

  hasBubble(id: string, nowMs: number): boolean {
    const b = this.bubbles.get(id);
    return !!b && nowMs <= b.until;
  }

  /** Name plate over the player (linked child's nickname). */
  setPlate(name: string | null): void {
    this.plate.textContent = name ?? '';
    this.plate.classList.toggle('on', !!name);
  }

  placePlate(sx: number, sy: number, visible: boolean): void {
    if (!this.plate.textContent) return;
    this.plate.style.visibility = visible ? 'visible' : 'hidden';
    this.plate.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
  }

  private promptKey = '';

  /** Called every frame: touches the DOM only when something changed (whole pixels), so idle frames cost no style work. */
  showPrompt(on: boolean, sx = 0, sy = 0, touch = false): void {
    const x = Math.round(sx);
    const y = Math.round(sy);
    const key = on ? `${touch ? 't' : 'k'}:${x}:${y}` : 'off';
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.prompt.classList.toggle('on', on && !touch);
    this.talkBtn.classList.toggle('on', on && touch);
    if (on) this.prompt.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
  }

  director(kind: 'blackout' | 'snow' | null): void {
    this.dirLayer.className = `lw-dir${kind ? ` on ${kind}` : ''}`;
    this.weather = kind === 'snow' ? 'snow' : 'clear';
    this.clockKey = '';
  }

  setFps(text: string | null): void {
    this.fpsEl.classList.toggle('on', text !== null);
    if (text) this.fpsEl.textContent = text;
  }

  dispose(): void {
    this.root.remove();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
