import { ADVENTURE_CHAPTERS, adventureChapter } from '@lcw/content';
import { TYPOGRAPHY_TOKENS } from '@lcw/ui';
import { ADV } from './core/tuning.js';
import { ARENA_TOP, currentWord, type Bullet } from './core/bullets.js';
import { PAL, type PalKey } from './art/palette.js';
import { paintChest, paintCreature, paintGate, paintKeeper, paintMerchant, paintPost, paintSoul, paintStone, paintVillager } from './art/sprites.js';
import { paintIsland } from './art/tiles.js';
import type { Engine } from './engine.js';
import { S } from './ui/strings.js';
import { maxHp } from './core/run.js';

/** Draws one frame of the logical 320×240 screen (scaled by an integer `scale`, smoothing off). */

const W = ADV.screen.w;
const H = ADV.screen.h;
const PIXEL_FONT = TYPOGRAPHY_TOKENS.fonts.pixel;

type Img = HTMLCanvasElement;
const sprites = new Map<string, Img>();
function sprite(key: string, make: () => { toCanvas(): Img }): Img {
  let s = sprites.get(key);
  if (!s) {
    s = make().toCanvas();
    sprites.set(key, s);
  }
  return s;
}

let islandImg: { ch: number; img: Img } | null = null;

/** docs/08 MOTION_TOKENS: with reduced motion asked for, no screen shake and no fades (the picture just changes). */
function reducedMotion(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export class Renderer {
  scale = 1;
  constructor(
    private readonly cv: HTMLCanvasElement,
    private readonly ctx: CanvasRenderingContext2D
  ) {}

  resize(cssW: number, cssH: number) {
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const s = Math.max(1, Math.min(4, Math.round((cssW / W) * dpr)));
    if (s !== this.scale || this.cv.width !== W * s) {
      this.scale = s;
      this.cv.width = W * s;
      this.cv.height = H * s;
    }
    void cssH;
  }

  draw(e: Engine) {
    const c = this.ctx;
    c.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    c.imageSmoothingEnabled = false;
    if (e.scene === 'title' || e.scene === 'parent') this.title(e);
    else if (e.scene === 'story') this.story(e);
    else if (e.scene === 'down') this.down(e);
    else if (e.scene === 'explore') this.explore(e);
    else if (e.scene === 'battle') this.battle(e);
    else if (e.scene === 'end') this.end(e);
    if (e.fade > 0 && !reducedMotion()) {
      c.globalAlpha = Math.min(1, e.fade);
      c.fillStyle = PAL.night;
      c.fillRect(0, 0, W, H);
      c.globalAlpha = 1;
    }
  }

  private text(s: string, x: number, y: number, color: string, size = 11, align: CanvasTextAlign = 'left') {
    const c = this.ctx;
    c.font = `${size}px ${PIXEL_FONT}`;
    c.textAlign = align;
    c.textBaseline = 'middle';
    c.fillStyle = color;
    c.fillText(s, x, y);
  }

  private img(i: Img, x: number, y: number, scale = 1, flip = false) {
    const c = this.ctx;
    if (flip) {
      c.save();
      c.translate(Math.round(x) + i.width * scale, Math.round(y));
      c.scale(-1, 1);
      c.drawImage(i, 0, 0, i.width * scale, i.height * scale);
      c.restore();
    } else c.drawImage(i, Math.round(x), Math.round(y), i.width * scale, i.height * scale);
  }

  // ---------- title: the four isles on the sea ----------
  private title(e: Engine) {
    const c = this.ctx;
    c.fillStyle = PAL.seaD;
    c.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 12)
      for (let x = (y / 12) % 2 ? 6 : 0; x < W; x += 24) {
        const wob = Math.sin(e.t * 1.5 + x * 0.1 + y) * 2;
        c.fillStyle = PAL.sea;
        c.fillRect(x + wob, y + 6, 8, 1);
      }
    const spots: Array<[number, number, PalKey, PalKey]> = [
      [62, 150, 'moss', 'mossD'],
      [128, 92, 'sand', 'sandD'],
      [204, 148, 'bread', 'breadD'],
      [262, 70, 'night2', 'grape']
    ];
    const snap = e.getSnapshot();
    ADVENTURE_CHAPTERS.forEach((ch, i) => {
      const [x, y, a, b] = spots[i]!;
      const st = snap.islands[i]!.state;
      const locked = st === 'previous';
      c.globalAlpha = locked ? 0.45 : 1;
      c.fillStyle = PAL[b];
      c.beginPath();
      c.ellipse(x, y + 4, 30, 15, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = PAL[a];
      c.beginPath();
      c.ellipse(x, y, 28, 13, 0, 0, Math.PI * 2);
      c.fill();
      // a landmark per isle
      if (i === 0) {
        c.fillStyle = PAL.mossD;
        for (const dx of [-12, 0, 12]) c.fillRect(x + dx - 3, y - 14, 7, 12);
        c.fillStyle = PAL.sun;
        c.fillRect(x - 1, y - 18, 3, 3);
      } else if (i === 1) {
        c.fillStyle = PAL.skyD;
        c.fillRect(x - 8, y - 12, 16, 8);
        c.fillStyle = PAL.brand;
        c.fillRect(x - 10, y - 6, 20, 4);
      } else if (i === 2) {
        c.fillStyle = PAL.brick;
        c.fillRect(x - 10, y - 16, 20, 14);
        c.fillStyle = PAL.sun;
        c.fillRect(x - 4, y - 10, 8, 6);
      } else {
        c.fillStyle = PAL.stone;
        c.fillRect(x - 5, y - 40, 10, 38);
        c.fillStyle = PAL.glow;
        c.fillRect(x - 2, y - 44, 4, 4);
      }
      c.globalAlpha = 1;
      if (snap.selected === ch.id) {
        const bob = Math.sin(e.t * 4) * 2;
        this.img(sprite('keeper-0-0', () => paintKeeper(0, 0)), x - 8, y - 42 + bob - (i === 3 ? 20 : 0));
      }
      if (st === 'cleared') this.text('★'.repeat(Math.max(1, snap.islands[i]!.stars)), x, y + 24, PAL.sun, 10, 'center');
      if (locked) this.text('🔒', x, y, PAL.white, 12, 'center');
    });
    this.text('The Hushwind Isles', W / 2, 18, PAL.cream, 14, 'center');
  }

  // ---------- explore ----------
  private explore(e: Engine) {
    const isl = e.island;
    if (!isl) return;
    const c = this.ctx;
    if (!islandImg || islandImg.ch !== e.chapter) islandImg = { ch: e.chapter, img: paintIsland(isl).toCanvas() };
    const cam = Math.round(e.camX);
    c.drawImage(islandImg.img, cam, 0, W, H, 0, 0, W, H);
    // water shimmer
    if (isl.theme === 'shore') {
      c.fillStyle = PAL.foam;
      for (let i = 0; i < 14; i++) {
        const x = ((i * 53 + e.t * 12) % (isl.w * 16)) - cam;
        if (x > -4 && x < W) c.fillRect(x, 168 + ((i * 7) % 18), 4, 1);
      }
    }
    const items: Array<{ y: number; draw: () => void }> = [];
    for (const es of e.entities) {
      if (es.state === 'gone') continue;
      const x = es.x - cam;
      if (x < -40 || x > W + 40) continue;
      items.push({
        y: es.y,
        draw: () => {
          const kind = es.e.kind;
          if (kind === 'villager') this.img(sprite(`villager-${e.chapter}`, () => paintVillager(e.chapter)), x - 8, es.y - 18);
          else if (kind === 'stone') {
            const lit = es.talked > 0;
            this.img(sprite(`stone-${lit}`, () => paintStone(lit)), x - 8, es.y - 16);
            if (!lit && Math.floor(e.t * 2) % 2) {
              c.fillStyle = PAL.glow;
              c.fillRect(x - 1, es.y - 22, 2, 3);
            }
          } else if (kind === 'chest') {
            const open = es.state === 'open';
            this.img(sprite(`chest-${open}`, () => paintChest(open)), x - 8, es.y - 14);
            if (!open && Math.floor(e.t * 3) % 3 === 0) {
              c.fillStyle = PAL.glow;
              c.fillRect(x + 5, es.y - 16, 2, 2);
            }
          } else if (kind === 'post') {
            const lit = e.run.post?.chapter === e.chapter && e.run.post.id === es.e.id;
            this.img(sprite(`post-${lit}`, () => paintPost(lit)), x - 8, es.y - 24);
          } else if (kind === 'merchant') this.img(sprite('merchant', paintMerchant), x - 8, es.y - 20);
          else if (kind === 'gate') this.img(sprite('gate', paintGate), x - 24, es.y - 46);
          else {
            const plan = e.plan;
            if (!plan) return;
            const cr = kind === 'guardian' ? plan.chapter.guardian : plan.chapter.critters[es.e.index]!;
            const happy = es.state === 'friend';
            const s = sprite(`cr-${cr.sprite}-${happy}`, () => paintCreature(cr.sprite, happy));
            const bob = Math.round(Math.sin(e.t * 3 + es.e.tx) * 1.5);
            c.fillStyle = PAL.shadow;
            c.fillRect(x - s.width / 3, es.y - 2, (s.width * 2) / 3, 3);
            this.img(s, x - s.width / 2, es.y - s.height + bob);
            if (!happy && kind === 'critter') this.text('!', x, es.y - s.height - 6 + bob, PAL.sun, 10, 'center');
          }
        }
      });
    }
    const p = e.player;
    items.push({
      y: p.y,
      draw: () => {
        const s = sprite(`keeper-${p.dir}-${p.frame}`, () => paintKeeper(p.dir, p.frame));
        c.fillStyle = PAL.shadow;
        c.fillRect(p.x - cam - 5, p.y - 2, 10, 3);
        this.img(s, p.x - cam - 8, p.y - 18, 1, p.flip);
      }
    });
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();
    if (e.walkTo) {
      c.strokeStyle = PAL.cream;
      c.strokeRect(Math.round(e.walkTo.x - cam) - 2, Math.round(e.walkTo.y) - 2, 4, 4);
    }
    this.text(adventureChapter(e.chapter).islandEn, 6, 10, PAL.cream, 10);
    this.hud(e);
  }

  // ---------- battle ----------
  private battle(e: Engine) {
    const b = e.battle;
    if (!b) return;
    const c = this.ctx;
    const shake = b.shake > 0 && !reducedMotion() ? Math.round(Math.sin(e.t * 70) * ADV.shakePx) : 0;
    c.fillStyle = PAL.night;
    c.fillRect(0, 0, W, H);
    // backdrop: soft stripes in the island's colours
    const theme = (['mossD', 'seaD', 'breadD', 'grapeD'] as const)[e.chapter - 1]!;
    c.globalAlpha = 0.35;
    c.fillStyle = PAL[theme];
    for (let i = 0; i < 8; i++) {
      const y = 8 + i * 13 + Math.sin(e.t + i) * 2;
      c.fillRect(0, y, W, 5);
    }
    c.globalAlpha = 1;
    const cr = b.enc.creature;
    const happy = b.outcome === 'spared' || (b.phase === 'end' && b.outcome !== 'fought');
    const s = sprite(`cr-${cr.sprite}-${happy}`, () => paintCreature(cr.sprite, happy));
    const scale = 2;
    const bob = Math.round(Math.sin(e.t * 2.4) * 2);
    const sx = W / 2 - (s.width * scale) / 2 + shake;
    const sy = 100 - s.height * scale + bob;
    if (b.phase !== 'end' || b.outcome !== 'fought') this.img(s, sx, sy, scale);
    // POKE ring around the islander
    if (b.phase === 'poke') {
      const cx = W / 2;
      const cy = 100 - (s.height * scale) / 2;
      c.strokeStyle = PAL.sun;
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(cx, cy, 8 + b.ring * 48, 0, Math.PI * 2);
      c.stroke();
      c.strokeStyle = PAL.brand;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(cx, cy, 8 + 0.25 * 48, 0, Math.PI * 2);
      c.stroke();
      c.lineWidth = 1;
    }
    // the notebook page
    const ps = b.pattern;
    const a = ps ? ps.arena : { x: 16, y: ARENA_TOP, w: W - 32, h: 72 };
    c.fillStyle = PAL.cream;
    c.fillRect(a.x - 2, a.y - 2, a.w + 4, a.h + 4);
    c.fillStyle = PAL.paper;
    c.fillRect(a.x, a.y, a.w, a.h);
    c.fillStyle = PAL.line;
    for (let y = a.y + 9; y < a.y + a.h; y += 10) c.fillRect(a.x, y, a.w, 1);
    c.fillStyle = PAL.pink;
    c.fillRect(a.x + 10, a.y, 1, a.h);
    c.strokeStyle = PAL.ink;
    c.lineWidth = 2;
    c.strokeRect(a.x - 1, a.y - 1, a.w + 2, a.h + 2);
    c.lineWidth = 1;
    if (ps) {
      c.save();
      c.beginPath();
      c.rect(a.x, a.y, a.w, a.h);
      c.clip();
      for (const bl of ps.bullets) if (bl.alive) this.bullet(bl, e.help);
      // the soul
      // after a hit the bubble blinks at most ADV.hitBlinkHz times a second (docs/08: no more than 3 flashes a second)
      const blink = b.invuln > 0 && Math.floor(e.t * 2 * ADV.hitBlinkHz) % 2 === 0;
      if (!blink) this.img(sprite('soul', paintSoul), b.soul.x - 5, b.soul.y - 5);
      c.restore();
      // word guide above the page
      if (ps.id === 'letterCatch') {
        const w = currentWord(ps).w.replace(/[^a-z]/g, '');
        const shown = [...w].map((ch, i) => (i < ps.letterIdx ? ch : i === ps.letterIdx && e.help ? '?' : '_')).join(' ');
        this.text(`${currentWord(ps).emoji} ${shown}`, W / 2, a.y - 9, PAL.cream, 11, 'center');
      } else if (ps.id === 'spellBubbles') {
        const wc = currentWord(ps);
        this.text(`${wc.emoji} ${S.catchSpelling.en}${e.help && wc.ko ? ` · ${wc.ko}` : ''}`, W / 2, a.y - 9, PAL.cream, 10, 'center');
      } else if (ps.id === 'wordCookies' && ps.prompt) {
        this.text(`${S.catchPrompt.en} ${ps.prompt.emoji}${e.help && ps.prompt.ko ? ` ${ps.prompt.ko}` : ''}`, W / 2, a.y - 9, PAL.cream, 11, 'center');
      }
    }
    // bars
    const by = Math.min(a.y + a.h + 9, H - 7); // the bars never leave the screen
    this.bar(W / 2 - 112, by, 100, b.hp / b.hpMax, b.hp / b.hpMax > 0.3 ? PAL.sun : PAL.danger, S.voiceLabel.en);
    // the number sits left of the bar (above it, it ran into the dodge page's frame)
    this.text(`${b.hp}/${b.hpMax}`, W / 2 - 116, by, PAL.cream, 8, 'right');
    this.bar(W / 2 + 12, by, 100, b.progressFrac, b.spareReady ? PAL.leaf : PAL.pink, b.spareReady ? `${S.calmLabel.en} ✓` : S.calmLabel.en);
    // a guardian's stage pips (it grows fiercer as it calms)
    if (b.stageCount > 1)
      for (let i = 0; i < b.stageCount; i++) {
        c.fillStyle = i <= b.stage ? PAL.danger : PAL.night2;
        c.fillRect(W / 2 - (b.stageCount * 8) / 2 + i * 8, 6, 6, 4);
      }
    if (b.flash > 0) {
      c.globalAlpha = Math.min(0.25, b.flash);
      c.fillStyle = PAL.danger;
      c.fillRect(a.x, a.y, a.w, a.h);
      c.globalAlpha = 1;
    }
  }

  private bar(x: number, y: number, w: number, f: number, color: string, label: string) {
    const c = this.ctx;
    this.text(label, x, y, PAL.cream, 9);
    const bx = x + 40;
    const bw = w - 40;
    c.fillStyle = PAL.night2;
    c.fillRect(bx, y - 3, bw, 6);
    c.fillStyle = color;
    c.fillRect(bx, y - 3, Math.round(bw * Math.max(0, Math.min(1, f))), 6);
    c.strokeStyle = PAL.cream;
    c.strokeRect(bx - 0.5, y - 3.5, bw + 1, 7);
  }

  private bullet(b: Bullet, help: boolean) {
    const c = this.ctx;
    const x = b.x;
    const y = b.y;
    switch (b.sprite) {
      case 'acorn':
        c.fillStyle = PAL.bark;
        c.fillRect(x - 3, y - 2, 6, 5);
        c.fillStyle = PAL.barkD;
        c.fillRect(x - 3, y - 3, 6, 2);
        break;
      case 'leaf':
        c.fillStyle = PAL.leaf;
        c.fillRect(x - 3, y - 1, 6, 3);
        c.fillStyle = PAL.leafD;
        c.fillRect(x - 1, y - 2, 2, 5);
        break;
      case 'letter':
      case 'bubble':
      case 'cookie': {
        if (b.text) {
          const good = b.role === 'good';
          c.fillStyle = b.sprite === 'cookie' ? PAL.bread : b.sprite === 'bubble' ? PAL.foam : PAL.white;
          c.beginPath();
          c.ellipse(x, y, b.r, b.sprite === 'letter' ? b.r : 7, 0, 0, Math.PI * 2);
          c.fill();
          c.strokeStyle = b.sprite === 'letter' && good && help ? PAL.leafD : PAL.ink;
          c.lineWidth = b.sprite === 'letter' && good && help ? 2 : 1;
          c.stroke();
          c.lineWidth = 1;
          this.text(b.text, x, y + 0.5, PAL.ink, b.sprite === 'letter' ? 11 : 9, 'center');
        } else {
          c.strokeStyle = PAL.sky;
          c.beginPath();
          c.arc(x, y, b.r, 0, Math.PI * 2);
          c.stroke();
        }
        break;
      }
      case 'shell':
        c.fillStyle = PAL.pink;
        c.beginPath();
        c.arc(x, y, 4, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = PAL.pinkD;
        c.fillRect(x - 1, y - 3, 2, 6);
        break;
      case 'roll':
        c.fillStyle = PAL.bread;
        c.beginPath();
        c.ellipse(x, y, 5, 4, 0, 0, Math.PI * 2);
        c.fill();
        c.fillStyle = PAL.breadD;
        c.fillRect(x - 3, y - 1, 6, 1);
        break;
      case 'sprinkle':
        c.fillStyle = [PAL.pink, PAL.sky, PAL.sun, PAL.leaf][Math.floor(b.ph * 10) % 4]!;
        c.fillRect(x - 1, y - 2, 2, 4);
        break;
      case 'comma':
        c.fillStyle = PAL.fog;
        c.fillRect(x - 2, y - 2, 4, 4);
        c.fillStyle = PAL.fogD;
        c.fillRect(x, y + 1, 2, 3);
        break;
      case 'ink':
        c.fillStyle = PAL.grapeD;
        c.beginPath();
        c.arc(x, y, b.r, 0, Math.PI * 2);
        c.fill();
        break;
      case 'kite':
        c.fillStyle = b.wait > 0 ? PAL.sun : PAL.white;
        c.beginPath();
        c.moveTo(x, y - 5);
        c.lineTo(x + 4, y);
        c.lineTo(x, y + 5);
        c.lineTo(x - 4, y);
        c.closePath();
        c.fill();
        c.strokeStyle = PAL.ink;
        c.stroke();
        break;
      default:
        c.fillStyle = PAL.white;
        c.beginPath();
        c.arc(x, y, b.r, 0, Math.PI * 2);
        c.fill();
    }
  }

  // ---------- story pages: the opening, the boat, the ending ----------
  private story(e: Engine) {
    const c = this.ctx;
    const st = e.story;
    const kind = st?.kind ?? 'prologue';
    c.fillStyle = kind === 'ending' || kind === 'credits' ? PAL.night2 : PAL.seaD;
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 30; i++) {
      const x = (i * 41 + e.t * (4 + (i % 3) * 3)) % W;
      const y = (i * 17) % 120;
      c.fillStyle = i % 3 ? PAL.cream : PAL.glow;
      c.fillRect(x, y, 1, 1);
    }
    c.fillStyle = PAL.sea;
    c.fillRect(0, 150, W, H - 150);
    for (let x = 0; x < W; x += 16) {
      c.fillStyle = PAL.foam;
      c.fillRect(x + Math.sin(e.t * 2 + x) * 3, 152 + ((x / 16) % 3) * 8, 8, 1);
    }
    // the little boat (on the sail pages it crosses the sea)
    const page = st ? (st.i + 1) / st.lines.length : 0;
    const bx = kind === 'sail' ? 30 + page * (W - 90) : W / 2 - 24;
    const by = 140 + Math.sin(e.t * 2) * 2;
    c.fillStyle = PAL.bark;
    c.fillRect(bx, by, 48, 8);
    c.fillStyle = PAL.barkD;
    c.fillRect(bx + 4, by + 8, 40, 3);
    c.fillStyle = PAL.cream;
    c.beginPath();
    c.moveTo(bx + 24, by - 34);
    c.lineTo(bx + 24, by - 2);
    c.lineTo(bx + 44, by - 4);
    c.closePath();
    c.fill();
    this.img(sprite('keeper-2-0', () => paintKeeper(2, 0)), bx + 6, by - 16);
    if (kind === 'ending' || kind === 'credits') {
      ADVENTURE_CHAPTERS.forEach((ch, i) => {
        const cr = ch.guardian;
        const s = sprite(`cr-${cr.sprite}-true`, () => paintCreature(cr.sprite, true));
        const bob = Math.round(Math.abs(Math.sin(e.t * 3 + i)) * -4);
        this.img(s, 20 + i * 76, 100 - s.height + bob);
      });
    }
    this.text(kind === 'credits' ? S.theEnd.en : kind === 'ending' ? S.endingTitle.en : S.title.en, W / 2, 18, PAL.cream, 13, 'center');
  }

  // ---------- out of voice: the world goes dark, one warm light ----------
  private down(e: Engine) {
    const c = this.ctx;
    c.fillStyle = PAL.night;
    c.fillRect(0, 0, W, H);
    const r = 20 + Math.sin(e.t * 2) * 4;
    c.fillStyle = PAL.glow;
    c.globalAlpha = 0.25;
    c.beginPath();
    c.arc(W / 2, 110, r * 2, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    this.img(sprite('post-true', () => paintPost(true)), W / 2 - 16, 70, 2);
    this.img(sprite('keeper-0-0', () => paintKeeper(0, 0)), W / 2 - 8, 140);
    this.text(S.downTitle.en, W / 2, 30, PAL.cream, 13, 'center');
  }

  /** Voice and coins on the island (R2734: the trip's voice carries from meeting to meeting). */
  private hud(e: Engine) {
    const c = this.ctx;
    const max = maxHp(e.run);
    c.fillStyle = PAL.night;
    c.globalAlpha = 0.6;
    c.fillRect(W - 128, 2, 126, 16);
    c.globalAlpha = 1;
    this.bar(W - 124, 10, 82, e.run.hp / max, e.run.hp / max > 0.3 ? PAL.leaf : PAL.sun, S.voiceLabel.en);
    this.text(`${e.run.hp}`, W - 40, 10, PAL.cream, 9);
    this.text(`● ${e.run.coins}`, W - 26, 10, PAL.sun, 9);
  }

  // ---------- end: new friends ----------
  private end(e: Engine) {
    const c = this.ctx;
    c.fillStyle = PAL.night2;
    c.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) {
      const x = (i * 37 + e.t * (10 + (i % 5) * 6)) % W;
      const y = (i * 23 + e.t * (20 + (i % 3) * 10)) % H;
      c.fillStyle = [PAL.sun, PAL.pink, PAL.sky, PAL.leaf][i % 4]!;
      c.fillRect(x, y, 2, 2);
    }
    const ch = adventureChapter(e.chapter);
    const list = [...ch.critters, ch.guardian];
    const end = e.end;
    list.forEach((cr, i) => {
      const friend = end?.friends.includes(cr.nameEn);
      const s = sprite(`cr-${cr.sprite}-${friend}`, () => paintCreature(cr.sprite, Boolean(friend)));
      const x = 60 + i * 100 - s.width;
      const bob = friend ? Math.round(Math.abs(Math.sin(e.t * 4 + i)) * -6) : 0;
      c.globalAlpha = friend ? 1 : 0.35;
      this.img(s, x, 120 - s.height * 2 + bob, 2);
      c.globalAlpha = 1;
    });
    this.img(sprite('keeper-0-0', () => paintKeeper(0, 0)), W / 2 - 16, 150, 2);
    this.text(ch.outro.en.length > 44 ? `${ch.outro.en.slice(0, 44)}…` : ch.outro.en, W / 2, 20, PAL.cream, 10, 'center');
    if (end) this.text('★'.repeat(end.activity.stars) + '☆'.repeat(3 - end.activity.stars), W / 2, 214, PAL.sun, 16, 'center');
  }
}
