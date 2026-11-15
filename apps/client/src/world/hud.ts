/**
 * World HUD in plain DOM over the canvas (docs/08 8.1, 7.2): goal line, scene chip, star counter, speech
 * bubbles, talk prompt, 5-slot hotbar, item toast, star celebration, scene title card, touch controls.
 * Colors, type and motion come from @lcw/ui tokens only (AGENTS 6). No prices or payment on this screen (AGENTS 4.9).
 */
import { COLOR_TOKENS as C, MOTION_TOKENS as M, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import { WORLD_STRINGS as W, itemNameKo } from './strings.js';

const STYLE_ID = 'lcw-world-hud-style';

function css(): string {
  const night = `${C['night-900']}D9`; // 85% (docs/08 2.1)
  return `
.lw-hud{position:absolute;inset:0;pointer-events:none;font-family:${T.fonts.ui};color:${C['ink-900']};user-select:none;-webkit-user-select:none;overflow:hidden;touch-action:none}
.lw-hud *{box-sizing:border-box}
.lw-card{background:${C['paper-50']};border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;box-shadow:${S.shadowDefault}}
.lw-goal{position:absolute;top:12px;left:50%;transform:translate(-50%,-140%);max-width:min(720px,calc(100% - 32px));padding:8px 16px;display:flex;flex-direction:column;align-items:center;gap:2px;transition:transform ${M.slowMs}ms ease-out;text-align:center}
.lw-goal.on{transform:translate(-50%,0)}
.lw-goal .k{font-size:${T.scale.small.sizePx}px;line-height:${T.scale.small.lineHeightPx}px;font-weight:700;color:${C['brand-d']}}
.lw-goal .g{font-size:${T.scale['body-l'].sizePx}px;line-height:${T.scale['body-l'].lineHeightPx}px;font-weight:700}
.lw-goal .t{font-family:${T.fonts.target};font-size:${T.scale.h3.sizePx}px;line-height:${T.scale.h3.lineHeightPx}px;font-weight:700;color:${C['sky-d']}}
.lw-chip{position:absolute;top:12px;left:12px;display:flex;gap:8px;align-items:center}
.lw-chip .s{background:${night};color:${C['paper-0']};padding:6px 12px;border-radius:${S.radiusButtonPx}px;font-weight:700;font-size:${T.scale.small.sizePx}px}
.lw-chip .l{background:${C.sky};color:${C['ink-900']};padding:4px 8px;border-radius:${S.radiusButtonPx}px;font-weight:700;font-size:${T.scale.micro.sizePx}px;border:2px solid ${C['ink-900']};display:none}
.lw-chip .l.on{display:inline-block}
.lw-stars{position:absolute;top:12px;right:12px;background:${night};color:${C.sun};padding:6px 12px;border-radius:${S.radiusButtonPx}px;font-family:${T.fonts.pixel};font-size:24px;line-height:24px;display:flex;gap:6px;align-items:center}
.lw-stars.pop{animation:lwpop ${M.popMs}ms ease-out}
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
.lw-prompt kbd{font-family:${T.fonts.pixel};background:${C['paper-0']};color:${C['ink-900']};border-radius:2px;padding:0 6px;font-size:12px}
.lw-prompt:active{box-shadow:${S.shadowPressed};transform:translate(-50%,-100%) translate(3px,3px)}
.lw-hotbar{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:4px}
.lw-slot{width:56px;height:56px;background:${night};border:2px solid ${C['night-700']};border-radius:${S.radiusHudSlotPx}px;display:flex;align-items:center;justify-content:center;position:relative}
.lw-slot.sel{border-color:${C['paper-0']}}
.lw-slot .i{font-family:${T.fonts.pixel};font-size:12px;position:absolute;left:3px;top:2px;color:${C.silver}}
.lw-slot img{width:36px;height:36px;image-rendering:pixelated}
.lw-slot.pop{animation:lwpop ${M.popMs}ms ease-out}
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
@media (max-width:600px){.lw-slot{width:44px;height:44px}.lw-slot img{width:28px;height:28px}.lw-goal .t{font-size:${T.scale.h3.sizePx}px}.lw-chip .s{font-size:${T.scale.micro.sizePx}px}}
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
  private starsEl: HTMLDivElement;
  private starsN: HTMLSpanElement;
  private prompt: HTMLDivElement;
  private slots: HTMLDivElement[] = [];
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
  private bubbles = new Map<string, { el: HTMLDivElement; text: HTMLSpanElement; until: number; full: string; shown: number }>();
  starTotal = 0;
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
    this.sceneChip = el('span', 's', chip);
    this.lessonChip = el('span', 'l', chip);
    this.lessonChip.textContent = W.lessonBadge;

    this.starsEl = el('div', 'lw-stars', this.root);
    const si = el('span', '', this.starsEl);
    si.textContent = '★';
    this.starsN = el('span', '', this.starsEl);
    this.starsN.textContent = '0';

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
      const s = el('div', 'lw-slot', bar);
      s.style.pointerEvents = 'auto';
      const n = el('span', 'i', s);
      n.textContent = String(i + 1);
      s.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.h.onSlot(i);
      });
      this.slots.push(s);
    }
    this.selectSlot(0);

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
    if (done) this.load.classList.add('done');
  }

  setGoal(goalKo: string, targetEn?: string): void {
    const on = goalKo.trim().length > 0 || !!targetEn;
    this.goalG.textContent = goalKo;
    this.goalT.textContent = targetEn ?? '';
    this.goalT.style.display = targetEn ? 'block' : 'none';
    this.goal.classList.toggle('on', on);
  }

  setScene(titleKo: string): void {
    this.sceneChip.textContent = titleKo;
  }

  setLessonBadge(on: boolean): void {
    this.lessonChip.classList.toggle('on', on);
  }

  selectSlot(i: number): void {
    this.selected = i;
    this.slots.forEach((s, k) => s.classList.toggle('sel', k === i));
  }

  putItem(slot: number, key: string): void {
    const s = this.slots[slot];
    if (!s) return;
    s.querySelector('img')?.remove();
    const img = document.createElement('img');
    img.alt = itemNameKo(key);
    img.src = itemIconDataUrl(key);
    s.appendChild(img);
    s.title = itemNameKo(key);
    s.classList.remove('pop');
    void s.offsetWidth;
    s.classList.add('pop');
    this.selectSlot(slot);
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

  get selectedSlot(): number {
    return this.selected;
  }

  celebrate(stars: 0 | 1 | 2 | 3, reduceMotion: boolean): void {
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
    if (stars > 0) {
      window.setTimeout(() => {
        this.starTotal += stars;
        this.starsN.textContent = String(this.starTotal);
        this.starsEl.classList.remove('pop');
        void this.starsEl.offsetWidth;
        this.starsEl.classList.add('pop');
      }, 1300);
    }
  }

  async fadeTo(titleKo: string, mid: () => void): Promise<void> {
    this.fadeTitle.textContent = titleKo;
    this.fade.classList.add('on');
    await wait(360);
    mid();
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
      b = { el: e, text: t, until: 0, full: '', shown: 0 };
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
      return;
    }
    if (b.shown < b.full.length) {
      b.shown = Math.min(b.full.length, b.shown + dt * 45);
      b.text.textContent = b.full.slice(0, Math.ceil(b.shown));
    }
    b.el.style.visibility = visible ? 'visible' : 'hidden';
    b.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
  }

  hasBubble(id: string, nowMs: number): boolean {
    const b = this.bubbles.get(id);
    return !!b && nowMs <= b.until;
  }

  showPrompt(on: boolean, sx = 0, sy = 0, touch = false): void {
    this.prompt.classList.toggle('on', on && !touch);
    this.talkBtn.classList.toggle('on', on && touch);
    if (on) this.prompt.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -100%)`;
  }

  director(kind: 'blackout' | 'snow' | null): void {
    this.dirLayer.className = `lw-dir${kind ? ` on ${kind}` : ''}`;
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
