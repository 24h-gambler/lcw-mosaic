/**
 * World HUD in plain DOM over the canvas (docs/08 8.1, 7.2): goal line, scene chip, star counter, speech
 * bubbles, talk prompt, 5-slot hotbar, item toast, star celebration, scene title card, touch controls.
 * Colors, type and motion come from @lcw/ui tokens only (AGENTS 6). No prices or payment on this screen (AGENTS 4.9).
 */
import { COLOR_TOKENS as C, MOTION_TOKENS as M, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';
import { WORLD_STRINGS as W, itemGotText, itemTitle, itemTitleBi, controlsDesktopBi, controlsDesktopFor, DEFAULT_KEY_HINTS, worldSay, type KeyHintLabels } from './strings.js';
import { onLearnLang } from './lang.js';
import { bandOf, clockLabel, isNight, placeBi, type BandId } from '../frame/status.js';
import { HUD_PART_EVENT, coverHits } from './cover.js';
import { refillOf } from '../frame/gauges.js';

const STYLE_ID = 'lcw-world-hud-style';

function css(): string {
  const night = `${C['night-900']}D9`; // 85% (docs/08 2.1)
  return `
.lw-hud{--lcw-hs:min(var(--lcw-fs,1),1.25);position:absolute;inset:0;pointer-events:none;font-family:${T.fonts.ui};color:${C['ink-900']};user-select:none;-webkit-user-select:none;overflow:hidden;touch-action:none}
.lw-hud *{box-sizing:border-box}
.lw-card{background:${C['paper-50']};border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;box-shadow:${S.shadowDefault}}
.lw-goal{position:absolute;top:12px;left:50%;transform:translate(-50%,-140%);max-width:min(720px,calc(100% - 2 * var(--lw-side,16px)));padding:8px 16px;display:flex;flex-direction:column;align-items:center;gap:2px;visibility:hidden;transition:transform ${M.slowMs}ms ease-out,visibility 0s linear ${M.slowMs}ms;text-align:center}
.lw-goal.on{transform:translate(-50%,0);visibility:visible;transition:transform ${M.slowMs}ms ease-out,visibility 0s}
.lw-hud.dlg .lw-goal{opacity:0;transition:opacity ${M.slowMs}ms ease-out}
/* a dialog window covers the bottom (or the right on a landscape phone): the hotbar and help hide under it */
.lw-hud.dlg .lw-hotbar,.lw-hud.dlg .lw-help{opacity:0;visibility:hidden;transition:opacity ${M.slowMs}ms ease-out,visibility 0s linear ${M.slowMs}ms}
.lw-goal .k{font-size:calc(${T.scale.small.sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale.small.lineHeightPx}px * var(--lcw-hs,1));font-weight:700;color:${C['brand-d']}}
.lw-goal .g{font-size:calc(${T.scale['body-l'].sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale['body-l'].lineHeightPx}px * var(--lcw-hs,1));font-weight:700}
.lw-goal .t{font-family:${T.fonts.target};font-size:calc(${T.scale.h3.sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale.h3.lineHeightPx}px * var(--lcw-hs,1));font-weight:700;color:${C['sky-d']}}
.lw-chip{position:absolute;top:12px;left:12px;display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap;max-width:calc(100vw - 230px)}
.lw-chip .s{background:${night};color:${C['paper-0']};padding:6px 12px;border-radius:${S.radiusButtonPx}px;font-weight:700;font-size:calc(${T.scale.small.sizePx}px * var(--lcw-hs,1))}
.lw-chip .l{background:${C.sky};color:${C['ink-900']};padding:4px 8px;border-radius:${S.radiusButtonPx}px;font-weight:700;font-size:calc(${T.scale.micro.sizePx}px * var(--lcw-hs,1));border:2px solid ${C['ink-900']};display:none}
.lw-chip .l.on{display:inline-block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.lw-chip .p .ko{display:block;font-size:.82em;font-weight:600;opacity:.85}
.lw-chip .l.solo{background:${C['paper-0']};color:${C['ink-700']};border-style:dashed}
.lw-chip .s{display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px}
.lw-chip .w{display:inline-flex;align-items:center;gap:6px;font-size:calc(${T.scale.micro.sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale.micro.lineHeightPx}px * var(--lcw-hs,1));font-variant-numeric:tabular-nums;white-space:nowrap;opacity:.9}
.lw-chip .w:empty,.lw-chip .w.none{display:none}
.lw-chip .w i{width:10px;height:10px;border-radius:50%;background:${C.sun};box-shadow:0 0 0 2px ${C['sun-d']};flex:none}
.lw-chip .w.night i{background:transparent;box-shadow:inset -4px -2px 0 0 ${C.silver}}
.lw-chip .w.snow i{background:${C['paper-0']};box-shadow:0 0 0 2px ${C.silver}}
.lw-chip .s{white-space:nowrap}
.lw-chip .gz{display:none;align-items:center;gap:10px;margin-top:2px}
.lw-chip .gz.on{display:inline-flex}
.lw-chip .gz span{display:inline-flex;align-items:center;gap:4px;font-size:calc(${T.scale.micro.sizePx}px * var(--lcw-hs,1));line-height:1}
.lw-chip .gz b{display:block;width:calc(40px * var(--lcw-hs,1));height:8px;border-radius:999px;background:${C['night-700']};box-shadow:inset 0 0 0 1px ${C['paper-0']};overflow:hidden}
.lw-chip .gz b i{display:block;height:100%;width:45%;background:var(--gz);transition:width ${M.slowMs}ms linear}
.lw-chip .gz .h{--gz:${C.sun}}
.lw-chip .gz .t{--gz:${C.sky}}
.lw-chip .gz .low b i{background:var(--c-danger,${C.danger})}
.lw-chip .gz .low{animation:lwGzLow 1.6s ease-in-out infinite}
.lw-chip .gz em{display:none;font-style:normal;color:${C.sun};font-size:calc(${T.scale.micro.sizePx}px * var(--lcw-hs,1))}
.lw-chip .gz.slow em{display:inline}
@keyframes lwGzLow{50%{opacity:.55}}
.lw-net{position:absolute;top:0;left:0;right:0;display:none;overflow:hidden;align-items:center;justify-content:center;gap:8px;padding:4px 12px;background:${C.sun};color:${C['ink-900']};border-bottom:${S.borderWidthPx}px solid ${C['ink-900']};font-weight:700;font-size:${T.scale.small.sizePx}px;line-height:${T.scale.small.lineHeightPx}px}
.lw-net i{width:10px;height:10px;border-radius:50%;background:${C['ink-900']};flex:none}
.lw-net span{min-width:0;text-align:center;overflow-wrap:anywhere;white-space:pre-line}
.lw-hud.off .lw-net{display:flex}
.lw-hud.off .lw-chip,.lw-hud.off .lw-stars{top:calc(var(--lw-net-h,30px) + 14px)}
.lw-hud.off .lw-goal.on{transform:translate(-50%,calc(var(--lw-net-h,30px) + 2px))}
.lw-hud.off .lw-touch{top:calc(var(--lw-net-h,30px) + 2px)}
.lw-hud.goal-low .lw-goal{top:calc(var(--lw-top-b,74px) + 10px);left:12px;right:var(--lw-view-r,12px);max-width:none;transform:translate(0,-240%)}
.lw-hud.goal-low .lw-goal.on{transform:translate(0,0)}
.lw-hud.off.goal-low .lw-goal.on{transform:translate(0,calc(var(--lw-net-h,30px) + 2px))}
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
.lw-bub{position:absolute;left:0;top:0;transform:translate(-50%,-100%);max-width:min(360px,70vw);padding:8px 12px;font-family:${T.fonts.target};font-size:calc(${T.scale.h3.sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale.h3.lineHeightPx}px * var(--lcw-hs,1));font-weight:700;white-space:normal;opacity:0;transition:opacity ${M.baseMs}ms ease-out;will-change:transform}
.lw-bub.on{opacity:1}
.lw-bub::after{content:"";position:absolute;left:50%;bottom:-12px;width:14px;height:14px;background:${C['paper-50']};border-right:${S.borderWidthPx}px solid ${C['ink-900']};border-bottom:${S.borderWidthPx}px solid ${C['ink-900']};transform:translateX(-50%) rotate(45deg)}
.lw-bub .n{display:block;font-family:${T.fonts.ui};font-size:calc(${T.scale.micro.sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale.micro.lineHeightPx}px * var(--lcw-hs,1));color:${C['ink-700']};font-weight:700}
.lw-bub.me{background:${C.brand};}
.lw-bub.me::after{background:${C.brand}}
.lw-bub.pos{border-color:${C['sun-d']};box-shadow:4px 4px 0 ${C.sun},0 0 0 3px ${C.sun}}
.lw-bub.pos .n::before{content:"\\2726 ";color:${C['sun-d']}}
.lw-prompt{position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:none;pointer-events:auto;cursor:pointer;background:${C['brand-d']};color:${C['paper-0']};border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;box-shadow:${S.shadowDefault};padding:8px 14px;font-weight:700;font-size:calc(${T.scale.body.sizePx}px * var(--lcw-hs,1));min-height:${S.touchTargetMinPx}px;align-items:center;gap:8px}
.lw-prompt.on{display:flex}
.lw-goalmark{position:absolute;left:0;top:0;display:none;pointer-events:none;width:30px;height:30px;border-radius:50%;background:${C.sun};color:${C['ink-900']};border:${S.borderWidthPx}px solid ${C['ink-900']};box-shadow:${S.shadowDefault};font-family:${T.fonts.pixel};font-size:20px;line-height:26px;text-align:center}
.lw-goalmark.on{display:block}
.lw-goalmark i{display:block;font-style:normal;animation:lwhop 1.2s ease-in-out infinite}
@media (prefers-reduced-motion:reduce){.lw-goalmark i{animation:none}}
.lw-plate{position:absolute;left:0;top:0;transform:translate(-50%,-100%);display:none;background:${C['ink-900']};color:${C['paper-0']};border-radius:${S.radiusButtonPx}px;padding:2px 8px;font-family:${T.fonts.ui};font-size:calc(${T.scale.micro.sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale.micro.lineHeightPx}px * var(--lcw-hs,1));font-weight:700;opacity:.85;white-space:nowrap}
.lw-plate.on{display:block}
.lw-plate{transition:opacity 120ms linear}.lw-plate.under{opacity:.12}
.lw-prompt kbd{font-family:${T.fonts.pixel};background:${C['paper-0']};color:${C['ink-900']};border-radius:2px;padding:0 6px;font-size:12px}
.lw-prompt:active{box-shadow:${S.shadowPressed};transform:translate(-50%,-100%) translate(3px,3px)}
.lw-hotbar{position:absolute;bottom:12px;left:50%;transform:translateX(-50%);display:flex;gap:4px;align-items:center}
.lw-slot{width:56px;height:56px;background:${night};border:2px solid ${C['night-700']};border-radius:${S.radiusHudSlotPx}px;display:flex;align-items:center;justify-content:center;position:relative;cursor:pointer}
.lw-slot.empty{background:${C['night-900']}73}
.lw-slot.empty::after{content:"";position:absolute;inset:16px;border:2px dashed ${C.silver}8C;border-radius:${S.radiusHudSlotPx}px}
.lw-slot.sel{border-color:${C['paper-0']};box-shadow:0 0 0 2px ${C['ink-900']}}
.lw-slot .i{font-family:${T.fonts.pixel};font-size:12px;position:absolute;left:3px;top:2px;color:${C.silver}}
.lw-cap{position:absolute;bottom:80px;left:50%;transform:translateX(-50%);max-width:calc(100% - 32px);background:${night};color:${C['paper-0']};padding:4px 12px;border-radius:${S.radiusButtonPx}px;font-weight:700;font-size:calc(${T.scale.small.sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale.small.lineHeightPx}px * var(--lcw-hs,1));text-align:center;opacity:0;transition:opacity ${M.baseMs}ms ease-out;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lw-cap.on{opacity:1}
.lw-cap.two{white-space:pre-line;overflow-wrap:anywhere}
.lw-hud:has(.lw-touch.on) .lw-cap{max-width:max(160px, calc(100% - 2 * var(--lcw-hud-talk-w, 140px)))}
.lw-hud:has(.lw-cap.on.two) .lw-help{opacity:0}
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
.lw-cele .msg{font-size:calc(${T.scale.h2.sizePx}px * var(--lcw-hs,1));font-weight:800;opacity:0;padding:4px 16px}
.lw-cele .msg.go{opacity:1;transition:opacity ${M.baseMs}ms}
.lw-cele.out{opacity:0;transition:opacity 400ms ease-in}
.lw-fade{position:absolute;inset:0;background:${C['paper-50']};opacity:0;transition:opacity ${M.slowMs}ms ease-in-out;display:flex;align-items:center;justify-content:center}
.lw-fade.on{opacity:1}
.lw-fade .ttl{font-family:${T.fonts.pixel};font-size:48px;line-height:56px;padding:16px 32px;transform:translateY(8px)}
.lw-load{position:absolute;inset:0;background:${C['paper-50']};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;transition:opacity 500ms ease-out;pointer-events:auto}
.lw-load.done{opacity:0;pointer-events:none}
.lw-load .b{width:min(320px,70vw);height:20px;border:2px solid ${C['ink-900']};background:${C['paper-0']};box-shadow:${S.shadowDefault}}
.lw-load .b i{display:block;height:100%;width:0;background:var(--c-leaf,${C.leaf});transition:width 200ms}
.lw-load .h{font-size:calc(${T.scale.h2.sizePx}px * var(--lcw-hs,1));font-weight:800}
.lw-load .p{color:${C['ink-500']};font-size:calc(${T.scale.small.sizePx}px * var(--lcw-hs,1))}
.lw-load .cubes{display:flex;gap:6px}
.lw-load .cubes span{width:18px;height:18px;border:2px solid ${C['ink-900']};animation:lwhop 900ms ease-in-out infinite}
.lw-load .cubes span:nth-child(1){background:${C.brand}}
.lw-load .cubes span:nth-child(2){background:${C.sun};animation-delay:150ms}
.lw-load .cubes span:nth-child(3){background:var(--c-leaf,${C.leaf});animation-delay:300ms}
.lw-load .cubes span:nth-child(4){background:${C.sky};animation-delay:450ms}
@keyframes lwhop{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
.lw-help{position:absolute;bottom:calc(80px + 240px * (var(--lcw-hs,1) - 1));left:12px;white-space:pre-line;color:${C['paper-0']};background:${night};padding:6px 10px;border-radius:${S.radiusButtonPx}px;font-size:calc(${T.scale.micro.sizePx}px * var(--lcw-hs,1));transition:opacity 600ms}
.lw-help.off{opacity:0}
.lw-touch{position:absolute;inset:0;display:none}
.lw-touch.on{display:block}
.lw-stick{position:absolute;width:120px;height:120px;border-radius:50%;border:3px solid ${C['paper-0']};background:${C['night-900']}55;transform:translate(-50%,-50%);display:none}
.lw-stick.on{display:block}
.lw-stick i{position:absolute;left:50%;top:50%;width:52px;height:52px;border-radius:50%;background:${C['paper-0']};border:2px solid ${C['ink-900']};transform:translate(-50%,-50%)}
.lw-btn{position:absolute;pointer-events:auto;min-width:${S.gameButtonMinPx}px;height:${S.gameButtonMinPx}px;border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;box-shadow:${S.shadowDefault};background:${C['paper-50']};font-weight:800;font-size:calc(${T.scale.small.sizePx}px * var(--lcw-hs,1));padding:0 12px;display:flex;align-items:center;justify-content:center;touch-action:none}
.lw-btn:active,.lw-btn.down{box-shadow:${S.shadowPressed};transform:translate(3px,3px)}
.lw-btn.talk{height:${S.micButtonPx}px;min-width:${S.micButtonPx * 1.6}px;background:${C['brand-d']};color:${C['paper-0']};font-size:calc(${T.scale['body-l'].sizePx}px * var(--lcw-hs,1));display:none}
.lw-btn.talk.on{display:flex}
.lw-dir{position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity 800ms}
.lw-dir.on{opacity:1}
.lw-dir.blackout{background:${C['night-900']}A6}
.lw-dir.snow{background:radial-gradient(circle at 20% 30%,${C['paper-0']}CC 0 2px,transparent 3px) 0 0/48px 48px,radial-gradient(circle at 70% 60%,${C['paper-0']}AA 0 2px,transparent 3px) 0 0/64px 64px;animation:lwsnow 3s linear infinite}
@keyframes lwsnow{from{background-position:0 0,0 0}to{background-position:-48px 96px,32px 128px}}
.lw-fps{position:absolute;bottom:4px;right:4px;font-family:${T.fonts.pixel};font-size:12px;color:${C['paper-0']};background:${night};padding:2px 6px;display:none}
.lw-fps.on{display:block}
@media (max-width:600px),(max-height:500px){.lw-hud{--lcw-hs:min(var(--lcw-fs,1),1.15)}}
@media (max-width:600px){.lw-chip .gz{gap:6px}.lw-chip .gz b{width:calc(26px * var(--lcw-hs,1))}}
/* the lesson tag wraps under the status box on a phone (the chip leaves room for the stars): the goal card starts below it */
/* phones: the goal card starts under the status chip's real height (gauges, a wrapped lesson tag, the Korean help line) */

@media (max-width:600px){.lw-hud .lw-goal{top:calc(var(--lw-chip-b,74px) + 10px)}.lw-hud:has(.lw-touch.on) .lw-cap{left:12px;transform:none;max-width:calc(100% - 12px - var(--lw-jump,140px))}}
/* a short landscape screen keeps the goal card at the top centre: the tag sits under the status box, clear of the card */
@media (max-height:500px){.lw-chip{flex-direction:column;gap:6px}.lw-chip .l.on{max-width:var(--lw-chip-s-w,200px);white-space:normal}}
/* short landscape: the goal card sits between the status chip and the stars, with a smaller line so it stays short */
@media (max-height:500px){.lw-hud .lw-goal{max-width:calc(100% - 2 * var(--lw-side,200px));padding:6px 10px}.lw-hud .lw-goal .t{font-size:calc(${T.scale['body-l'].sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale['body-l'].lineHeightPx}px * var(--lcw-hs,1))}.lw-hud .lw-goal .g{font-size:calc(${T.scale.body.sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale.body.lineHeightPx}px * var(--lcw-hs,1))}}
@media (max-width:600px) and (max-height:500px){.lw-hud .lw-goal{max-width:none}}
@media (max-width:600px){.lw-slot{width:44px;height:44px}.lw-slot.empty::after{inset:13px}.lw-slot img{width:28px;height:28px}.lw-cap{bottom:64px;font-size:calc(${T.scale.micro.sizePx}px * var(--lcw-hs,1));line-height:calc(${T.scale.micro.lineHeightPx}px * var(--lcw-hs,1))}.lw-help{bottom:calc(96px + 100px * (var(--lcw-hs,1) - 1))}.lw-goal .t{font-size:calc(${T.scale.h3.sizePx}px * var(--lcw-hs,1))}.lw-chip .s{font-size:calc(${T.scale.micro.sizePx}px * var(--lcw-hs,1))}
.lw-goal{top:calc(68px + 56px * (var(--lcw-hs,1) - 1));left:12px;right:var(--lw-view-r,84px);max-width:none;transform:translate(0,-240%)}.lw-goal.on{transform:translate(0,0)}.lw-hud.off .lw-goal.on{transform:translate(0,calc(var(--lw-net-h,30px) + 2px))}}
@media (prefers-reduced-motion:reduce){.lw-chip .gz .low{animation:none}.lw-cele .st.go{animation:none;transform:scale(1)}.lw-dir.snow{animation:none}}
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

/**
 * A talk control fires on a still tap (lifted near where it went down), not on the press: a look drag that happens to
 * start on the button that just appeared turns the view, as it would one finger-width away (review R2625).
 */
function tapOnly(b: HTMLElement, fire: () => void, look: (dx: number, dy: number) => void): void {
  let down: { id: number; x: number; y: number; lx: number; ly: number; far: boolean } | null = null;
  b.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    down = { id: e.pointerId, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, far: false };
    b.setPointerCapture?.(e.pointerId);
  });
  b.addEventListener('pointermove', (e) => {
    if (!down || down.id !== e.pointerId) return;
    e.stopPropagation();
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 14) down.far = true;
    // a finger turns the view at touch speed; a mouse look is the canvas's own (pointer lock), not this button's
    if (down.far && e.pointerType !== 'mouse') look(e.clientX - down.lx, e.clientY - down.ly);
    down.lx = e.clientX;
    down.ly = e.clientY;
  });
  // pointerup bubbles on: the window's first-gesture sound unlock hears it, and the HUD root ignores a finger whose
  // pointerdown it never saw
  b.addEventListener('pointerup', (e) => {
    if (!down || down.id !== e.pointerId) return;
    const d = down;
    down = null;
    if (!d.far) fire();
  });
  b.addEventListener('pointercancel', (e) => {
    if (down && down.id === e.pointerId) down = null;
  });
}

/** Frame parts that stand in the HUD's top-right column, under its own parts (the 1PC teacher button). */
function rightColParts(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-hud-col="right"]'));
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
  private goalMark!: HTMLDivElement;
  private goalKey = '';
  private plate: HTMLDivElement;
  private slots: HTMLDivElement[] = [];
  /** item slot contents, kept while the hotbar shows build stacks */
  private itemSlots: Array<{ src: string; title: string } | null> = [null, null, null, null, null];
  private itemKeys: Array<string | null> = [null, null, null, null, null];
  private gz: HTMLElement | null = null;
  private gzOn = false;
  private noticeUntil = 0;
  private buildSlotsOn = false;
  private toast: HTMLDivElement;
  private toastTimer = 0;
  private cele: HTMLDivElement;
  private fade: HTMLDivElement;
  private fadeTitle: HTMLDivElement;
  private load: HTMLDivElement;
  private loadBar: HTMLElement;
  private help: HTMLDivElement;
  private talkKbd: HTMLElement | null = null;
  private keys: Readonly<KeyHintLabels> = DEFAULT_KEY_HINTS;
  private netText!: HTMLSpanElement;
  private net!: HTMLDivElement;
  /** Korean help switched (world/lang.ts): redraw the text built once */
  private offLang: (() => void) | null = null;

  private chipObs: ResizeObserver | null = null;
  private readonly onResizeNet = (): void => {
    if (this.root.classList.contains('off')) this.measureNet();
  };
  private touchOn = false;
  private measureSides: (() => void) | null = null;
  private jumpBtn: HTMLElement | null = null;
  private viewBtn: HTMLElement | null = null;
  private chipBox: HTMLElement | null = null;
  private hotbarEl: HTMLElement | null = null;
  private miniSeen = false;
  private walkSeen: HTMLElement | null = null;
  private onPart: (() => void) | null = null;
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
    this.chipBox = chip;
    // one compact chip, two lines: "중앙 광장 · 지상" over "맑음 10:30" (the lesson tag keeps its place next to it)
    const sc = el('span', 's', chip);
    this.sceneChip = el('span', 'p', sc);
    this.clockChip = el('span', 'w none', sc);
    el('i', '', this.clockChip);
    this.clockText = el('span', '', this.clockChip);
    this.gz = el('span', 'gz', sc);
    this.lessonChip = el('span', 'l', chip);
    this.lessonChip.textContent = W.lessonBadge;
    // G01 empty state: the connection dropped, the world keeps going on this device (docs/08 8.6).
    const net = el('div', 'lw-net', this.root);
    this.net = net;
    net.setAttribute('role', 'status');
    el('i', '', net);
    // the words are written only while offline: hidden text still read as "혼자 모드" to page-text checks
    this.netText = el('span', '', net);
    el('div', 'lw-aim', this.root);

    this.starsEl = el('div', 'lw-stars', this.root);
    // The goal card keeps clear of the status chip and the stars, both measured (they grow with the gauges, a wrapped
    // lesson tag and the Korean help line): under the chip on a phone (--lw-chip-b, its top is 12px), between the two on
    // a short landscape screen (--lw-side).
    if (typeof ResizeObserver !== 'undefined') {
      const stars = this.starsEl;
      const measure = (): void => {
        this.root.style.setProperty('--lw-chip-b', `${Math.ceil(12 + chip.offsetHeight)}px`);
        // the status box's own width: a long lesson / teacher tag under it wraps there instead of widening the chip
        // (667x375 with the teacher's name: the goal card between chip and stars fell to 61 px)
        const sBox = chip.querySelector<HTMLElement>('.s');
        if (sBox && sBox.offsetWidth > 0) this.root.style.setProperty('--lw-chip-s-w', `${Math.ceil(Math.max(160, sBox.offsetWidth))}px`);
        // on touch the talk button (it comes and goes by the NPC) keeps its column free too
        // the right column under the stars: the view button (touch) and the minimap when it sits there (touch portrait,
        // tablet; world/minimap-place.ts), measured: the goal card keeps clear of both
        let colW = this.touchOn && this.viewBtn && this.viewBtn.offsetWidth > 0 ? this.viewBtn.offsetWidth : 0;
        const mini = this.root.querySelector<HTMLElement>('.lw-mini');
        if (mini && mini.offsetWidth > 0) {
          if (!this.miniSeen) {
            this.miniSeen = true;
            this.chipObs?.observe(mini);
          }
          const rr = this.root.getBoundingClientRect();
          const b = mini.getBoundingClientRect();
          if (b.left - rr.left > rr.width / 2 && b.top - rr.top < rr.height / 2) colW = Math.max(colW, rr.right - b.left - 12);
        }
        // parts the frame puts in this column (the 1PC teacher button, lesson/TeacherPanel.tsx: data-hud-col="right")
        for (const e of rightColParts()) {
          const b = e.getBoundingClientRect();
          if (b.width > 0) colW = Math.max(colW, this.root.getBoundingClientRect().right - b.left - 12);
        }
        const viewR = colW > 0 ? 12 + colW + 8 : 12;
        const talkR = this.placeTalk();
        // the talk button only shares the goal card's height on a short landscape screen
        const short = this.root.clientHeight <= 500;
        const talk = this.touchOn && short ? talkR + Math.max(this.talkBtn?.offsetWidth ?? 0, S.micButtonPx * 1.6) : 0;
        const side = Math.max(chip.offsetLeft + chip.offsetWidth, this.root.clientWidth - stars.offsetLeft, talk);
        if (stars.offsetWidth > 0) this.root.style.setProperty('--lw-side', `${Math.ceil(side + 8)}px`);
        // a mid-width screen where the chip (with a lesson / teacher tag) and the stars leave the goal card under 360 px
        // between them: the card goes under them at full width (review of #160: 768-950 wide squeezed it to nothing)
        const width = this.root.clientWidth;
        this.root.style.setProperty('--lw-top-b', `${Math.ceil(Math.max(chip.offsetTop + chip.offsetHeight, stars.offsetTop + stars.offsetHeight))}px`);
        this.root.classList.toggle('goal-low', width > 600 && !short && stars.offsetWidth > 0 && width - 2 * (side + 8) < 360);
        // on a phone the hotbar line (two lines with the Korean help, or wrapped) reaches the jump button's height: it
        // sits left and keeps the jump column free (right 24px + its measured width)
        if (this.jumpBtn && this.jumpBtn.offsetWidth > 0) this.root.style.setProperty('--lw-jump', `${Math.ceil(24 + this.jumpBtn.offsetWidth + 8)}px`);
        // the view button (touch, top right under the stars) keeps its column free of the phone goal card
        this.root.style.setProperty('--lw-view-r', `${Math.ceil(viewR)}px`);
        this.measureStacks();
      };
      this.measureSides = measure;
      this.chipObs = new ResizeObserver(measure);
      this.chipObs.observe(chip);
      this.chipObs.observe(stars);
      this.chipObs.observe(this.root);
      // a frame part placed by these measures came or went (TeacherPanel): measure, and follow its size from now on
      this.onPart = () => {
        for (const e of rightColParts()) this.chipObs?.observe(e);
        measure();
      };
      window.addEventListener(HUD_PART_EVENT, this.onPart);
    }

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
    this.goalMark = el('div', 'lw-goalmark', this.root);
    this.goalMark.setAttribute('aria-hidden', 'true');
    el('i', '', this.goalMark).textContent = '!';
    this.prompt = el('div', 'lw-prompt', this.root);
    this.prompt.innerHTML = '';
    // its size is cached for the per-frame placement; a text size or key change resizes it: read it again then
    if (typeof ResizeObserver !== 'undefined') {
      this.promptObs = new ResizeObserver(() => {
        this.promptSize = null;
      });
      this.promptObs.observe(this.prompt);
    }
    const kbd = el('kbd', '', this.prompt);
    kbd.textContent = W.talkKey;
    this.talkKbd = kbd;
    const pl = el('span', '', this.prompt);
    pl.textContent = W.talk;
    tapOnly(this.prompt, () => this.h.onTalk(), (dx, dy) => this.h.onLook(dx, dy));

    const bar = el('div', 'lw-hotbar', this.root);
    this.hotbarEl = bar;
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
    this.cap.addEventListener('transitionend', () => this.measureStacks());
    this.selectSlot(0, false);

    this.toast = el('div', 'lw-toast lw-card', this.root);
    this.cele = el('div', 'lw-cele', this.root);
    this.help = el('div', 'lw-help', this.root);
    for (const e of [this.goal, this.cap, this.help]) this.chipObs?.observe(e);
    this.offLang = onLearnLang(() => this.redrawFrameText());
    window.addEventListener('resize', this.onResizeNet);

    // Touch layer (docs/08 7.2): left half stick, right half look, buttons on the right.
    this.touch = el('div', 'lw-touch', this.root);
    this.stick = el('div', 'lw-stick', this.touch);
    this.stickKnob = el('i', '', this.stick);
    const jump = el('div', 'lw-btn jump', this.touch);
    this.jumpBtn = jump;
    this.chipObs?.observe(jump);
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
    this.viewBtn = view;
    this.chipObs?.observe(view);
    view.textContent = W.view;
    view.style.right = '12px';
    view.style.top = '60px';
    view.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.h.onView();
    });
    this.talkBtn = el('div', 'lw-btn talk', this.touch);
    this.talkBtn.textContent = W.talk;
    this.talkBtn.style.right = '96px'; // placeTalk() moves it off the view / jump column where they meet
    // the touch layer starts under the connection band while offline: its size changes, the talk button is placed again
    this.chipObs?.observe(this.touch);
    this.chipObs?.observe(this.talkBtn);
    this.talkBtn.style.bottom = '160px';
    tapOnly(this.talkBtn, () => this.h.onTalk(), (dx, dy) => this.h.onLook(dx, dy));
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

  /** The player's own keys (G14 키 바꾸기) in the talk prompt and the desktop help line; quiet (no re-show). */
  setKeyHints(k: Readonly<KeyHintLabels>): void {
    this.keys = k;
    this.promptSize = null;
    if (this.talkKbd) this.talkKbd.textContent = k.talk;
    if (!this.touchOn) this.help.textContent = this.helpText();
  }

  setTouch(on: boolean): void {
    this.touchOn = on;
    this.touch.classList.toggle('on', on);
    this.measureSides?.();
    this.touch.style.pointerEvents = on ? 'auto' : 'none';
    this.help.textContent = this.helpText();
    this.help.classList.remove('off');
    window.setTimeout(() => {
      this.help.classList.add('off');
      this.measureStacks();
    }, 9000);
  }

  setTouchPaused(paused: boolean): void {
    this.touch.style.visibility = paused ? 'hidden' : 'visible';
  }

  setLoading(fraction: number, done: boolean): void {
    this.loadBar.style.width = `${Math.round(Math.min(1, fraction) * 100)}%`;
    if (done && !this.load.classList.contains('done')) {
      this.load.classList.add('done');
      // an all-empty bar says what it is for once, so five dark boxes never read as unfinished
      if (this.allEmpty() && performance.now() > this.noticeUntil) this.showCaption(6000);
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
    this.drawNet(on);
    this.measureStacks();
  }

  /** The band's words only while offline; with the Korean help on, the Korean on a line of its own under the English. */
  private drawNet(on: boolean): void {
    if (on) {
      this.netText.textContent = '';
      return;
    }
    const s = worldSay('offlineBand');
    this.netText.textContent = s.help ? `${s.text}\n${s.help}` : s.text;
    this.measureNet();
  }

  /**
   * One line where it fits; a longer band (the Korean help line) wraps, and the chips, goal card and touch layer move
   * down by its real height (--lw-net-h) instead of sliding under it.
   */
  private measureNet(): void {
    requestAnimationFrame(() => {
      const h = this.net.getBoundingClientRect().height;
      if (h > 0) this.root.style.setProperty('--lw-net-h', `${Math.ceil(h)}px`);
      this.measureStacks();
    });
  }

  /** Camera mode from the world: the centre crosshair shows only in first person (hidden under a dialog). */
  setCamMode(mode: 'first' | 'third' | 'mirror'): void {
    this.root.classList.toggle('first', mode === 'first');
  }

  private drawScene(): void {
    const p = this.bandId ? placeBi(this.sceneTitle, this.bandId) : { en: this.sceneTitle, ko: null };
    this.sceneChip.textContent = p.en;
    // the Korean help as a small line of its own: a dot join made the chip run into the stars on a phone
    if (p.ko) el('span', 'ko', this.sceneChip).textContent = p.ko;
  }

  /** The controls line, its Korean help on a second line (white-space: pre-line). */
  private helpText(): string {
    const s = this.touchOn ? { en: worldSay('controlsTouch').text, ko: worldSay('controlsTouch').help } : controlsDesktopBi(this.keys);
    return s.ko ? `${s.en}\n${s.ko}` : s.en;
  }

  private allEmpty(): boolean {
    return !this.buildSlotsOn && this.itemSlots.every((x) => x === null);
  }

  /** Name of the selected slot over the bar (or what an empty bar is for); fades after `ms`. */
  private showCaption(ms = 2400): void {
    // English on the line, the Korean help on a line of its own (a dot join ran into the controls help)
    const held = this.buildSlotsOn ? null : this.itemKeys[this.selected];
    let en: string;
    let ko: string | null = null;
    if (this.buildSlotsOn) en = this.slots[this.selected]?.title ?? '';
    else if (held) ({ en, ko } = itemTitleBi(held));
    else ({ text: en, help: ko } = worldSay(this.allEmpty() ? 'hotbarAllEmpty' : 'hotbarEmpty'));
    const r = held && this.gzOn ? refillOf(held) : null;
    if (r) {
      const u = worldSay(r.kind === 'food' ? 'useAgainFood' : 'useAgainDrink');
      en = `${en} · ${u.text}`;
      if (ko !== null && u.help) ko = `${ko} · ${u.help}`;
    }
    window.clearTimeout(this.capTimer);
    if (!en) {
      this.cap.classList.remove('on');
      this.measureStacks();
      return;
    }
    this.putCap(ko ? `${en}\n${ko}` : en, ms);
  }

  /**
   * The line over the bar: Korean help on a line of its own, and a line too long for the width (150% text, a long
   * notice on a phone) wraps instead of being cut with an ellipsis. Either way the controls help under it steps aside
   * (.two), and the stacks other layers place by are measured again while it shows and after it fades.
   */
  private putCap(text: string, ms: number): void {
    window.clearTimeout(this.capTimer);
    this.cap.textContent = text;
    const two = text.includes('\n');
    this.cap.classList.toggle('two', two);
    if (!two && this.cap.scrollWidth > this.cap.clientWidth + 1) this.cap.classList.add('two');
    this.cap.classList.add('on');
    this.measureStacks();
    this.capTimer = window.setTimeout(() => {
      this.cap.classList.remove('on');
      this.measureStacks();
    }, ms);
  }

  /**
   * G01 게이지 (docs/03 D1): hunger and thirst bars on the status chip, red and pulsing at 20% or less, "느려짐" while
   * walking is slower. null hides them (the frame decides when they run).
   */
  setGauges(g: { hunger: number; thirst: number; lowHunger: boolean; lowThirst: boolean; slow: boolean } | null): void {
    const gz = this.gz;
    if (!gz) return;
    this.gzOn = g !== null;
    this.root.classList.toggle('gz', this.gzOn);
    gz.classList.toggle('on', this.gzOn);
    if (!g) return;
    if (!gz.firstChild) {
      for (const [cls, icon, label] of [['h', '🍞', W.hunger], ['t', '💧', W.thirst]] as const) {
        const s = el('span', cls, gz);
        s.setAttribute('role', 'meter');
        s.setAttribute('aria-label', label);
        s.setAttribute('aria-valuemin', '0');
        s.setAttribute('aria-valuemax', '100');
        el('span', '', s).textContent = icon;
        el('i', '', el('b', '', s));
      }
      el('em', '', gz).textContent = W.slowed;
    }
    const [h, t] = [gz.children[0] as HTMLElement, gz.children[1] as HTMLElement];
    const put = (s: HTMLElement, v: number, low: boolean): void => {
      const p = Math.round(Math.min(100, Math.max(0, v)));
      (s.querySelector('b i') as HTMLElement).style.width = `${p}%`;
      s.setAttribute('aria-valuenow', String(p));
      s.classList.toggle('low', low);
    };
    put(h, g.hunger, g.lowHunger);
    put(t, g.thirst, g.lowThirst);
    gz.classList.toggle('slow', g.slow);
  }

  /** A one-off line over the bar (ate, drank, "a bit later"): same place and fade as the slot caption. */
  notice(text: string, ms = 2400): void {
    this.noticeUntil = performance.now() + ms;
    // a notice with its Korean help line under it (frame useGauges, world/strings worldSay) keeps both lines
    this.putCap(text, ms);
  }

  /**
   * The talk button (touch; it comes and goes by the NPC) sits 96px from the right, 160px up. Where that spot meets the
   * view button (pushed down by the connection band on a short landscape screen) or the jump button, it steps left of
   * that column. Returns its right offset; the width it takes from the right on its row is published on :root
   * (--lcw-hud-talk-w) for the dialog walk button on the same row.
   */
  private placeTalk(): number {
    const doc = document.documentElement.style;
    const btn = this.talkBtn;
    if (!this.touchOn || !btn) {
      doc.setProperty('--lcw-hud-talk-w', '12px');
      return 96;
    }
    const rr = this.root.getBoundingClientRect();
    const width = rr.width;
    const w = Math.max(btn.offsetWidth, S.micButtonPx * 1.6);
    const h = btn.offsetHeight || S.micButtonPx;
    const top = this.touch.getBoundingClientRect().bottom - rr.top - 160 - h;
    let right = 96;
    for (let pass = 0; pass < 2; pass++) {
      for (const col of [this.viewBtn, this.jumpBtn]) {
        if (!col || col.offsetWidth === 0) continue;
        const b = col.getBoundingClientRect();
        const l = width - right - w;
        const meets = top < b.bottom - rr.top + 8 && top + h + 8 > b.top - rr.top && l < b.right - rr.left + 8 && width - right + 8 > b.left - rr.left;
        if (meets) right = width - (b.left - rr.left) + 8;
      }
    }
    btn.style.right = `${Math.ceil(right)}px`;
    doc.setProperty('--lcw-hud-talk-w', `${Math.ceil(right + w + 8)}px`);
    return right;
  }

  private cover: Array<readonly [number, number, number, number]> = [];
  private coverAt = -1e9;
  private plateSizes = new WeakMap<HTMLElement, { t: string; w: number; h: number }>();

  /** Boxes of the screen parts (root coordinates), read at most four times a second for the world labels under them. */
  private hudCover(): ReadonlyArray<readonly [number, number, number, number]> {
    const now = performance.now();
    if (now - this.coverAt < 250) return this.cover;
    this.coverAt = now;
    const rr = this.root.getBoundingClientRect();
    const parts: Array<Element | null> = [this.chipBox, this.starsEl, this.goal.classList.contains('on') ? this.goal : null, this.help, this.cap.classList.contains('on') ? this.cap : null, this.net, this.hotbarEl];
    if (this.touchOn) parts.push(this.viewBtn, this.jumpBtn, this.talkBtn);
    // the frame's own buttons on the HUD layer (menu), and anything another layer marks as a screen part
    parts.push(...Array.from(document.querySelectorAll('.lcw-hudbtn, .lw-mini, [data-hud-part]')));
    this.cover = [];
    for (const e of parts) {
      if (!e) continue;
      const b = e.getBoundingClientRect();
      if (b.width < 2 || b.height < 2 || Number(getComputedStyle(e).opacity) < 0.05) continue;
      this.cover.push([b.left - rr.left, b.top - rr.top, b.right - rr.left, b.bottom - rr.top]);
    }
    return this.cover;
  }

  /** Whether a screen box (root coordinates) runs under a HUD part: a world label there fades instead of showing through. */
  underHud(x0: number, y0: number, x1: number, y1: number): boolean {
    return coverHits(this.hudCover(), x0, y0, x1, y1);
  }

  /** A world name plate (mine, other people's) at its anchor: fades under a screen part (frame, 11-18 prod shot). */
  fadePlate(el: HTMLElement, sx: number, sy: number): void {
    const t = el.textContent ?? '';
    let s = this.plateSizes.get(el);
    if (!s || s.t !== t || s.w === 0) {
      s = { t, w: el.offsetWidth, h: el.offsetHeight };
      this.plateSizes.set(el, s);
    }
    el.classList.toggle('under', this.underHud(sx - s.w / 2, sy - s.h, sx + s.w / 2, sy));
  }

  /** A panel covers the bottom (dialog window): the goal card steps aside so the NPC's face shows in the strip. */
  setDialogOpen(on: boolean): void {
    this.root.classList.toggle('dlg', on);
    this.measureStacks();
  }

  /**
   * Two page-wide values other layers place by (frame domain owns the layout of the child screen, docs/08 8.6):
   * --lcw-hud-stack = how far up from the bottom the bottom-left stack reaches (controls help, hotbar line), so a walk
   * button sits above it; --lcw-hud-top-b = where the top stack ends (the goal card when it shows, else the status
   * chip and the stars), so a toast sits under it. Measured on resize, text changes and goal changes.
   */
  private measureStacks(): void {
    const h = this.root.clientHeight;
    if (!h) return;
    let stack = 0;
    // the caption only while it shows (a faded one keeps its last text and height)
    // the controls help only until it fades (.off, 9 s after touch starts)
    // (and while it is still fading out: the walk button waits for the fade, transitionend measures again)
    const capShows = this.cap.classList.contains('on') || Number(getComputedStyle(this.cap).opacity) > 0.05;
    for (const e of [this.help.classList.contains('off') ? null : this.help, capShows ? this.cap : null]) {
      if (e && e.offsetHeight > 0 && getComputedStyle(e).display !== 'none') stack = Math.max(stack, h - e.offsetTop);
    }
    // never lower than the hotbar and the frame's bottom buttons (menu): with the help faded and no caption the stack
    // fell to 0 and the walk button sat on the hotbar
    const rr = this.root.getBoundingClientRect();
    for (const e of [this.hotbarEl, ...Array.from(document.querySelectorAll('.lcw-hudbtn'))]) {
      if (!e) continue;
      const b = e.getBoundingClientRect();
      if (b.height > 0 && b.top > rr.top + h / 2) stack = Math.max(stack, rr.bottom - b.top);
    }
    let top = [this.chipBox, this.starsEl].reduce((m, e) => (e && e.offsetHeight > 0 ? Math.max(m, e.offsetTop + e.offsetHeight) : m), 0);
    // the goal card moves down under the connection band by a transform, which offsetTop does not see
    const off = this.root.classList.contains('off');
    const netH = off ? parseFloat(this.root.style.getPropertyValue('--lw-net-h')) || 30 : 0;
    if (this.goal.classList.contains('on') && this.goal.offsetHeight > 0) top = Math.max(top, this.goal.offsetTop + this.goal.offsetHeight + (off ? netH + 2 : 0));
    const doc = document.documentElement.style;
    doc.setProperty('--lcw-hud-stack', `${Math.ceil(stack)}px`);
    doc.setProperty('--lcw-hud-top-b', `${Math.ceil(top)}px`);
    // the right column under the stars (view button on touch, the minimap when it sits up there): the review dock starts
    // under it and under the goal card (R2722 / the frame check: the dock lay over the stars, minimap and goal card)
    let right = this.starsEl && this.starsEl.offsetHeight > 0 ? this.starsEl.offsetTop + this.starsEl.offsetHeight : 0;
    const rb = this.root.getBoundingClientRect();
    for (const e of [this.touchOn ? this.viewBtn : null, this.root.querySelector<HTMLElement>('.lw-mini')]) {
      if (!e || e.offsetWidth === 0) continue;
      const b = e.getBoundingClientRect();
      if (b.left - rb.left > rb.width / 2 && b.top - rb.top < rb.height / 2) right = Math.max(right, b.bottom - rb.top);
    }
    // the HUD's own column ends here: the frame's parts in it (1PC teacher button) stack under it, the dock under them
    doc.setProperty('--lcw-hud-col-b', `${Math.ceil(right)}px`);
    for (const e of rightColParts()) {
      const b = e.getBoundingClientRect();
      if (b.height > 0) right = Math.max(right, b.bottom - rb.top);
    }
    doc.setProperty('--lcw-hud-right-b', `${Math.ceil(right)}px`);
    // the dialog walk button (left, above the bottom stack) steps right of a minimap that sits top-left on a short
    // landscape screen when they would meet (667x375 with the lesson tag)
    let walkL = 12;
    const mini = this.root.querySelector<HTMLElement>('.lw-mini');
    const walk = document.querySelector<HTMLElement>('.lcw-goal-walk, .lcw-errand-walk');
    // nit 3: the walk button wraps to two lines once it steps right; follow its height (it is React's, it comes and goes)
    if (walk !== this.walkSeen) {
      if (this.walkSeen) this.chipObs?.unobserve(this.walkSeen);
      if (walk) this.chipObs?.observe(walk);
      this.walkSeen = walk;
    }
    if (mini && mini.offsetWidth > 0 && !this.root.classList.contains('dlg')) {
      const b = mini.getBoundingClientRect();
      const walkTop = h - stack - 12 - (walk?.offsetHeight || 48);
      // a minimap on the left half is the landscape one (portrait and mouse put it right); the band pushes it below
      // the middle of a short screen, so no top-half test
      if (b.left - rb.left < rb.width / 2 && walkTop < b.bottom - rb.top + 8 && walkTop + (walk?.offsetHeight || 48) > b.top - rb.top - 8) walkL = b.right - rb.left + 8;
    }
    doc.setProperty('--lcw-hud-walk-l', `${Math.ceil(walkL)}px`);
  }

  setGoal(goalKo: string, targetEn?: string): void {
    const on = goalKo.trim().length > 0 || !!targetEn;
    this.goalG.textContent = goalKo;
    this.goalT.textContent = targetEn ?? '';
    this.goalT.style.display = targetEn ? 'block' : 'none';
    this.goal.classList.toggle('on', on);
    // the sides too (the minimap may have joined the HUD since the last resize); they measure the stacks as well
    if (this.measureSides) this.measureSides();
    else this.measureStacks();
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

  /** Teacher name tag on the lesson chip: "<name> 함께" or "혼자 놀기"; null = the plain "수업 중" tag. */
  setTeacher(t: { present: boolean; name: string | null } | null): void {
    this.lessonChip.classList.toggle('solo', Boolean(t && !t.present));
    this.lessonChip.dataset.teacher = t === null ? '' : t.present ? 'present' : 'absent';
    this.lessonChip.textContent = t === null ? W.lessonBadge : t.present ? W.teacherWith(t.name) : W.solo;
  }

  selectSlot(i: number, caption = true): void {
    this.selected = i;
    this.slots.forEach((s, k) => s.classList.toggle('sel', k === i));
    if (caption) this.showCaption();
  }

  putItem(slot: number, key: string): void {
    const s = this.slots[slot];
    if (!s) return;
    this.itemSlots[slot] = { src: itemIconDataUrl(key), title: itemTitle(key) };
    this.itemKeys[slot] = key;
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
    tt.textContent = itemGotText(key);
    this.toast.appendChild(tt);
    this.toast.classList.add('on');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove('on'), 2600);
  }

  /** Put the server's bag into a slot quietly (start of play, after a move in the bag screen): no toast, no select. */
  setItem(slot: number, key: string | null): void {
    if (!this.slots[slot]) return;
    this.itemSlots[slot] = key ? { src: itemIconDataUrl(key), title: itemTitle(key) } : null;
    this.itemKeys[slot] = key;
    if (!this.buildSlotsOn) this.drawSlot(slot, this.itemSlots[slot] ?? null, null);
    // the "bag is empty" line from the start must not stay over a bag that just filled
    if (key && this.cap.textContent === W.hotbarAllEmpty) this.cap.classList.remove('on');
  }

  /** Empty an item slot (the item was handed over); the build bar keeps drawing while building is on. */
  clearItem(slot: number): void {
    if (!this.slots[slot]) return;
    this.itemSlots[slot] = null;
    this.itemKeys[slot] = null;
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
      // a speaker under a HUD part (status chip, goal card, minimap, hotbar): the line moves just clear of it instead of
      // running under it (the frame check found Luna's greeting under the minimap on a phone)
      const cover = this.hudCover();
      const half = this.root.clientHeight / 2;
      for (let guard = 0; guard < 4; guard++) {
        const hit = cover.find(([l, t, r, bt]) => b.sx - w / 2 < r && b.sx + w / 2 > l && y - h < bt && y > t);
        if (!hit) break;
        y = hit[1] < half ? hit[3] + gap + h : hit[1] - gap;
      }
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
    if (visible) this.fadePlate(this.plate, sx, sy);
  }

  private promptKey = '';

  /** The "talk to me next" marker over the goal NPC (every frame; DOM only on change). */
  showGoalMark(on: boolean, sx = 0, sy = 0): void {
    const key = on ? `${Math.round(sx)}:${Math.round(sy)}` : 'off';
    if (key === this.goalKey) return;
    this.goalKey = key;
    this.goalMark.classList.toggle('on', on);
    if (on) this.goalMark.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px) translate(-50%, -100%)`;
  }

  /** Called every frame: touches the DOM only when something changed (whole pixels), so idle frames cost no style work. */
  showPrompt(on: boolean, sx = 0, sy = 0, touch = false): void {
    const x = Math.round(sx);
    const y = Math.round(sy);
    // the HUD under it can change while the speaker stands still (goal card slides in): the cover's read time is part
    // of the key, so the prompt is placed again up to four times a second
    if (on && !touch) this.hudCover();
    const key = on ? `${touch ? 't' : 'k'}:${x}:${y}:${on && !touch ? this.coverAt : 0}` : 'off';
    if (key === this.promptKey) return;
    this.promptKey = key;
    this.prompt.classList.toggle('on', on && !touch);
    this.talkBtn.classList.toggle('on', on && touch);
    if (!on) return;
    let py = y;
    if (!touch) {
      // clear of the HUD parts like the bubbles (900 wide: the goal card under the chip covered the NPC's head)
      if (!this.promptSize || this.promptSize.w === 0) this.promptSize = { w: this.prompt.offsetWidth, h: this.prompt.offsetHeight };
      const { w, h } = this.promptSize;
      const cover = this.hudCover();
      const half = this.root.clientHeight / 2;
      for (let guard = 0; guard < 4; guard++) {
        const hit = cover.find(([l, t, r, b]) => x - w / 2 < r && x + w / 2 > l && py - h < b && py > t);
        if (!hit) break;
        py = hit[1] < half ? hit[3] + 6 + h : hit[1] - 6;
      }
    }
    this.prompt.style.transform = `translate(${x}px, ${py}px) translate(-50%, -100%)`;
  }

  private promptSize: { w: number; h: number } | null = null;
  private promptObs: ResizeObserver | null = null;

  director(kind: 'blackout' | 'snow' | null): void {
    this.dirLayer.className = `lw-dir${kind ? ` on ${kind}` : ''}`;
    this.weather = kind === 'snow' ? 'snow' : 'clear';
    this.clockKey = '';
  }

  setFps(text: string | null): void {
    this.fpsEl.classList.toggle('on', text !== null);
    if (text) this.fpsEl.textContent = text;
  }

  /** Redraw the frame's HUD text that is built once (band, help line, gauge names, place line, clock, caption). */
  private redrawFrameText(): void {
    this.drawNet(!this.root.classList.contains('off'));
    if (this.help.textContent) this.help.textContent = this.helpText();
    if (this.bandId) this.drawScene();
    this.clockKey = '';
    const gz = this.gz;
    if (gz?.firstChild) {
      gz.children[0]?.setAttribute('aria-label', W.hunger);
      gz.children[1]?.setAttribute('aria-label', W.thirst);
      const em = gz.querySelector('em');
      if (em) em.textContent = W.slowed;
    }
    // the hotbar names follow the help switch too (they were built when the thing arrived)
    this.itemKeys.forEach((key, i) => {
      const it = this.itemSlots[i];
      if (!key || !it) return;
      it.title = itemTitle(key);
      if (!this.buildSlotsOn) this.drawSlot(i, it, null);
    });
    if (this.cap.classList.contains('on')) this.showCaption();
  }

  dispose(): void {
    this.offLang?.();

    this.chipObs?.disconnect();
    this.promptObs?.disconnect();
    if (this.onPart) window.removeEventListener(HUD_PART_EVENT, this.onPart);
    window.removeEventListener('resize', this.onResizeNet);
    this.root.remove();
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
