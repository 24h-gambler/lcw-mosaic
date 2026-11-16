import { COLOR_TOKENS, SHAPE_TOKENS, TYPOGRAPHY_TOKENS } from '@lcw/ui';

/**
 * Map screen G06 styles. Tokens only (AGENTS 6). Text scales with --fs from the menu. The panel lays itself out by its
 * own width (container queries), so the same rules hold in the desktop window, the phone sheet and the landscape rail:
 * wide = big map | world grid + legend | places + elevator; medium = big map | one side column; narrow = one column.
 */
const vars = Object.entries(COLOR_TOKENS)
  .map(([k, v]) => `--c-${k}:${v};`)
  .join('');
const t = TYPOGRAPHY_TOKENS.scale;
const px = (n: number): string => `calc(${n}px * var(--fs, 1))`;
const S = SHAPE_TOKENS;

export const MAP_STYLE_ID = 'lcw-frame-map-style';

export const MAP_CSS = `
.lcw-map{${vars}container-type:inline-size;display:block}
.lcw-map__grid{display:grid;gap:16px;grid-template-columns:minmax(0,1fr);
  grid-template-areas:"main" "places" "world" "bands" "legend"}
.lcw-map__main{grid-area:main;min-width:0}
.lcw-map__world{grid-area:world;min-width:0}
.lcw-map__places{grid-area:places;min-width:0}
.lcw-map__bands{grid-area:bands;min-width:0}
.lcw-map__legend{grid-area:legend;min-width:0}
.lcw-map h3{margin:0 0 8px}
@container (min-width:560px){
  .lcw-map__grid{grid-template-columns:minmax(0,1fr) minmax(200px,240px);grid-template-areas:"main world" "main places" "main bands" "main legend";align-items:start}
  .lcw-map__main{position:sticky;top:0}
}
@container (min-width:880px){
  .lcw-map__grid{grid-template-columns:minmax(0,1fr) 210px 220px;grid-template-areas:"main world places" "main legend bands"}
}
.lcw-map__head{display:flex;align-items:center;flex-wrap:wrap;gap:6px 10px;margin-bottom:8px}
.lcw-map__head h3{margin:0}
.lcw-map__now{margin:0 0 8px;color:var(--c-ink-700);font-size:${px(t.small.sizePx)}}
.lcw-map__chip{display:inline-flex;align-items:center;gap:6px;padding:2px 8px;border:${S.borderWidthPx}px solid var(--c-ink-900);border-radius:999px;
  background:var(--c-paper-0);font-size:${px(t.small.sizePx)};font-weight:700}
.lcw-map__chip svg{width:${px(16)};height:${px(16)};flex:none}
.lcw-map__me{margin-left:auto}
.lcw-map__stage{position:relative;width:min(100%, 500px, calc(100dvh - 150px));min-width:240px;aspect-ratio:1;margin:0 auto;
  border:${S.borderWidthPx}px solid var(--c-ink-900);border-radius:${S.radiusCardPx}px;background:var(--c-paper-0);overflow:hidden}
.lcw-map__stage > svg,.lcw-map__stage > .lcw-map__pins{position:absolute;inset:0;width:100%;height:100%}
.lcw-map__stage > svg.lcw-map__top{pointer-events:none}
.lcw-map__pins{pointer-events:none}
.lcw-map__pin{position:absolute;pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:2px;min-width:${S.touchTargetMinPx}px;min-height:${S.touchTargetMinPx}px;
  padding:0 2px 4px;margin:0;border:none;background:transparent;font:inherit;color:var(--c-ink-900);cursor:pointer;transform:translate(-50%,-9px)}
.lcw-map__pin.is-static{cursor:default}
.lcw-map__pin.above{flex-direction:column-reverse;padding:4px 2px 0;transform:translate(-50%,calc(-100% + 9px))}
.lcw-map__pin.start{align-items:flex-start;transform:translate(-9px,-9px)}
.lcw-map__pin.end{align-items:flex-end;transform:translate(calc(-100% + 9px),-9px)}
.lcw-map__pin.above.start{transform:translate(-9px,calc(-100% + 9px))}
.lcw-map__pin.above.end{transform:translate(calc(-100% + 9px),calc(-100% + 9px))}
.lcw-map__pin.by-me .lcw-map__label{margin-top:16px}
.lcw-map__pin.above.by-me .lcw-map__label{margin-top:0;margin-bottom:16px}
.lcw-map__dot{flex:none;width:18px;height:18px;border-radius:50%;background:var(--c-brand);border:${S.borderWidthPx}px solid var(--c-ink-900);box-shadow:${S.shadowPressed}}
.lcw-map__pin.is-here .lcw-map__dot{background:var(--c-sun)}
.lcw-map__label{display:block;max-width:${px(130)};padding:1px 6px;border:${S.borderWidthPx}px solid var(--c-ink-900);border-radius:${S.radiusButtonPx}px;background:var(--c-paper-0);
  font-size:${px(t.small.sizePx)};font-weight:800;line-height:1.25;text-align:center;white-space:normal;word-break:keep-all}
button.lcw-map__pin:hover .lcw-map__label{background:var(--c-paper-100)}
button.lcw-map__pin:active .lcw-map__dot{transform:translate(1px,1px)}
.lcw-map__you{position:absolute;transform:translate(-50%,calc(-100% - 2px));padding:0 6px;border-radius:${S.radiusButtonPx}px;background:var(--c-brand-d);color:var(--c-paper-0);
  font-size:${px(t.small.sizePx)};font-weight:800;line-height:1.4;pointer-events:none;white-space:nowrap}
.lcw-map__north{position:absolute;top:6px;right:6px;display:flex;flex-direction:column;align-items:center;padding:2px 6px;border:${S.borderWidthPx}px solid var(--c-ink-900);
  border-radius:${S.radiusButtonPx}px;background:var(--c-paper-0);font-size:${px(t.micro.sizePx)};font-weight:800;line-height:1.1;pointer-events:none}
.lcw-map__fog{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:16px;text-align:center;pointer-events:none}
.lcw-map__fog b{font-family:${TYPOGRAPHY_TOKENS.fonts.pixel};font-size:48px;line-height:1;color:var(--c-ink-700)}
.lcw-map__fog span{max-width:240px;padding:4px 8px;border-radius:${S.radiusButtonPx}px;background:var(--c-paper-0);color:var(--c-ink-700);font-size:${px(t.small.sizePx)};font-weight:700}
.lcw-map__ov{position:relative;width:100%;max-width:240px;aspect-ratio:1;margin:0 auto;border:${S.borderWidthPx}px solid var(--c-ink-900);border-radius:${S.radiusCardPx}px;overflow:hidden;background:var(--c-paper-0)}
.lcw-map__ov > svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.lcw-map__ovgrid{position:absolute;inset:0;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr)}
.lcw-map__cell{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;min-width:0;min-height:0;padding:2px;border:none;background:transparent;cursor:pointer;
  font-size:${px(t.micro.sizePx)};font-weight:800;line-height:1.2;text-align:center;word-break:keep-all;color:var(--c-ink-900)}
.lcw-map__cell span{padding:0 3px;border-radius:${S.radiusButtonPx}px;background:color-mix(in srgb,var(--c-paper-0) 85%,transparent)}
.lcw-map__cell.is-fog span{color:var(--c-ink-700);font-weight:700}
.lcw-map__cell.is-fog i{display:block;font-style:normal;white-space:nowrap}
.lcw-map__cell.is-fog b{font-family:${TYPOGRAPHY_TOKENS.fonts.pixel};font-size:12px;color:var(--c-ink-700)}
.lcw-map__cell[aria-pressed="true"]{outline:${S.focusOutlineWidthPx}px solid var(--c-brand-d);outline-offset:-${S.focusOutlineWidthPx + 1}px}
.lcw-map__cell:focus-visible{outline:${S.focusOutlineWidthPx}px solid var(--c-sky-d);outline-offset:-${S.focusOutlineWidthPx + 1}px}
.lcw-map__hint{margin:8px 0 0}
.lcw-map__list{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.lcw-map__go{width:100%;display:flex;align-items:center;justify-content:space-between;gap:8px;text-align:left}
.lcw-map__go small{font-weight:700;color:var(--c-ink-700)}
.lcw-map__go.is-here{background:var(--c-sun)}
.lcw-map__place{display:flex;align-items:center;gap:8px;min-height:32px;font-weight:700}
.lcw-map__place .lcw-map__dot{width:14px;height:14px}
.lcw-map__shaft{list-style:none;margin:0 0 8px;padding:0;position:relative}
.lcw-map__shaft::before{content:"";position:absolute;left:15px;top:14px;bottom:14px;width:4px;background:var(--c-line-200);border-left:${S.borderWidthPx}px solid var(--c-ink-500);border-right:${S.borderWidthPx}px solid var(--c-ink-500)}
.lcw-map__stop{position:relative;display:flex;align-items:center;gap:10px;min-height:${px(36)};padding:2px 0}
.lcw-map__car{position:relative;flex:none;display:flex;align-items:center;justify-content:center;width:34px;height:28px;border:${S.borderWidthPx}px solid var(--c-ink-500);
  border-radius:${S.radiusButtonPx}px;background:var(--c-paper-100);font-size:14px;line-height:1}
.lcw-map__stop.is-here .lcw-map__car{border-color:var(--c-ink-900);background:var(--c-brand);box-shadow:${S.shadowPressed}}
.lcw-map__stop.is-open .lcw-map__car{border-color:var(--c-ink-900);background:var(--c-paper-0)}
.lcw-map__stop b{display:block;font-size:${px(t.small.sizePx)};line-height:1.25}
.lcw-map__stop small{display:block;font-size:${px(t.micro.sizePx)};color:var(--c-ink-700);font-variant-numeric:tabular-nums}
.lcw-map__stop.is-locked b{color:var(--c-ink-700);font-weight:600}
.lcw-map__stop em{margin-left:auto;flex:none;font-style:normal;padding:0 6px;border-radius:${S.radiusButtonPx}px;background:var(--c-brand-d);color:var(--c-paper-0);
  font-size:${px(t.micro.sizePx)};font-weight:800;line-height:1.5}
.lcw-map__keys{list-style:none;margin:0;padding:0;display:grid;gap:6px}
.lcw-map__keys li{display:flex;align-items:center;gap:8px;font-size:${px(t.small.sizePx)};font-weight:700}
.lcw-map__keys svg{width:${px(28)};height:${px(28)};flex:none;border-radius:${S.radiusButtonPx}px}
.lcw-map__sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
@media (max-height:500px){
  .lcw-map__stage{width:min(100%, 500px, calc(100dvh - 76px))}
}
`;

export function ensureMapStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(MAP_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = MAP_STYLE_ID;
  st.textContent = MAP_CSS;
  document.head.appendChild(st);
}
