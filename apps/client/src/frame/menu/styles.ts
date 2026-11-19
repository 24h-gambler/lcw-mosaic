import { COLOR_TOKENS, MOTION_TOKENS, SHAPE_TOKENS, TYPOGRAPHY_TOKENS } from '@lcw/ui';

/**
 * Player menu styles (docs/08 8.6). Tokens only, exposed as CSS variables; sizes scale with --fs (text size setting,
 * 100~150%, docs/08 11장). Desktop: a centred window with tabs on top. Phone portrait: full-screen sheet. Phone
 * landscape (short screens): tabs become a left rail so the panel keeps its height.
 */
const vars = Object.entries(COLOR_TOKENS)
  .map(([k, v]) => `--c-${k}:${v};`)
  .join('');
const t = TYPOGRAPHY_TOKENS.scale;
const px = (n: number): string => `calc(${n}px * var(--fs))`;
const S = SHAPE_TOKENS;

export const MENU_STYLE_ID = 'lcw-frame-menu-style';

export const MENU_CSS = `
.lcw-menu{${vars}--fs:var(--lcw-fs,1);--shadow:${S.shadowDefault};position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;
  padding:24px;box-sizing:border-box;font-family:${TYPOGRAPHY_TOKENS.fonts.ui};color:var(--c-ink-900);
  background:color-mix(in srgb, var(--c-night-900) 55%, transparent);-webkit-tap-highlight-color:transparent;touch-action:auto}
.lcw-menu *{box-sizing:border-box}
.lcw-menu button{font-family:inherit;color:inherit}
.lcw-menu :focus-visible{outline:${S.focusOutlineWidthPx}px solid var(--c-sky-d);outline-offset:2px}
.lcw-menu__win{width:min(1040px,100%);height:min(680px,100%);display:flex;flex-direction:column;background:var(--c-paper-50);
  border:${S.borderWidthPx}px solid var(--c-ink-900);border-radius:${S.radiusCardPx * 2}px;box-shadow:var(--shadow);overflow:hidden;
  animation:lcwMenuIn ${MOTION_TOKENS.slowMs}ms cubic-bezier(.2,.9,.3,1.2)}
@keyframes lcwMenuIn{from{transform:translateY(16px);opacity:0}to{transform:none;opacity:1}}
.lcw-menu__top{display:flex;align-items:stretch;gap:4px;padding:8px 8px 0;border-bottom:${S.borderWidthPx}px solid var(--c-ink-900);background:var(--c-paper-100)}
.lcw-menu__tabs{display:flex;gap:4px;flex:1;min-width:0;overflow-x:auto;scrollbar-width:none}
.lcw-menu__tabs::-webkit-scrollbar{display:none}
.lcw-menu__tab{flex:none;display:flex;align-items:center;gap:6px;min-height:${S.touchTargetMinPx}px;padding:6px 14px;border:${S.borderWidthPx}px solid transparent;border-bottom:none;
  border-radius:${S.radiusCardPx}px ${S.radiusCardPx}px 0 0;background:transparent;font-weight:700;font-size:${px(t.body.sizePx)};cursor:pointer;color:var(--c-ink-700)}
.lcw-menu__tab[aria-selected="true"]{background:var(--c-paper-50);border-color:var(--c-ink-900);color:var(--c-ink-900);margin-bottom:-${S.borderWidthPx}px}
.lcw-menu__tab .ic{font-size:${px(20)};line-height:1}
.lcw-menu__tab kbd{font-family:${TYPOGRAPHY_TOKENS.fonts.pixel};font-size:12px;padding:0 4px;border:1px solid var(--c-ink-500);border-radius:${S.radiusButtonPx}px;color:var(--c-ink-500)}
.lcw-menu__x{flex:none;align-self:center;min-width:${S.touchTargetMinPx}px;min-height:${S.touchTargetMinPx}px;margin-bottom:8px;border:${S.borderWidthPx}px solid var(--c-ink-900);border-radius:${S.radiusButtonPx}px;
  background:var(--c-paper-0);box-shadow:${S.shadowPressed};font-weight:800;font-size:${px(t.body.sizePx)};cursor:pointer}
.lcw-menu__body{flex:1;min-height:0;overflow:auto;padding:16px;font-size:${px(t.body.sizePx)};line-height:1.5}
.lcw-menu h2{margin:0 0 4px;font-size:${px(t.h3.sizePx)};line-height:1.3}
.lcw-menu h3{margin:16px 0 8px;font-size:${px(t['body-l'].sizePx)};line-height:1.3}
.lcw-menu p{margin:0 0 8px}
.lcw-menu .muted{color:var(--c-ink-700);font-size:${px(t.small.sizePx)}}
.lcw-menu .ko{display:block;margin-top:1px;font-size:max(10px,.78em);font-weight:500;line-height:1.25;color:var(--c-ink-700);letter-spacing:0;white-space:normal}
.lcw-menu .note{background:var(--c-paper-100);border:${S.borderWidthPx}px dashed var(--c-line-200);border-radius:${S.radiusCardPx}px;padding:10px 12px;color:var(--c-ink-700);font-size:${px(t.small.sizePx)}}
.lcw-menu .btn{min-height:${S.touchTargetMinPx}px;padding:6px 14px;border:${S.borderWidthPx}px solid var(--c-ink-900);border-radius:${S.radiusButtonPx}px;background:var(--c-paper-0);
  box-shadow:var(--shadow);font-weight:800;font-size:${px(t.small.sizePx)};cursor:pointer}
.lcw-menu .btn:active{box-shadow:${S.shadowPressed};transform:translate(3px,3px)}
.lcw-menu .btn.pri{background:var(--c-brand-d);color:var(--c-paper-0)}
.lcw-menu .btn:disabled{opacity:.5;cursor:default;box-shadow:none;transform:none}
.lcw-menu .grid{display:grid;gap:8px}
.lcw-menu .card{background:var(--c-paper-0);border:${S.borderWidthPx}px solid var(--c-ink-900);border-radius:${S.radiusCardPx}px;padding:10px}
.lcw-menu .bar{height:12px;border:${S.borderWidthPx}px solid var(--c-ink-900);border-radius:999px;background:var(--c-paper-100);overflow:hidden}
.lcw-menu .bar > i{display:block;height:100%;background:var(--c-leaf);background-image:repeating-linear-gradient(45deg,transparent 0 6px,color-mix(in srgb,var(--c-paper-0) 35%,transparent) 6px 9px)}
@media (max-width:600px){
  .lcw-menu{padding:0;align-items:stretch}
  .lcw-menu__win{width:100%;height:100%;border-radius:0;border:none;box-shadow:none}
  .lcw-menu__tabs{gap:2px}
  .lcw-menu__tab{flex:1 1 0;min-width:0;flex-direction:column;gap:2px;padding:4px 2px;font-size:${px(t.micro.sizePx)};white-space:nowrap}
  .lcw-menu__tab .ic{font-size:${px(18)}}
  .lcw-menu__tab kbd{display:none}
  .lcw-menu__body{padding:12px}
}
@media (max-height:500px){
  .lcw-menu{padding:0;align-items:stretch}
  .lcw-menu__win{width:100%;height:100%;border-radius:0;border:none;box-shadow:none;flex-direction:row}
  .lcw-menu__top{flex-direction:column;padding:8px 0 8px 8px;border-bottom:none;border-right:${S.borderWidthPx}px solid var(--c-ink-900);width:auto}
  .lcw-menu__tabs{flex-direction:column;overflow-y:auto;overflow-x:hidden}
  .lcw-menu__tab{border-radius:${S.radiusCardPx}px 0 0 ${S.radiusCardPx}px;border-bottom:${S.borderWidthPx}px solid transparent;border-right:none;min-height:40px;padding:4px 10px}
  .lcw-menu__tab[aria-selected="true"]{margin-bottom:0;margin-right:-${S.borderWidthPx}px;border-bottom-color:var(--c-ink-900)}
  .lcw-menu__tab kbd{display:none}
  .lcw-menu__x{order:-1;margin:0 8px 8px 0}
  .lcw-menu__body{padding:10px 12px}
}
@media (prefers-reduced-motion:reduce){.lcw-menu__win{animation:none}}
.lcw-hudbtn{position:absolute;pointer-events:auto;min-width:${S.gameButtonMinPx}px;height:${S.gameButtonMinPx}px;border:${S.borderWidthPx}px solid ${COLOR_TOKENS['ink-900']};
  border-radius:${S.radiusButtonPx}px;box-shadow:${S.shadowDefault};background:${COLOR_TOKENS['paper-50']};color:${COLOR_TOKENS['ink-900']};font-family:${TYPOGRAPHY_TOKENS.fonts.ui};
  font-weight:800;font-size:${t.small.sizePx}px;padding:0 10px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:0;cursor:pointer;touch-action:none;line-height:1.1}
.lcw-hudbtn .ic{font-size:20px;line-height:1}
.lcw-hudbtn .ko{font-size:10px;font-weight:700;line-height:1;opacity:.8}
/* left of the hotbar (5 x 56 + 4 x 4 = 296 wide, centred, 12 from the bottom): the bag and the menu belong together;
   held by its right edge so a wider label grows away from the hotbar */
.lcw-hudbtn--bag{right:calc(50% + 148px + 8px);bottom:12px}
@media (max-width:600px){.lcw-hudbtn--bag{right:calc(50% + 118px + 6px);min-width:48px;height:48px;bottom:10px;font-size:${t.micro.sizePx}px;padding:0 4px}.lcw-hudbtn--bag .ic{font-size:18px}}
.lcw-hudbtn--shop{right:calc(50% + 148px + 8px + ${S.gameButtonMinPx}px + 8px);bottom:12px}
@media (max-width:600px){.lcw-hudbtn--shop{right:calc(50% + 118px + 6px + 48px + 6px);min-width:48px;height:48px;bottom:10px;font-size:${t.micro.sizePx}px;padding:0 4px}.lcw-hudbtn--shop .ic{font-size:18px}}
.lcw-shoptip{position:absolute;pointer-events:auto;left:calc(50% - 148px - 8px - ${S.gameButtonMinPx * 2}px - 8px);bottom:${S.gameButtonMinPx * 2 + 28}px;max-width:260px;display:flex;flex-direction:column;gap:6px;padding:10px 12px;background:${COLOR_TOKENS['paper-0']};color:${COLOR_TOKENS['ink-900']};border:${S.borderWidthPx}px solid ${COLOR_TOKENS['ink-900']};border-radius:${S.radiusCardPx}px;box-shadow:${S.shadowDefault};font-family:${TYPOGRAPHY_TOKENS.fonts.ui};font-weight:700;font-size:${t.small.sizePx}px}
.lcw-shoptip .ko{font-size:${t.micro.sizePx}px;opacity:.8}
.lcw-shoptip .x{align-self:flex-end;min-height:36px;padding:2px 12px;border:${S.borderWidthPx}px solid ${COLOR_TOKENS['ink-900']};border-radius:${S.radiusButtonPx}px;background:${COLOR_TOKENS.sun};font:inherit;font-weight:800}
/* small screens: the shop's own help card says the same thing; the tip would sit on the world's buttons */
@media (max-width:600px),(max-height:440px){.lcw-shoptip{display:none}}
.lcw-hudbtn:active{box-shadow:${S.shadowPressed};transform:translate(3px,3px)}
`;

export function ensureMenuStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(MENU_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = MENU_STYLE_ID;
  st.textContent = MENU_CSS;
  document.head.appendChild(st);
}
