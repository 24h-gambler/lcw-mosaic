import { COLOR_TOKENS, SHAPE_TOKENS, TYPOGRAPHY_TOKENS } from '@lcw/ui';

/** Page CSS from the design tokens only (docs/08). Pixel UI: hard shadows, 2px ink borders, Galmuri11 labels. */
const vars = Object.entries(COLOR_TOKENS)
  .map(([k, v]) => `--c-${k}:${v};`)
  .join('');

export const CSS = `
:root{${vars}--f-ui:${TYPOGRAPHY_TOKENS.fonts.ui};--f-target:${TYPOGRAPHY_TOKENS.fonts.target};--f-pixel:${TYPOGRAPHY_TOKENS.fonts.pixel};
--shadow:${SHAPE_TOKENS.shadowDefault};--shadow-p:${SHAPE_TOKENS.shadowPressed};--r:${SHAPE_TOKENS.radiusButtonPx}px;--rc:${SHAPE_TOKENS.radiusCardPx}px;--touch:${SHAPE_TOKENS.touchTargetMinPx}px;--btn:${SHAPE_TOKENS.gameButtonMinPx}px;--mic:${SHAPE_TOKENS.micButtonPx}px}
*{box-sizing:border-box}
html,body,#root{margin:0;height:100%;background:var(--c-night-900);color:var(--c-paper-50);overscroll-behavior:none}
body{font-family:var(--f-ui);-webkit-tap-highlight-color:transparent;word-break:keep-all;overflow-wrap:break-word}
.adv{position:fixed;inset:0;display:flex;flex-direction:column;overflow:hidden}
.adv.side{flex-direction:row}
.adv-stage{position:relative;flex:none;background:var(--c-night-900);display:flex;align-items:center;justify-content:center}
.adv-stage canvas{width:100%;height:100%;image-rendering:pixelated;image-rendering:crisp-edges;touch-action:none;display:block}
.adv-side{flex:1;min-width:0;min-height:0;display:flex;flex-direction:column;background:var(--c-night-700);border-left:2px solid var(--c-ink-900)}
.adv.stack .adv-side{border-left:0;border-top:2px solid var(--c-ink-900)}
.adv-top{display:flex;gap:6px;align-items:center;padding:6px 8px;background:var(--c-night-900);flex-wrap:wrap}
.adv-top .brand{font-family:var(--f-pixel);font-size:12px;color:var(--c-sun);margin-right:auto;white-space:nowrap}
.adv-panel{flex:1;overflow-y:auto;padding:10px 12px 16px;display:flex;flex-direction:column;gap:10px}
.toggle{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:4px 10px;border:2px solid var(--c-ink-900);border-radius:var(--r);background:var(--c-paper-50);color:var(--c-ink-900);font:600 13px var(--f-ui);cursor:pointer}
.toggle[aria-pressed="true"]{background:var(--c-sun)}
.btn{min-height:var(--touch);padding:8px 12px;border:2px solid var(--c-ink-900);border-radius:var(--r);background:var(--c-paper-50);color:var(--c-ink-900);font:700 15px var(--f-ui);box-shadow:var(--shadow);cursor:pointer;text-align:left;display:flex;flex-direction:column;justify-content:center;gap:2px}
.btn:active{box-shadow:var(--shadow-p);transform:translate(3px,3px)}
.btn:focus-visible,.toggle:focus-visible,.tile:focus-visible{outline:3px solid var(--c-sky);outline-offset:2px}
.btn.primary{background:var(--c-sun)}
.btn.go{background:var(--c-leaf);color:var(--c-ink-900)}
.btn.ghost{background:transparent;color:var(--c-paper-50);border-color:var(--c-paper-50);box-shadow:none}
.btn[disabled]{opacity:.45;cursor:default}
.btn .ko,.ko{font:500 12px var(--f-ui);color:var(--c-ink-500)}
.dark .ko,.msg .ko,.hintline .ko{color:var(--c-silver)}
.btn.sel{outline:3px solid var(--c-sky);outline-offset:2px}
.cmds{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cmds .btn{min-height:var(--btn);font-family:var(--f-pixel);font-size:16px;align-items:center;text-align:center}
.cmds .btn.glow{background:var(--c-leaf);animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{50%{transform:scale(1.03)}}
@media (prefers-reduced-motion:reduce){.cmds .btn.glow{animation:none}}
.msg{background:var(--c-night-900);border:2px solid var(--c-paper-50);border-radius:var(--rc);padding:10px 12px;min-height:84px}
.msg .who{font:12px var(--f-pixel);color:var(--c-sun);margin-bottom:4px}
.msg .en{font:600 17px/1.45 var(--f-target)}
.msg .ko{margin-top:4px;font-size:13px}
.target{font:700 22px/1.4 var(--f-target);color:var(--c-ink-900);background:var(--c-paper-50);border:2px solid var(--c-ink-900);border-radius:var(--rc);padding:10px 12px}
.target .ko{display:block;font:500 13px var(--f-ui);margin-top:4px}
.card{background:var(--c-paper-50);color:var(--c-ink-900);border:2px solid var(--c-ink-900);border-radius:var(--rc);padding:10px 12px;display:flex;flex-direction:column;gap:8px}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tiles{display:flex;flex-wrap:wrap;gap:6px}
.tile{min-height:var(--touch);min-width:var(--touch);padding:6px 10px;border:2px solid var(--c-ink-900);border-radius:var(--r);background:var(--c-paper-0);color:var(--c-ink-900);font:700 18px var(--f-target);box-shadow:var(--shadow-p);cursor:pointer}
.tile.used{opacity:.3}
.answer{min-height:52px;border:2px dashed var(--c-ink-500);border-radius:var(--rc);padding:6px;display:flex;flex-wrap:wrap;gap:6px;background:var(--c-paper-100)}
.mic{width:var(--mic);height:var(--mic);border-radius:50%;border:3px solid var(--c-ink-900);background:var(--c-brand);color:var(--c-paper-0);font:700 13px var(--f-ui);box-shadow:var(--shadow);cursor:pointer}
.mic.on{background:var(--c-danger);animation:pulse 1s infinite}
input.type{flex:1;min-width:0;min-height:var(--touch);font:600 18px var(--f-target);padding:6px 10px;border:2px solid var(--c-ink-900);border-radius:var(--r)}
.stars{font:18px var(--f-pixel);color:var(--c-sun-d)}
.isles{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.isle{align-items:flex-start}
.isle.locked{opacity:.6}
.isle .st{font:600 12px var(--f-ui);color:var(--c-ink-700)}
.pad{display:grid;grid-template-columns:repeat(3,60px);grid-template-rows:repeat(3,52px);gap:4px;justify-content:center;touch-action:none;user-select:none}
.pad button{border:2px solid var(--c-paper-50);background:var(--c-night-900);color:var(--c-paper-50);border-radius:var(--r);font-size:20px;touch-action:none}
.pad button:active,.pad button.on{background:var(--c-sky-d)}
.hintline{font:500 14px var(--f-ui);color:var(--c-paper-50)}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{padding:4px 10px;border-radius:999px;background:var(--c-sun);color:var(--c-ink-900);font:700 14px var(--f-target)}
.parent{position:fixed;inset:0;overflow-y:auto;background:var(--c-paper-50);color:var(--c-ink-900);font-family:var(--f-ui)}
.parent .wrap{max-width:760px;margin:0 auto;padding:16px 16px 48px}
.parent h1{font-size:24px;margin:8px 0}
.parent table{width:100%;border-collapse:collapse;table-layout:fixed}
.parent td,.parent th{border-bottom:1px solid var(--c-line-200);padding:6px 4px;text-align:left;font-size:14px;vertical-align:top}
.parent .card{color:var(--c-ink-900)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
`;
