import { COLOR_TOKENS, MOTION_TOKENS, SHAPE_TOKENS, TYPOGRAPHY_TOKENS } from '@lcw/ui';

/**
 * Dialog window G02 styles (docs/08 8.2). Colours, radii, shadows and type come from @lcw/ui tokens only; they are
 * exposed as CSS variables so the sheet itself carries no literal colours. Sizes scale with --fs (100~150%).
 */

const vars = Object.entries(COLOR_TOKENS)
  .map(([k, v]) => `--c-${k}:${v};`)
  .join('');

const t = TYPOGRAPHY_TOKENS.scale;
const px = (n: number) => `calc(${n}px * var(--fs))`;

export const DIALOG_CSS = `
.lcw-dlg{${vars}--fs:var(--lcw-fs,1);--shadow:${SHAPE_TOKENS.shadowDefault};--shadow-p:${SHAPE_TOKENS.shadowPressed};
  position:fixed;inset:0;z-index:40;display:flex;align-items:flex-end;justify-content:center;
  padding:12px;box-sizing:border-box;font-family:${TYPOGRAPHY_TOKENS.fonts.ui};color:var(--c-ink-900);
  background:color-mix(in srgb, var(--c-night-900) 45%, transparent);-webkit-tap-highlight-color:transparent}
.lcw-dlg *{box-sizing:border-box}
.lcw-dlg__win{width:min(1080px,100%);max-height:100%;display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);
  gap:16px;background:var(--c-paper-50);border:2px solid var(--c-ink-900);border-radius:${SHAPE_TOKENS.radiusCardPx * 2}px;
  box-shadow:var(--shadow);padding:16px;overflow:auto;animation:lcwUp ${MOTION_TOKENS.slowMs}ms cubic-bezier(.2,.9,.3,1.2)}
@keyframes lcwUp{from{transform:translateY(24px);opacity:0}to{transform:none;opacity:1}}
.lcw-dlg__side{display:flex;flex-direction:column;gap:12px;min-width:0}
.lcw-dlg__main{display:flex;flex-direction:column;gap:10px;min-width:0}
.lcw-dlg__npc{display:flex;gap:12px;align-items:flex-start}
.lcw-dlg__avatar{flex:none;width:${px(56)};height:${px(56)};border-radius:50%;display:grid;place-items:center;
  font-size:${px(30)};background:var(--c-sun);border:2px solid var(--c-ink-900)}
.lcw-dlg__name{font-size:${px(t.small.sizePx)};font-weight:700;color:var(--c-ink-700)}
.lcw-dlg__bubble{position:relative;background:var(--c-paper-0);border:2px solid var(--c-ink-900);border-radius:${SHAPE_TOKENS.radiusCardPx}px;
  padding:10px 12px;font-family:${TYPOGRAPHY_TOKENS.fonts.target};font-size:${px(t['body-l'].sizePx)};line-height:1.35}
.lcw-dlg__preview{flex:1;min-height:${px(96)};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:8px;text-align:center;border-radius:${SHAPE_TOKENS.radiusCardPx}px;
  background:linear-gradient(160deg,var(--c-paper-100),var(--c-paper-0));border:2px dashed var(--c-line-200);font-size:${px(52)}}
.lcw-dlg__pics{display:flex;align-items:center;justify-content:center;gap:8px;line-height:1}
.lcw-dlg__pics span,.lcw-dlg__item3d{animation:lcwBob 2.4s ease-in-out infinite}
.lcw-dlg__pics span:nth-child(2){animation-delay:.3s}
.lcw-dlg__item3d{width:${px(120)};height:${px(120)};object-fit:contain}
.lcw-dlg__pv{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:6px;font-size:${px(t.body.sizePx)}}
.lcw-dlg__coin{font-weight:800;background:var(--c-sun);border:2px solid var(--c-ink-900);border-radius:999px;padding:1px 10px;white-space:nowrap}
.lcw-dlg__cheaper{font-size:${px(t.small.sizePx)};font-weight:700;color:var(--c-leaf-d)}
.lcw-dlg__cheaper.best{color:var(--c-ink-700)}
.lcw-offer__price{display:block;margin-top:3px;font-size:${px(t.micro.sizePx)};font-weight:800;letter-spacing:0;color:var(--c-ink-700)}
.lcw-dlg__avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover}
@keyframes lcwBob{50%{transform:translateY(-6px) rotate(-4deg)}}
.lcw-dlg__tags{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.lcw-dlg__tagl{font-size:${px(t.small.sizePx)};color:var(--c-ink-500);margin-right:2px}
.lcw-dlg__tag{position:relative;border:2px solid var(--c-ink-900);border-radius:999px;padding:2px 10px;background:var(--c-sun);
  font-family:${TYPOGRAPHY_TOKENS.fonts.target};font-size:${px(t.body.sizePx)};font-weight:700;user-select:none;touch-action:manipulation}
.lcw-dlg__gloss{position:absolute;left:50%;bottom:calc(100% + 6px);transform:translateX(-50%);white-space:nowrap;
  background:var(--c-ink-900);color:var(--c-paper-0);padding:4px 8px;border-radius:6px;font-size:${px(t.small.sizePx)};font-weight:500}
.lcw-dlg__me{font-size:${px(t.body.sizePx)};color:var(--c-ink-700);background:var(--c-paper-0);border-radius:8px;padding:8px 10px;border:2px solid var(--c-line-200)}
.lcw-dlg__me b{color:var(--c-ink-900)}
.lcw-dlg__me .to{color:var(--c-leaf-d);font-weight:700}
.lcw-dlg__title{display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:800;font-size:${px(t.body.sizePx)}}
.lcw-dlg__x{border:2px solid var(--c-ink-900);background:var(--c-paper-0);border-radius:8px;min-width:44px;min-height:44px;font-size:${px(18)};cursor:pointer}
.lcw-dlg__offers{display:flex;flex-direction:column;gap:8px}
.lcw-offer{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;width:100%;text-align:left;
  background:var(--c-paper-0);border:2px solid var(--c-ink-900);border-radius:${SHAPE_TOKENS.radiusCardPx}px;padding:8px 10px;
  min-height:${px(56)};cursor:pointer;box-shadow:var(--shadow-p);transition:transform ${MOTION_TOKENS.fastMs}ms,box-shadow ${MOTION_TOKENS.fastMs}ms;
  animation:lcwDeal ${MOTION_TOKENS.popMs}ms both}
.lcw-offer:nth-child(2){animation-delay:60ms}.lcw-offer:nth-child(3){animation-delay:120ms}
@keyframes lcwDeal{from{transform:translateX(18px) rotate(1deg);opacity:0}}
.lcw-offer[aria-pressed=true]{transform:translate(-2px,-2px);box-shadow:var(--shadow);outline:3px solid var(--c-brand);outline-offset:1px}
.lcw-offer__stars{display:flex;flex-direction:column;align-items:center;min-width:${px(44)};font-size:${px(18)};line-height:1;letter-spacing:-2px}
.lcw-offer[data-s="1"] .lcw-offer__stars{color:var(--c-ink-500)}
.lcw-offer[data-s="2"] .lcw-offer__stars{color:var(--c-sky-d)}
.lcw-offer[data-s="3"] .lcw-offer__stars{color:var(--c-sun-d)}
.lcw-offer[data-s="1"]{border-left-width:${SHAPE_TOKENS.borderWidthPx + 4}px;border-left-color:var(--c-silver)}
.lcw-offer[data-s="2"]{border-left-width:${SHAPE_TOKENS.borderWidthPx + 4}px;border-left-color:var(--c-sky)}
.lcw-offer[data-s="3"]{border-left-width:${SHAPE_TOKENS.borderWidthPx + 4}px;border-left-color:var(--c-sun)}
.lcw-offer__text{font-family:${TYPOGRAPHY_TOKENS.fonts.target};font-size:${px(t.h3.sizePx)};line-height:1.3;font-weight:600;overflow-wrap:anywhere}
.lcw-offer__text .k{background:color-mix(in srgb,var(--c-sun) 45%,transparent);border-radius:4px;padding:0 2px}
.lcw-offer__text .m{color:var(--c-ink-500);letter-spacing:1px}
.lcw-offer__text .miss{text-decoration:underline 3px var(--c-sun-d);text-underline-offset:4px}
.lcw-offer__pic{font-size:${px(34)};letter-spacing:4px}
.lcw-listen{border:2px solid var(--c-ink-900);background:var(--c-paper-100);border-radius:8px;min-width:44px;min-height:44px;font-size:20px;line-height:1;cursor:pointer;padding:0 8px;flex:none}
.lcw-dlg__bar{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;padding-top:4px}
.lcw-mic{position:relative;width:${SHAPE_TOKENS.micButtonPx}px;height:${SHAPE_TOKENS.micButtonPx}px;border-radius:50%;border:3px solid var(--c-ink-900);
  background:var(--c-paper-0);font-size:30px;cursor:pointer;box-shadow:var(--shadow);overflow:hidden;flex:none;touch-action:manipulation}
.lcw-mic::before{content:"";position:absolute;inset:0;background:var(--c-brand);transform:scaleY(var(--lvl,0));transform-origin:bottom;transition:transform 120ms}
.lcw-mic span{position:relative}
.lcw-mic[data-on=true]{animation:lcwPulse 1.2s ease-in-out infinite}
@keyframes lcwPulse{50%{box-shadow:0 0 0 10px color-mix(in srgb,var(--c-brand) 25%,transparent),var(--shadow)}}
.lcw-mic:disabled{opacity:.45;cursor:not-allowed}
.lcw-mic-label{font-weight:800;font-size:${px(t.body.sizePx)};min-width:0}
.lcw-mic-label small{display:block;font-weight:500;color:var(--c-ink-500);font-size:${px(t.small.sizePx)}}
.lcw-alt{border:2px solid var(--c-ink-900);background:var(--c-paper-0);border-radius:8px;min-height:44px;padding:0 12px;font-weight:700;font-size:${px(t.small.sizePx + 1)};cursor:pointer}
.lcw-alt[data-hot=true]{background:var(--c-sun);animation:lcwNudge 1.6s ease-in-out infinite}
@keyframes lcwNudge{10%,30%{transform:rotate(-3deg)}20%{transform:rotate(3deg)}40%{transform:none}}
.lcw-note{border-radius:8px;padding:8px 10px;font-size:${px(t.small.sizePx + 1)};font-weight:600;background:var(--c-paper-100);border:2px solid var(--c-line-200)}
.lcw-note a{color:var(--c-sky-d);font-weight:800}
.lcw-dots{display:inline-flex;gap:6px}.lcw-dots i{width:10px;height:10px;border-radius:50%;background:var(--c-brand);animation:lcwDot 900ms infinite}
.lcw-dots i:nth-child(2){animation-delay:150ms}.lcw-dots i:nth-child(3){animation-delay:300ms}
@keyframes lcwDot{50%{transform:translateY(-6px);opacity:.5}}
.lcw-res{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;padding:6px 0}
.lcw-res__stars{display:flex;gap:6px;font-size:${px(44)};line-height:1}
.lcw-res__stars span{animation:lcwPop ${MOTION_TOKENS.popMs * 2}ms cubic-bezier(.2,1.6,.4,1) both;color:var(--c-sun-d)}
.lcw-res__stars span.off{color:var(--c-line-200);animation:none}
.lcw-res__stars span:nth-child(2){animation-delay:120ms}.lcw-res__stars span:nth-child(3){animation-delay:240ms}
@keyframes lcwPop{from{transform:scale(0) rotate(-30deg)}}
.lcw-res__words{font-family:${TYPOGRAPHY_TOKENS.fonts.target};font-size:${px(t.h3.sizePx)};font-weight:700;line-height:1.4}
.lcw-res__words span{display:inline-block;margin:0 3px}
.lcw-res__words .hit{animation:lcwPaint 260ms both;color:var(--c-leaf-d)}
.lcw-res__words .miss{text-decoration:underline 3px var(--c-sun-d);text-underline-offset:5px;color:var(--c-ink-900)}
@keyframes lcwPaint{from{color:var(--c-ink-500);transform:translateY(3px)}}
.lcw-res__fb{font-size:${px(t['body-l'].sizePx)};font-weight:800}
.lcw-res__coins{font-weight:800;font-size:${px(t.body.sizePx)};background:var(--c-sun);border:2px solid var(--c-ink-900);border-radius:999px;padding:2px 12px}
.lcw-row{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}
.lcw-cta{border:2px solid var(--c-ink-900);border-radius:8px;min-height:${SHAPE_TOKENS.gameButtonMinPx}px;padding:0 20px;font-weight:800;font-size:${px(t.body.sizePx + 1)};cursor:pointer;box-shadow:var(--shadow-p)}
.lcw-cta--go{background:var(--c-leaf);color:var(--c-paper-0)}
.lcw-cta--up{background:var(--c-sun)}
.lcw-cta--again{background:var(--c-paper-0)}
.lcw-cards{display:flex;flex-wrap:wrap;gap:8px}
.lcw-card{border:2px solid var(--c-ink-900);background:var(--c-paper-0);border-radius:8px;min-height:48px;padding:0 12px;font-family:${TYPOGRAPHY_TOKENS.fonts.target};
  font-size:${px(t['body-l'].sizePx)};font-weight:700;cursor:pointer;box-shadow:var(--shadow-p)}
.lcw-card:disabled{opacity:.25;box-shadow:none}
.lcw-answer{min-height:${px(52)};border:2px dashed var(--c-ink-500);border-radius:8px;padding:8px 10px;font-family:${TYPOGRAPHY_TOKENS.fonts.target};font-size:${px(t.h3.sizePx)};font-weight:700}
.lcw-input{width:100%;min-height:52px;border:2px solid var(--c-ink-900);border-radius:8px;padding:0 12px;font-size:${px(t['body-l'].sizePx)};font-family:${TYPOGRAPHY_TOKENS.fonts.target}}
.lcw-echo{display:flex;gap:6px;flex-wrap:wrap;font-family:${TYPOGRAPHY_TOKENS.fonts.target};font-size:${px(t.h3.sizePx)};font-weight:700}
.lcw-echo span{padding:2px 8px;border-radius:6px;background:var(--c-paper-100)}
.lcw-echo span.now{background:var(--c-sun);outline:2px solid var(--c-ink-900)}
.lcw-echo span.done{color:var(--c-leaf-d)}
@media (max-width:760px){
  .lcw-dlg{padding:0}
  .lcw-dlg__win{grid-template-columns:1fr;border-radius:${SHAPE_TOKENS.radiusCardPx * 2}px ${SHAPE_TOKENS.radiusCardPx * 2}px 0 0;padding:12px;gap:10px;max-height:100%}
  .lcw-dlg__preview{display:none}
  .lcw-dlg__avatar{width:40px;height:40px;font-size:22px}
  .lcw-dlg__npc{gap:8px}
  .lcw-dlg__bubble{font-size:${px(t.body.sizePx)};padding:6px 10px}
  .lcw-dlg__tagl{display:none}
  .lcw-offer{gap:6px;padding:6px 8px}
  .lcw-offer__stars{min-width:28px;font-size:${px(14)}}
  .lcw-offer__text{font-size:${px(t['body-l'].sizePx)}}
  .lcw-dlg__x{min-width:40px;min-height:40px}
}
/* Phones: the world shows the NPC around the panel (setViewInset), so no dim layer over it. */
@media (max-width:760px),(orientation:landscape) and (max-height:520px){.lcw-dlg{background:transparent}}
/* Landscape phone (844x390, outsider capture 11-16): a bottom sheet covered the whole screen. The window becomes a
   side panel on the right, full height; the NPC stands in the strip on the left (App.tsx sends its width as rightPx). */
@media (orientation:landscape) and (max-height:520px){
  /* starts under the world's star/coin chip (hud .lw-stars: top 12px, 36px tall), which the panel's 🔊 covered on a
     844x390 lesson screen (lesson lane, 11-16): the child sees stars and coins while ordering */
  .lcw-dlg{padding:56px 0 0;align-items:stretch;justify-content:flex-end}
  .lcw-dlg__win{width:min(60vw,600px);height:100%;max-height:100%;grid-template-columns:1fr;align-content:start;
    border-radius:${SHAPE_TOKENS.radiusCardPx * 2}px 0 0 ${SHAPE_TOKENS.radiusCardPx * 2}px;border-right:0;padding:8px max(10px,env(safe-area-inset-right)) 8px 10px;gap:6px;animation-name:lcwSide}
  .lcw-dlg__side{gap:6px}
  .lcw-dlg__preview{display:none}
  .lcw-dlg__avatar{width:34px;height:34px;font-size:19px}
  .lcw-dlg__npc{gap:8px}
  .lcw-dlg__bubble{font-size:${px(t.body.sizePx)};padding:4px 9px;line-height:1.3}
  .lcw-dlg__tagl{display:none}
  .lcw-dlg__main{gap:6px}
  .lcw-offer{gap:6px;padding:3px 6px 3px 8px;min-height:44px}
  .lcw-offer__stars{min-width:26px;font-size:${px(13)}}
  .lcw-offer__text{font-size:${px(t.body.sizePx + 1)};line-height:1.25}
  .lcw-dlg__x{min-width:40px;min-height:40px}
  .lcw-dlg__bar{gap:8px;padding-top:0}
  .lcw-mic{width:52px;height:52px;font-size:22px}
  .lcw-alt{min-height:40px;padding:0 10px}
  .lcw-res{gap:6px;padding:0}
  .lcw-res__stars{font-size:${px(32)}}
  .lcw-listen{min-width:40px;min-height:40px}
  /* the mic stays on screen however long the sentences get (the window scrolls under it) */
  .lcw-dlg__bar{position:sticky;bottom:-8px;background:var(--c-paper-50);padding:4px 0 8px;margin-bottom:-8px}
}
@media (orientation:landscape) and (max-height:400px){
  /* the 56px under the star/coin chip comes out of here: the free-talk title already says "say what you want", so
     the "You can also say" label goes, and the rows sit closer, keeping the ★★★ sentence above the mic bar */
  .lcw-dlg{padding-top:52px}
  .lcw-dlg__ideas{display:none}
  .lcw-dlg__bubble{line-height:1.2;padding:3px 8px}
  .lcw-dlg__win{gap:3px;padding-top:4px}
  .lcw-dlg__side,.lcw-dlg__main{gap:3px}
  .lcw-dlg__title{font-size:${px(t.small.sizePx)}}
  .lcw-dlg__x{min-width:34px;min-height:34px}
  .lcw-offer{min-height:38px;padding:1px 6px 1px 8px}
  .lcw-listen{min-width:34px;min-height:34px;font-size:17px}
  .lcw-mic{width:44px;height:44px;font-size:20px}
  .lcw-alt{min-height:34px}
}
@keyframes lcwSide{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
@media (pointer:coarse){.lcw-mic-label small.kbd{display:none}}
@media (prefers-reduced-motion:reduce){.lcw-dlg *{animation:none!important;transition:none!important}}
`;
