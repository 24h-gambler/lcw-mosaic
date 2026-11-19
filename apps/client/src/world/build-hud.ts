/**
 * Building HUD on my plot (docs/03 D13, docs/08 7.2): tool buttons (place / break, big enough for a child's thumb),
 * the chest panel (unlimited storage ↔ five carried slots), undo and turn, the reason next to a refused edit, the
 * save state, and the room-check card (English sentence to read aloud + a Korean gloss). Tokens only (AGENTS 6),
 * no prices on this screen (AGENTS 4.9).
 */
import { COLOR_TOKENS as C, MOTION_TOKENS as M, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import { BLOCK_PALETTE, FURNITURE_REGISTRY } from '@lcw/content';
import { BUILD_PALETTE, parseRef, type ItemRef, type PlotInventory } from '@lcw/sim-core';
import { TILE_LAYER, blockLook } from './blocks.js';
import { TILE_PX } from './atlas.js';
import { furniturePieces } from './build-view.js';
import type { RoomCheckEvent } from './build.js';
import { BLOCK_NAMES_KO, BUILD_REASONS_KO, FURNITURE_NAMES_KO, ROOM_GLOSS_KO, SHOWROOM_DEFAULT_TITLE, SHOWROOM_REASONS_KO, WORLD_STRINGS as W } from './strings.js';
import type { ShowroomResult } from './showroom.js';
import { helpKoOn } from './lang.js';
import type { SyncStatus } from './plot-sync.js';

const STYLE_ID = 'lcw-build-hud-style';

function css(): string {
  const night = `${C['night-900']}D9`;
  return `
.lb-tools{position:absolute;right:12px;bottom:200px;display:none;flex-direction:column;gap:10px;align-items:flex-end;pointer-events:none}
.lb-tools.on{display:flex}
.lb-row{display:flex;gap:8px}
.lb-btn{pointer-events:auto;min-width:${S.gameButtonMinPx}px;height:${S.gameButtonMinPx}px;border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;box-shadow:${S.shadowDefault};background:${C['paper-50']};font-family:${T.fonts.ui};font-weight:800;font-size:calc(${T.scale.small.sizePx}px * var(--lcw-hs,1));padding:0 12px;display:flex;align-items:center;justify-content:center;gap:6px;cursor:pointer;touch-action:none;color:${C['ink-900']}}
.lb-btn:active{box-shadow:${S.shadowPressed};transform:translate(3px,3px)}
.lb-btn.sel{background:${C.brand}}
.lb-btn.brk.sel{background:${C.danger};color:${C['paper-0']}}
.lb-btn.off{display:none}
.lb-tip{position:absolute;left:50%;bottom:84px;transform:translateX(-50%);background:${night};color:${C['paper-0']};padding:6px 12px;border-radius:${S.radiusButtonPx}px;font-weight:700;font-size:calc(${T.scale.small.sizePx}px * var(--lcw-hs,1));white-space:nowrap;opacity:0;transition:opacity ${M.baseMs}ms}
.lb-tip.on{opacity:1}
.lb-tip.bad{background:${C.danger};color:${C['paper-0']}}
.lb-sync{position:absolute;top:56px;left:12px;background:${night};color:${C['paper-0']};padding:4px 10px;border-radius:${S.radiusButtonPx}px;font-size:calc(${T.scale.micro.sizePx}px * var(--lcw-hs,1));font-weight:700;display:none}
.lb-sync.on{display:block}
.lb-sync.warn{background:${C.sun};color:${C['ink-900']}}
.lb-help{position:absolute;left:12px;bottom:80px;max-width:min(520px,calc(100% - 24px));background:${night};color:${C['paper-0']};padding:6px 10px;border-radius:${S.radiusButtonPx}px;font-size:calc(${T.scale.micro.sizePx}px * var(--lcw-hs,1));font-weight:700;opacity:0;transition:opacity 600ms}
.lb-help.on{opacity:1}
.lb-chest{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:${C['night-900']}66;pointer-events:auto}
.lb-chest.on{display:flex}
.lb-panel{width:min(640px,calc(100% - 24px));max-height:calc(100% - 24px);display:flex;flex-direction:column;gap:10px;padding:16px}
.lb-panel h2{margin:0;font-size:calc(${T.scale.h3.sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale.h3.lineHeightPx}px * var(--lcw-hs,1))}
.lb-panel p{margin:0;color:${C['ink-700']};font-size:calc(${T.scale.small.sizePx}px * var(--lcw-hs,1))}
.lb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(64px,1fr));gap:6px;overflow-y:auto;min-height:0;padding:2px}
.lb-cell{position:relative;height:72px;border:2px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;background:${C['paper-0']};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;cursor:pointer;font-size:calc(${T.scale.micro.sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale.micro.lineHeightPx}px * var(--lcw-hs,1));text-align:center;padding:2px}
.lb-cell img{width:36px;height:36px}
.lb-cell .n{position:absolute;right:4px;top:2px;font-family:${T.fonts.pixel};font-size:12px}
.lb-cell:active{transform:translate(2px,2px)}
.lb-hand{display:flex;gap:6px;flex-wrap:wrap}
.lb-hand .lb-cell{width:72px}
.lb-hand .lb-cell.sel{border-color:${C['brand-d']};box-shadow:0 0 0 3px ${C.brand}}
.lb-close{align-self:flex-end}
.lb-share{display:flex;flex-direction:column;gap:8px}
.lb-share input{font-family:${T.fonts.ui};font-size:calc(${T.scale.body.sizePx}px * var(--lcw-hs,1));padding:10px 12px;border:2px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;background:${C['paper-0']};color:${C['ink-900']};min-height:${S.touchTargetMinPx}px}
.lb-share .out{font-weight:700;font-size:calc(${T.scale.small.sizePx}px * var(--lcw-hs,1));min-height:20px}
.lb-share .out.bad{color:${C['danger-d']}}
.lb-share .link{font-family:${T.fonts.pixel};font-size:12px;word-break:break-all;color:${C['sky-d']}}
.lb-share .lb-row .lb-btn{position:static}
.lb-room{position:absolute;left:50%;top:84px;transform:translate(-50%,-20px);opacity:0;transition:all ${M.baseMs}ms ease-out;max-width:min(560px,calc(100% - 24px));padding:12px 16px;display:flex;flex-direction:column;gap:4px;align-items:center;text-align:center;pointer-events:none}
.lb-room.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}
.lb-room .k{font-size:calc(${T.scale.micro.sizePx}px * var(--lcw-hs,1));font-weight:700;color:${C['brand-d']}}
.lb-room .e{font-family:${T.fonts.target};font-size:calc(${T.scale.h3.sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale.h3.lineHeightPx}px * var(--lcw-hs,1));font-weight:800;color:${C['sky-d']}}
.lb-room .g{font-size:calc(${T.scale.small.sizePx}px * var(--lcw-hs,1));color:${C['ink-700']}}
@media (max-width:600px){.lb-tools{bottom:168px}.lb-grid{grid-template-columns:repeat(auto-fill,minmax(56px,1fr))}}
`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

const blockKeyById = new Map(BLOCK_PALETTE.map((b) => [b.id, b.key] as const));

export function refNameKo(ref: ItemRef): string {
  const what = parseRef(ref);
  if (!what) return '';
  if (what.kind === 'block') return BLOCK_NAMES_KO[blockKeyById.get(what.id) ?? ''] ?? W.blockWord;
  return FURNITURE_NAMES_KO[what.key] ?? W.furnitureWord;
}

/** Icons: a block as a little lit cube from its atlas tiles, furniture as a front view of its toy pieces. */
export class BuildIcons {
  private cache = new Map<string, string>();
  constructor(private readonly atlas: Uint8Array) {}

  private tile(layer: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = TILE_PX;
    c.height = TILE_PX;
    const g = c.getContext('2d');
    if (g) {
      const n = TILE_PX * TILE_PX * 4;
      const img = g.createImageData(TILE_PX, TILE_PX);
      img.data.set(this.atlas.subarray(layer * n, (layer + 1) * n));
      g.putImageData(img, 0, 0);
    }
    return c;
  }

  icon(ref: ItemRef): string {
    const hit = this.cache.get(ref);
    if (hit !== undefined) return hit;
    let url = '';
    try {
      url = this.draw(ref);
    } catch {
      url = '';
    }
    this.cache.set(ref, url);
    return url;
  }

  private draw(ref: ItemRef): string {
    const what = parseRef(ref);
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 48;
    const g = c.getContext('2d');
    if (!g || !what) return '';
    if (what.kind === 'block') {
      const look = blockLook(what.id);
      const top = this.tile(TILE_LAYER[look.top] ?? 0);
      const side = this.tile(TILE_LAYER[look.side] ?? 0);
      // isometric cube: top face, then the two side faces a little darker
      g.save();
      g.setTransform(0.75, 0.375, -0.75, 0.375, 24, 2);
      g.drawImage(top, 0, 0);
      g.restore();
      g.save();
      g.setTransform(0.75, 0.375, 0, 0.75, 0, 14);
      g.drawImage(side, 0, 0);
      g.globalAlpha = 0.18;
      g.fillStyle = C['ink-900'];
      g.fillRect(0, 0, TILE_PX, TILE_PX);
      g.restore();
      g.save();
      g.setTransform(0.75, -0.375, 0, 0.75, 24, 26);
      g.drawImage(side, 0, 0);
      g.globalAlpha = 0.32;
      g.fillStyle = C['ink-900'];
      g.fillRect(0, 0, TILE_PX, TILE_PX);
      g.restore();
      return c.toDataURL();
    }
    // furniture: front view, back pieces first
    const ps = [...furniturePieces(what.key)].sort((a, b) => a.z - b.z);
    let top = 16;
    for (const q of ps) top = Math.max(top, q.y + q.h / 2);
    const k = 44 / Math.max(16, top);
    for (const q of ps) {
      // the piece's own 3D colour (the same one the furniture mesh uses)
      g.fillStyle = `rgb(${(q.color >> 16) & 255},${(q.color >> 8) & 255},${q.color & 255})`;
      g.globalAlpha = 1;
      g.fillRect(2 + (q.x - q.w / 2) * k, 46 - (q.y + q.h / 2) * k, q.w * k, q.h * k);
      g.globalAlpha = 0.55;
      g.strokeStyle = C['ink-900'];
      g.lineWidth = 1;
      g.strokeRect(2 + (q.x - q.w / 2) * k + 0.5, 46 - (q.y + q.h / 2) * k + 0.5, q.w * k - 1, q.h * k - 1);
    }
    return c.toDataURL();
  }
}

export interface BuildHudHandlers {
  onTool(tool: 'place' | 'break'): void;
  onChest(): void;
  onUndo(): void;
  onRotate(): void;
  /** chest cell tapped: take into the selected slot */
  onTake(ref: ItemRef): void;
  /** hand slot tapped in the chest panel: put it back */
  onStore(slot: number): void;
  onCloseChest(): void;
  /** 쇼룸 공개 with this title (linked child only) */
  onShowroom(title: string): Promise<ShowroomResult>;
  /** R326: switch the hotbar between the carried blocks and the bag */
  onBar?(): void;
}

export class BuildHud {
  private tools: HTMLDivElement;
  private placeBtn: HTMLButtonElement;
  private barBtn: HTMLButtonElement;
  private breakBtn: HTMLButtonElement;
  private rotateBtn: HTMLButtonElement;
  private tip: HTMLDivElement;
  private tipTimer = 0;
  private tipKey = '';
  private sync: HTMLDivElement;
  private help: HTMLDivElement;
  private helpTimer = 0;
  private chest: HTMLDivElement;
  private grid: HTMLDivElement;
  private hand: HTMLDivElement;
  private room: HTMLDivElement;
  private roomE: HTMLDivElement;
  private roomG: HTMLDivElement;
  private roomTimer = 0;
  private showroomBtn: HTMLButtonElement;
  private share: HTMLDivElement;
  private shareInput: HTMLInputElement;
  private shareOut: HTMLDivElement;
  private shareLink: HTMLDivElement;
  private shareGo: HTMLButtonElement;
  private shareCopy: HTMLButtonElement;
  chestOpen = false;
  shareOpen = false;
  /** last showroom answer (headless checks) */
  shareState = '';

  constructor(
    root: HTMLElement,
    private readonly icons: BuildIcons,
    private readonly h: BuildHudHandlers,
    private readonly touch: boolean
  ) {
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = css();
      document.head.appendChild(st);
    }
    const stop = (e: Event): void => e.stopPropagation();
    this.tools = el('div', 'lb-tools', root);
    const row1 = el('div', 'lb-row', this.tools);
    this.placeBtn = this.button(row1, 'lb-btn sel', W.toolPlace, () => h.onTool('place'));
    this.breakBtn = this.button(row1, 'lb-btn brk', W.toolBreak, () => h.onTool('break'));
    if (!touch) {
      // mouse: right click places, holding left breaks; the toggles stay for anyone who prefers them
      this.placeBtn.classList.add('off');
      this.breakBtn.classList.add('off');
    }
    const row2 = el('div', 'lb-row', this.tools);
    this.rotateBtn = this.button(row2, 'lb-btn off', W.rotate, () => h.onRotate());
    this.button(row2, 'lb-btn', W.undo, () => h.onUndo());
    this.button(row2, 'lb-btn', W.chest, () => h.onChest());
    const row3 = el('div', 'lb-row', this.tools);
    // R326: the hotbar holds the carried blocks or the bag (food, errand things); this flips it, the label names the other
    this.barBtn = this.button(row3, 'lb-btn', W.barBag, () => h.onBar?.());
    this.showroomBtn = this.button(row3, 'lb-btn off', W.showroomBtn, () => this.openShare());

    this.tip = el('div', 'lb-tip', root);
    this.sync = el('div', 'lb-sync', root);
    this.help = el('div', 'lb-help', root);

    this.chest = el('div', 'lb-chest', root);
    this.chest.addEventListener('pointerdown', (e) => {
      stop(e);
      if (e.target === this.chest) h.onCloseChest();
    });
    const panel = el('div', 'lb-panel lw-card', this.chest);
    el('h2', '', panel).textContent = W.chestTitle;
    el('p', '', panel).textContent = W.chestHint;
    el('div', '', panel).textContent = W.chestHand;
    this.hand = el('div', 'lb-hand', panel);
    this.grid = el('div', 'lb-grid', panel);
    const close = this.button(panel, 'lb-btn lb-close', W.close, () => h.onCloseChest());
    close.style.position = 'static';

    // 쇼룸 공개 card
    this.share = el('div', 'lb-chest', root);
    this.share.addEventListener('pointerdown', (e) => {
      stop(e);
      if (e.target === this.share) this.closeShare();
    });
    const sp = el('div', 'lb-panel lw-card lb-share', this.share);
    el('h2', '', sp).textContent = W.showroomTitle;
    el('p', '', sp).textContent = W.showroomHint;
    const lab = el('label', '', sp);
    lab.textContent = W.showroomName;
    this.shareInput = el('input', '', sp);
    this.shareInput.maxLength = 40;
    this.shareInput.value = SHOWROOM_DEFAULT_TITLE;
    this.shareInput.addEventListener('pointerdown', stop);
    this.shareOut = el('div', 'out', sp);
    this.shareLink = el('div', 'link', sp);
    const srow = el('div', 'lb-row', sp);
    this.shareGo = this.button(srow, 'lb-btn sel', W.showroomGo, () => void this.publish());
    this.shareCopy = this.button(srow, 'lb-btn off', W.showroomCopy, () => {
      const url = this.shareLink.textContent ?? '';
      void navigator.clipboard?.writeText(url).then(
        () => (this.shareOut.textContent = W.showroomCopied),
        () => undefined
      );
    });
    this.button(srow, 'lb-btn', W.close, () => this.closeShare());

    this.room = el('div', 'lb-room lw-card', root);
    el('div', 'k', this.room).textContent = W.roomTitle;
    this.roomE = el('div', 'e', this.room);
    this.roomE.lang = 'en';
    this.roomG = el('div', 'g', this.room);
    this.room.addEventListener('pointerdown', (e) => {
      stop(e);
      this.room.classList.remove('on');
    });
  }

  private button(parent: HTMLElement, cls: string, label: string, on: () => void): HTMLButtonElement {
    const b = el('button', cls, parent);
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      on();
    });
    // keyboard users (Enter/Space on a focused button)
    b.addEventListener('click', (e) => {
      if ((e as MouseEvent).detail === 0) on();
    });
    return b;
  }

  setActive(on: boolean, helpText: string): void {
    this.tools.classList.toggle('on', on);
    if (!on) {
      this.tip.classList.remove('on');
      this.sync.classList.remove('on');
      this.help.classList.remove('on');
      this.room.classList.remove('on');
      return;
    }
    this.help.textContent = helpText;
    this.help.classList.add('on');
    window.clearTimeout(this.helpTimer);
    this.helpTimer = window.setTimeout(() => this.help.classList.remove('on'), 9000);
  }

  /** 쇼룸 공개 only for a linked child whose plot is saved. */
  setShowroomVisible(on: boolean): void {
    this.showroomBtn.classList.toggle('off', !on);
    if (!on) this.closeShare();
  }

  openShare(): void {
    this.shareOpen = true;
    this.share.classList.add('on');
    this.shareOut.textContent = '';
    this.shareOut.classList.remove('bad');
  }

  closeShare(): void {
    this.shareOpen = false;
    this.share.classList.remove('on');
  }

  private async publish(): Promise<void> {
    const title = this.shareInput.value.trim() || SHOWROOM_DEFAULT_TITLE;
    this.shareGo.disabled = true;
    this.shareOut.classList.remove('bad');
    this.shareOut.textContent = W.showroomBusyNow;
    let r: ShowroomResult;
    try {
      r = await this.h.onShowroom(title);
    } catch {
      r = { ok: false, reason: 'server' };
    }
    this.shareGo.disabled = false;
    if (r.ok) {
      this.shareState = 'ok';
      this.shareOut.textContent = W.showroomDone;
      this.shareLink.textContent = `${location.origin}${r.path}`;
      this.shareCopy.classList.remove('off');
    } else {
      this.shareState = r.reason;
      this.shareOut.textContent = SHOWROOM_REASONS_KO[r.reason] ?? SHOWROOM_REASONS_KO.server!;
      this.shareOut.classList.add('bad');
      if (r.reason === 'seat') this.closeShare();
    }
  }

  setTool(tool: 'place' | 'break'): void {
    this.placeBtn.classList.toggle('sel', tool === 'place');
    this.breakBtn.classList.toggle('sel', tool === 'break');
  }

  /** R326: which bar the hotbar shows now (the button offers the other one). */
  setBar(blocks: boolean): void {
    this.barBtn.textContent = blocks ? W.barBag : W.barBlocks;
    this.barBtn.classList.toggle('sel', !blocks);
  }

  setRotateVisible(on: boolean): void {
    this.rotateBtn.classList.toggle('off', !on);
  }

  /** The reason next to a refused edit (red) or a short note; repeats of the same text only extend it. */
  say(reasonOrText: string, bad = true): void {
    const text = BUILD_REASONS_KO[reasonOrText] ?? reasonOrText;
    this.tip.textContent = text;
    this.tip.classList.toggle('bad', bad);
    this.tip.classList.add('on');
    this.tipKey = text;
    window.clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => {
      this.tip.classList.remove('on');
      this.tipKey = '';
    }, 1800);
  }

  get tipText(): string {
    return this.tipKey;
  }

  setSync(s: SyncStatus | 'local' | 'loading'): void {
    const text = s === 'saved' ? W.syncSaved : s === 'saving' ? W.syncSaving : s === 'offline' ? W.syncOffline : s === 'local' ? W.syncLocal : s === 'loading' ? W.syncLoading : '';
    this.sync.textContent = text;
    this.sync.classList.toggle('on', text !== '' && this.tools.classList.contains('on'));
    this.sync.classList.toggle('warn', s === 'offline' || s === 'local');
  }

  showRoom(r: RoomCheckEvent): void {
    this.roomE.textContent = r.sentence;
    const need = r.structure[0] ?? r.missing[0] ?? (r.resident ? 'resident' : 'ok');
    // the Korean gloss under the English room sentence is the Korean help (off unless turned on, world/lang.ts)
    this.roomG.textContent = helpKoOn() ? (ROOM_GLOSS_KO[need] ?? '') : '';
    this.room.classList.add('on');
    window.clearTimeout(this.roomTimer);
    this.roomTimer = window.setTimeout(() => this.room.classList.remove('on'), 7000);
  }

  get roomText(): string {
    return this.room.classList.contains('on') ? this.roomE.textContent ?? '' : '';
  }

  openChest(inv: PlotInventory, selected: number): void {
    this.chestOpen = true;
    this.chest.classList.add('on');
    this.renderChest(inv, selected);
  }

  closeChest(): void {
    this.chestOpen = false;
    this.chest.classList.remove('on');
  }

  renderChest(inv: PlotInventory, selected: number): void {
    if (!this.chestOpen) return;
    this.hand.innerHTML = '';
    inv.slots.forEach((s, i) => {
      const cell = el('div', `lb-cell${i === selected ? ' sel' : ''}`, this.hand);
      if (s) {
        const img = el('img', '', cell);
        img.src = this.icons.icon(s.ref);
        img.alt = '';
        el('span', 'n', cell).textContent = String(s.n);
        el('span', '', cell).textContent = W.chestStore;
      } else el('span', '', cell).textContent = String(i + 1);
      cell.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        if (s) this.h.onStore(i);
      });
    });
    this.grid.innerHTML = '';
    const order: ItemRef[] = [
      ...BUILD_PALETTE.map((id) => `b${id}` as ItemRef),
      ...FURNITURE_REGISTRY.map((f) => `f${f.id}` as ItemRef)
    ];
    let any = false;
    for (const ref of order) {
      const n = inv.chest[ref] ?? 0;
      if (n <= 0) continue;
      any = true;
      const cell = el('div', 'lb-cell', this.grid);
      const img = el('img', '', cell);
      img.src = this.icons.icon(ref);
      img.alt = '';
      el('span', 'n', cell).textContent = String(n);
      el('span', '', cell).textContent = refNameKo(ref);
      cell.title = refNameKo(ref);
      cell.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.h.onTake(ref);
      });
    }
    if (!any) el('p', '', this.grid).textContent = W.chestEmpty;
  }

  dispose(): void {
    window.clearTimeout(this.tipTimer);
    window.clearTimeout(this.helpTimer);
    window.clearTimeout(this.roomTimer);
    this.tools.remove();
    this.tip.remove();
    this.sync.remove();
    this.help.remove();
    this.chest.remove();
    this.share.remove();
    this.room.remove();
  }
}
