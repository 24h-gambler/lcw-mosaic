/**
 * Stylesheet for the public site (docs/14), generated from @lcw/ui tokens so no colour literal lives here
 * (AGENTS.md 6). Classes are prefixed `s-` to stay out of the way of the in-app screens.
 */
import { TOKENS } from '@lcw/ui';

const C = TOKENS.colors;
const T = TOKENS.typography.scale;
const M = TOKENS.motion;
const S = TOKENS.shape;

const type = (k: keyof typeof T) => `font-size:${T[k].sizePx}px;line-height:${T[k].lineHeightPx}px;`;

export const SITE_BREAKPOINT_PX = 900;
export const SITE_PHONE_PX = 600;

export function siteCss(): string {
  return `
.s-root{background:${C['paper-50']};color:${C['ink-900']};font-family:${TOKENS.typography.fonts.ui};${type('body')}min-height:100vh;-webkit-font-smoothing:antialiased;overflow-x:clip;word-break:keep-all;overflow-wrap:anywhere}
.s-root *,.s-root *::before,.s-root *::after{box-sizing:border-box}
.s-root h1,.s-root h2,.s-root h3,.s-root p,.s-root ul,.s-root ol,.s-root figure{margin:0}
.s-root a{color:${C['sky-d']};text-underline-offset:3px}
.s-root :focus-visible{outline:${S.focusOutlineWidthPx}px solid ${C['sky-d']};outline-offset:2px}
.s-skip{position:absolute;left:-9999px;top:8px;z-index:50;background:${C['paper-0']};padding:8px 12px;border:2px solid ${C['ink-900']}}
.s-skip:focus{left:16px}
.s-wrap{max-width:${S.dashboardMaxWidthPx}px;margin:0 auto;padding:0 ${S.dashboardGutterPx}px}
.s-display{${type('display')}font-weight:800;letter-spacing:-0.02em}
.s-h1{${type('h1')}font-weight:800;letter-spacing:-0.01em}
.s-h2{${type('h2')}font-weight:800}
.s-h3{${type('h3')}font-weight:700}
.s-lead{${type('body-l')}color:${C['ink-700']}}
.s-small{${type('small')}color:${C['ink-500']}}
.s-micro{${type('micro')}}
.s-en{font-family:${TOKENS.typography.fonts.target};${type('h3')}font-weight:700}
.s-en-sm{font-family:${TOKENS.typography.fonts.target};font-weight:700}
.s-pixel{font-family:${TOKENS.typography.fonts.pixel};letter-spacing:0.02em}
.s-eyebrow{display:inline-flex;align-items:center;gap:8px;${type('small')}font-weight:700;color:${C['brand-d']};margin-bottom:12px}
.s-eyebrow::before{content:"";width:12px;height:12px;background:${C.brand};border:2px solid ${C['ink-900']}}
.s-stack{display:grid;gap:16px}
.s-row{display:flex;flex-wrap:wrap;gap:12px;align-items:center}
.s-muted{color:${C['ink-700']}}

/* header */
.s-head{position:sticky;top:0;z-index:20;background:${C['paper-50']};border-bottom:2px solid ${C['ink-900']}}
.s-head-in{display:flex;align-items:center;gap:16px;height:64px}
.s-logo{display:inline-flex;align-items:center;gap:8px;font-weight:800;color:${C['ink-900']};text-decoration:none;${type('body-l')}}
.s-logo-mark{display:grid;grid-template-columns:repeat(2,10px);grid-template-rows:repeat(2,10px);gap:2px}
.s-logo-mark i{display:block;border:2px solid ${C['ink-900']}}
.s-logo-mark i:nth-child(1){background:${C.brand}}.s-logo-mark i:nth-child(2){background:${C.sun}}
.s-logo-mark i:nth-child(3){background:${C.sky}}.s-logo-mark i:nth-child(4){background:${C.leaf}}
.s-nav{display:flex;gap:4px;margin-left:auto;align-items:center}
.s-nav a{display:inline-flex;align-items:center;min-height:${S.touchTargetMinPx}px;padding:0 12px;color:${C['ink-900']};text-decoration:none;font-weight:700;border-radius:${S.radiusButtonPx}px}
.s-nav a:hover{background:${C['paper-100']}}
.s-nav a[aria-current="page"]{background:${C['paper-100']};box-shadow:inset 0 -3px 0 ${C.brand}}
.s-btn.s-menu-btn{display:none;margin-left:8px}
.s-mnav{display:none}

/* buttons */
.s-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:${S.touchTargetMinPx}px;padding:10px 20px;border:${S.borderWidthPx}px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;box-shadow:${S.shadowDefault};font:inherit;font-weight:800;text-decoration:none;cursor:pointer;transition:transform ${M.fastMs}ms ease-out,box-shadow ${M.fastMs}ms ease-out;background:${C['paper-0']};color:${C['ink-900']}}
.s-btn:active{transform:translate(3px,3px);box-shadow:${S.shadowPressed}}
.s-btn[disabled]{cursor:default;opacity:.55;box-shadow:none;transform:none}
.s-btn-brand{background:${C['brand-d']};color:${C['paper-0']}}
.s-btn-sky{background:${C['sky-d']};color:${C['paper-0']}}
.s-btn-leaf{background:${C['leaf-d']};color:${C['paper-0']}}
.s-btn-sun{background:${C.sun};color:${C['ink-900']}}
.s-btn-lg{min-height:${S.gameButtonMinPx}px;padding:12px 24px;${type('body-l')}font-weight:800}
.s-btn-mic{min-height:${S.micButtonPx}px;min-width:${S.micButtonPx}px;max-width:100%;white-space:normal;text-align:left;padding:12px 28px;${type('body-l')}font-weight:800}
.s-btn-ghost{background:transparent;box-shadow:none;border-color:transparent;text-decoration:underline;color:${C['ink-700']};font-weight:700}
.s-btn-ghost:active{transform:none;box-shadow:none}
.s-btn-icon{width:${S.touchTargetMinPx}px;padding:0}
.s-root a.s-btn{color:inherit}
.s-root a.s-btn-brand,.s-root a.s-btn-sky,.s-root a.s-btn-leaf{color:${C['paper-0']}}

/* surfaces */
.s-card{background:${C['paper-0']};border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;box-shadow:${S.shadowDefault};padding:24px}
.s-card-flat{background:${C['paper-0']};border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;padding:16px}
.s-tint{background:${C['paper-100']}}
.s-night{background:${C['night-900']};color:${C['paper-0']}}
.s-sec{padding:64px 0;border-top:2px solid ${C['ink-900']}}
.s-sec-tint{background:${C['paper-100']}}
.s-sec-head{display:grid;gap:12px;margin-bottom:32px;max-width:720px}
.s-tag{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border:2px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;${type('micro')}font-weight:800;background:${C['paper-0']}}
.s-tag-sample{background:${C.sun};color:${C['ink-900']}}
.s-tag-leaf{background:${C.leaf}}
.s-tag-sky{background:${C.sky}}
.s-grid-2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}
.s-grid-3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}
.s-grid-4{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px}
.s-split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:48px;align-items:center}

/* hero */
.s-hero{padding:48px 0 56px}
.s-hero-grid{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,6fr);gap:48px;align-items:center}
.s-hero-copy{display:grid;gap:16px}
.s-entrances{display:flex;flex-wrap:wrap;gap:12px;margin-top:8px}
.s-entrance{display:grid;gap:2px;text-align:left;padding:12px 20px}
.s-entrance small{font-weight:600;${type('small')}}

/* loop stage */
.s-loop{position:relative;border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;box-shadow:${S.shadowDefault};overflow:hidden;background:linear-gradient(${C.sky},${C['paper-0']} 78%);aspect-ratio:4/3;isolation:isolate}
.s-loop svg{display:block}
.s-loop-scene{position:absolute;inset:0;display:flex;align-items:flex-end;justify-content:center}
.s-loop-cap{position:absolute;left:12px;right:12px;bottom:12px;z-index:3;display:flex;justify-content:center}
.s-loop-cap span{background:${C['night-900']};color:${C['paper-0']};padding:6px 12px;border-radius:${S.radiusButtonPx}px;font-weight:700;${type('small')};text-align:center}
.s-loop-ctrl{position:absolute;top:8px;right:8px;z-index:4;display:flex;gap:6px}
.s-loop-ctrl button{min-height:${S.touchTargetMinPx}px;min-width:${S.touchTargetMinPx}px;border:2px solid ${C['ink-900']};background:${C['paper-0']};border-radius:${S.radiusButtonPx}px;font:inherit;font-weight:800;cursor:pointer}
.s-clip{position:relative;border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;box-shadow:${S.shadowDefault};overflow:hidden;background:${C['night-900']};isolation:isolate}
.s-clip video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.s-clip-tag{position:absolute;top:10px;left:10px;z-index:3;background:${C['paper-0']};color:${C['ink-900']}}
.s-clip-btn{position:absolute;top:8px;right:8px;z-index:4;min-height:${S.touchTargetMinPx}px;min-width:${S.touchTargetMinPx}px;border:2px solid ${C['ink-900']};background:${C['paper-0']};color:${C['ink-900']};border-radius:${S.radiusButtonPx}px;font:inherit;font-weight:800;cursor:pointer}
.s-shot{position:relative;border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;box-shadow:${S.shadowDefault};overflow:hidden;background:${C['night-900']}}
.s-shot img{display:block;width:100%;height:auto}
.s-shot-thumb{box-shadow:none;border-width:1px}
.s-shot-thumb img{height:120px;object-fit:cover}
.s-shot-thumb .s-clip-tag{display:none}
.s-loop-dots{position:absolute;top:12px;left:12px;z-index:4;display:flex;gap:6px}
.s-loop-dots i{width:28px;height:6px;border:1px solid ${C['ink-900']};background:${C['paper-0']}}
.s-loop-dots i[data-on="1"]{background:${C.brand}}
.s-bubble{position:absolute;z-index:3;background:${C['paper-0']};border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;padding:8px 12px;box-shadow:3px 3px 0 ${C['ink-900']};font-family:${TOKENS.typography.fonts.target};font-weight:700;${type('body-l')};animation:s-popscale ${M.popMs}ms ease-out both}
.s-dialog{position:absolute;z-index:3;left:4%;right:4%;top:14%;background:color-mix(in srgb, ${C['night-900']} 92%, transparent);color:${C['paper-0']};border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;padding:12px;display:grid;gap:6px;animation:s-rise ${M.baseMs}ms ease-out both}
.s-offer{display:grid;grid-template-columns:auto 1fr auto;gap:8px;align-items:center;padding:6px 8px;border-radius:${S.radiusButtonPx}px;border:1px solid ${C['night-700']}}
.s-offer[data-stars="1"]{border-left:4px solid ${C.silver}}
.s-offer[data-stars="2"]{border-left:4px solid ${C.sky}}
.s-offer[data-stars="3"]{border-left:4px solid ${C.sun}}
.s-offer[data-pick="1"]{background:${C['night-700']};outline:2px solid ${C.sun}}
.s-offer .s-stars{color:${C.sun};font-weight:800;letter-spacing:1px;white-space:nowrap}
.s-offer[data-stars="1"] .s-stars{color:${C.silver}}
.s-offer[data-stars="2"] .s-stars{color:${C.sky}}
.s-offer .s-coin{color:${C.sun};font-weight:800;white-space:nowrap;font-family:${TOKENS.typography.fonts.pixel}}
.s-offer .s-en-sm{font-size:15px;line-height:20px}
.s-word{display:inline-block;transition:color ${M.baseMs}ms ease-out}
.s-word[data-st="ok"]{color:${C.leaf}}
.s-word[data-st="miss"]{text-decoration:underline 3px ${C.sun};text-underline-offset:4px}
.s-paper .s-word[data-st="ok"]{color:${C['leaf-d']}}
.s-paper .s-word[data-st="miss"]{text-decoration-color:${C['sun-d']}}
.s-starburst{position:absolute;z-index:4;color:${C.sun};font-weight:800;font-size:32px;-webkit-text-stroke:1px ${C['ink-900']};animation:s-burst 900ms ease-out both}

/* steps strip */
.s-steps{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;overflow:hidden;background:${C['paper-0']}}
.s-step{padding:20px 24px;display:grid;gap:8px;align-content:start;min-height:168px;position:relative}
.s-step+.s-step{border-left:2px solid ${C['ink-900']}}
.s-step-n{display:inline-grid;place-items:center;width:32px;height:32px;border:2px solid ${C['ink-900']};font-weight:800;background:${C.sun}}
.s-step:nth-child(2) .s-step-n{background:${C.sky}}
.s-step:nth-child(3) .s-step-n{background:${C.leaf}}
.s-grow{display:grid;gap:4px}
.s-grow span{font-family:${TOKENS.typography.fonts.target};font-weight:700;${type('small')};padding:2px 8px;border-left:4px solid ${C.silver};background:${C['paper-50']};animation:s-rise ${M.slowMs}ms ease-out both}
.s-grow span:nth-child(2){border-color:${C.sky};animation-delay:.25s}
.s-grow span:nth-child(3){border-color:${C.sun};animation-delay:.5s}

/* try band */
.s-tryband{background:${C.sun};border-top:2px solid ${C['ink-900']};border-bottom:2px solid ${C['ink-900']};padding:32px 0}
.s-tryband-in{display:flex;flex-wrap:wrap;gap:24px;align-items:center;justify-content:space-between}

/* stats / dashboard sample */
.s-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.s-kpi{border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;padding:10px;background:${C['paper-0']}}
.s-kpi b{display:block;${type('h3')};font-variant-numeric:tabular-nums}
.s-kpi small{display:block;${type('micro')};color:${C['ink-500']}}
.s-kpi em{font-style:normal;${type('micro')};color:${C['leaf-d']};font-weight:800}
.s-chart{width:100%;height:auto;display:block}
.s-table{width:100%;border-collapse:collapse;${type('small')}}
.s-table th,.s-table td{border:1px solid ${C['ink-900']};padding:8px 10px;text-align:left;vertical-align:top}
.s-table th{background:${C['paper-100']}}
.s-table td.s-num{font-variant-numeric:tabular-nums;white-space:nowrap}
.s-tablewrap{overflow-x:auto;border-radius:${S.radiusCardPx}px}

/* tabs, situations */
.s-tabs{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
.s-tab{min-height:${S.touchTargetMinPx}px;padding:8px 14px;border:2px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;background:${C['paper-0']};font:inherit;font-weight:800;cursor:pointer}
.s-tab[aria-selected="true"],.s-tab[aria-pressed="true"]{background:${C['ink-900']};color:${C['paper-0']}}
.s-offers-paper{display:grid;gap:8px}
.s-offer-p{display:grid;grid-template-columns:auto 1fr auto;gap:12px;align-items:center;padding:12px;border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;background:${C['paper-0']}}
.s-offer-p[data-stars="1"]{border-left-width:6px;border-left-color:${C.silver}}
.s-offer-p[data-stars="2"]{border-left-width:6px;border-left-color:${C['sky-d']}}
.s-offer-p[data-stars="3"]{border-left-width:6px;border-left-color:${C['sun-d']}}
.s-offer-p .s-stars{font-weight:800;color:${C['sun-d']};white-space:nowrap}
.s-offer-p .s-coin{font-weight:800;color:${C['ink-700']};white-space:nowrap;font-variant-numeric:tabular-nums}
.s-listen{min-height:${S.touchTargetMinPx}px;min-width:${S.touchTargetMinPx}px;border:2px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;background:${C['paper-50']};font:inherit;font-weight:800;cursor:pointer;padding:0 10px}

/* faq */
.s-faq{display:grid;gap:8px}
.s-faq details{border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;background:${C['paper-0']}}
.s-faq summary{cursor:pointer;padding:16px 20px;font-weight:800;list-style:none;display:flex;justify-content:space-between;gap:12px}
.s-faq summary::after{content:"+";font-weight:800}
.s-faq details[open] summary::after{content:"−"}
.s-faq details>div{padding:0 20px 16px;color:${C['ink-700']}}

/* price table */
.s-plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}
.s-plan{display:grid;gap:12px;align-content:start}
.s-plan-price{${type('h1')}font-weight:800;font-variant-numeric:tabular-nums}
.s-plan-price small{${type('body')}font-weight:700;color:${C['ink-500']}}
.s-plan ul{padding-left:20px;display:grid;gap:4px;color:${C['ink-700']}}
.s-plan-hl{outline:3px solid ${C['brand-d']};outline-offset:-2px}
.s-promise{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:24px}
.s-promise>div{border:2px dashed ${C['ink-900']};border-radius:${S.radiusCardPx}px;padding:16px;background:${C['paper-0']};font-weight:700}

/* arc timeline */
.s-arc{display:flex;border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;overflow:hidden;background:${C['paper-0']}}
.s-arc>div{padding:12px 10px;border-right:2px solid ${C['ink-900']};min-width:0;display:grid;gap:4px;align-content:start}
.s-arc>div:last-child{border-right:0}
.s-arc b{${type('small')};font-weight:800}
.s-arc small{${type('micro')};color:${C['ink-500']}}
.s-arc i{display:block;height:8px;border:1px solid ${C['ink-900']}}

/* phone mock */
.s-phone{width:320px;max-width:100%;margin:0 auto;border:3px solid ${C['ink-900']};border-radius:28px;background:${C['paper-50']};padding:14px;box-shadow:${S.shadowDefault}}
.s-phone-in{border:2px solid ${C['ink-900']};border-radius:16px;background:${C['paper-0']};overflow:hidden}
.s-phone-sec{padding:12px 14px;border-bottom:1px solid ${C['line-200']};display:grid;gap:4px;${type('small')}}
.s-phone-sec:last-child{border-bottom:0}
.s-band{display:flex;gap:1px;height:14px}
.s-band i{flex:1;background:${C.brand}}

/* forms */
.s-form{display:grid;gap:16px}
.s-field{display:grid;gap:6px}
.s-field label,.s-field legend{font-weight:800}
.s-field input,.s-field select,.s-field textarea{font:inherit;min-height:${S.touchTargetMinPx}px;padding:8px 12px;border:2px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;background:${C['paper-0']};color:${C['ink-900']};width:100%}
.s-checks{display:flex;flex-wrap:wrap;gap:8px}
.s-checks label{display:inline-flex;align-items:center;gap:6px;min-height:${S.touchTargetMinPx}px;padding:0 12px;border:2px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;background:${C['paper-0']};font-weight:700;cursor:pointer}
.s-note{border-left:4px solid ${C['sky-d']};padding:8px 12px;background:${C['paper-0']};${type('small')}}
.s-ok{border-left-color:${C['leaf-d']}}
.s-warn{border-left-color:${C['danger-d']}}

/* footer */
.s-foot{border-top:2px solid ${C['ink-900']};background:${C['night-900']};color:${C['paper-0']};padding:40px 0 48px}
.s-foot a{color:${C['paper-0']}}
.s-foot-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:24px}
.s-foot h3{${type('small')};font-weight:800;color:${C['grape-l']};margin-bottom:8px}
.s-foot ul{list-style:none;padding:0;display:grid;gap:6px}
.s-foot p{${type('small')};color:${C.silver}}

/* showroom */
.s-show{position:relative;border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;background:linear-gradient(${C.sky},${C['paper-50']} 85%);box-shadow:${S.shadowDefault};overflow:hidden;touch-action:pan-y;cursor:grab}
.s-show svg{display:block;width:100%;height:auto;transition:opacity ${M.baseMs}ms ease-out}

/* try */
.s-try{min-height:100vh;display:grid;grid-template-columns:minmax(0,1fr);grid-template-rows:auto 1fr;background:${C['paper-50']}}
.s-try-top{display:flex;align-items:center;gap:12px;padding:8px 16px;border-bottom:2px solid ${C['ink-900']};background:${C['paper-50']}}
.s-try-goal{flex:1;min-width:0;font-weight:800;${type('body-l')};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.s-try-body{display:grid;grid-template-columns:minmax(0,7fr) minmax(320px,5fr);gap:0;min-height:0}
.s-try-stage{position:relative;overflow:hidden;background:linear-gradient(${C.sky},${C['paper-0']} 80%);border-right:2px solid ${C['ink-900']};min-height:420px;display:flex;align-items:center;justify-content:center}
.s-try-stage svg{display:block;width:100%;height:auto;max-height:100%}
.s-world{position:absolute;inset:0;z-index:1}
.s-world-canvas{display:block;width:100%;height:100%;touch-action:none}
.s-world-hud{position:absolute;inset:0}
.s-try-stage[data-stage="2d"] .s-world{visibility:hidden;pointer-events:none}
.s-status-row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;background:color-mix(in srgb, ${C['night-900']} 85%, transparent);border-radius:${S.radiusButtonPx}px;padding:6px 10px}
.s-status-row .s-gauges,.s-status-row .s-coins{position:static;background:none;padding:0}
.s-try-panel{min-width:0;display:flex;flex-direction:column;gap:16px;padding:24px;background:${C['paper-50']};overflow:auto}
.s-hud{position:absolute;left:0;right:0;bottom:12px;display:flex;justify-content:center;gap:4px;z-index:3}
.s-slot{width:56px;height:56px;border:2px solid ${C['ink-900']};background:color-mix(in srgb, ${C['night-900']} 85%, transparent);color:${C['paper-0']};display:grid;place-items:center;font-weight:800;position:relative;font:inherit}
.s-slot small{position:absolute;left:3px;top:1px;${type('micro')};color:${C.silver}}
.s-slot[data-ready="1"]{outline:3px solid ${C.sun};animation:s-pulse 1.1s ease-in-out infinite;cursor:pointer}
.s-slot svg{width:36px;height:36px}
.s-gauges{position:absolute;left:12px;top:12px;z-index:3;display:grid;gap:4px;background:color-mix(in srgb, ${C['night-900']} 85%, transparent);color:${C['paper-0']};padding:8px 10px;border-radius:${S.radiusButtonPx}px;${type('micro')};font-weight:700}
.s-gauge{display:grid;grid-template-columns:48px 96px;gap:6px;align-items:center}
.s-gauge i{display:block;height:8px;border:1px solid ${C['paper-0']}}
.s-gauge i b{display:block;height:100%;background:${C.sky};transition:width ${M.slowMs}ms ease-in-out}
.s-gauge i[data-k="warm"] b{background:${C.sun}}
.s-coins{position:absolute;right:12px;top:12px;z-index:3;background:color-mix(in srgb, ${C['night-900']} 85%, transparent);color:${C.sun};padding:6px 10px;border-radius:${S.radiusButtonPx}px;font-family:${TOKENS.typography.fonts.pixel};font-weight:800}
.s-npcline{display:grid;gap:4px;padding:12px 14px;border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;background:${C['paper-0']};box-shadow:3px 3px 0 ${C['ink-900']}}
.s-npcline .s-who{${type('micro')};font-weight:800;color:${C['sky-d']}}
.s-target{font-family:${TOKENS.typography.fonts.target};font-size:${TOKENS.typography.targetSentenceMinPx + 4}px;line-height:1.35;font-weight:700}
.s-mic{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.s-level{display:flex;gap:3px;align-items:flex-end;height:28px}
.s-level i{width:6px;background:${C.brand};border:1px solid ${C['ink-900']};transition:height 80ms linear}
.s-dots{display:inline-flex;gap:4px}
.s-dots i{width:8px;height:8px;background:${C['ink-900']};animation:s-dot 900ms ease-in-out infinite}
.s-dots i:nth-child(2){animation-delay:.15s}.s-dots i:nth-child(3){animation-delay:.3s}
.s-pickgrid{display:grid;gap:8px}
.s-pick{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;text-align:left;padding:12px;border:2px solid ${C['ink-900']};border-radius:${S.radiusCardPx}px;background:${C['paper-0']};font:inherit;cursor:pointer;box-shadow:3px 3px 0 ${C['ink-900']};transition:transform ${M.fastMs}ms ease-out}
.s-pick:active{transform:translate(2px,2px);box-shadow:1px 1px 0 ${C['ink-900']}}
.s-pick[data-stars="3"]{border-width:3px}
.s-pick .s-stars{font-weight:800;color:${C['sun-d']};white-space:nowrap}
.s-pick[data-stars="1"] .s-stars{color:${C['ink-500']}}
.s-pick[data-stars="2"] .s-stars{color:${C['sky-d']}}
.s-pick .s-coin{font-weight:800;font-family:${TOKENS.typography.fonts.pixel};color:${C['ink-700']};white-space:nowrap}
.s-cards{display:flex;flex-wrap:wrap;gap:8px}
.s-wcard{min-height:${S.touchTargetMinPx}px;padding:6px 12px;border:2px solid ${C['ink-900']};border-radius:${S.radiusButtonPx}px;background:${C['paper-0']};font-family:${TOKENS.typography.fonts.target};font-weight:700;${type('body-l')};cursor:pointer;box-shadow:2px 2px 0 ${C['ink-900']}}
.s-wcard[disabled]{opacity:.35;box-shadow:none;cursor:default}
.s-assembled{min-height:56px;padding:10px 12px;border:2px dashed ${C['ink-900']};border-radius:${S.radiusCardPx}px;background:${C['paper-0']};font-family:${TOKENS.typography.fonts.target};font-weight:700;${type('h3')}}
.s-end{display:grid;gap:16px}
.s-overlay{position:absolute;inset:0;z-index:6;display:grid;place-items:center;background:color-mix(in srgb, ${C['night-900']} 55%, transparent);padding:16px}
.s-modal{max-width:420px;width:100%}
.s-start{position:absolute;inset:0;z-index:5;display:grid;place-items:center;padding:16px}
.s-arrow-btn{width:96px;height:96px;font-size:40px}
.s-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:60;background:${C['ink-900']};color:${C['paper-0']};padding:12px 16px;border-radius:${S.radiusButtonPx}px;font-weight:700;max-width:calc(100vw - 32px);animation:s-rise ${M.baseMs}ms ease-out both}
.s-inapp{background:${C.sun};border-bottom:2px solid ${C['ink-900']};padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px 16px;align-items:center}

/* motion */
@keyframes s-pop{0%{transform:scale(1)}50%{transform:scale(1.15)}100%{transform:scale(1)}}
/* bubbles keep their inline translate, so they pop with the independent scale property */
@keyframes s-popscale{0%{scale:1}50%{scale:1.15}100%{scale:1}}
@keyframes s-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes s-burst{0%{opacity:0;transform:translateY(0) scale(.6)}30%{opacity:1;transform:translateY(-12px) scale(1.15)}100%{opacity:0;transform:translateY(-48px) scale(1)}}
@keyframes s-pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes s-dot{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes s-flame{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes s-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes s-wave{0%,49%{opacity:1}50%,100%{opacity:0}}
@keyframes s-wave2{0%,49%{opacity:0}50%,100%{opacity:1}}
.s-flame{animation:s-flame 160ms steps(2) infinite}
.s-bob{animation:s-bob 420ms ease-in-out infinite}
.s-wave-a{animation:s-wave 900ms steps(1) infinite}
.s-wave-b{animation:s-wave2 900ms steps(1) infinite}
.s-popin{animation:s-pop ${M.popMs}ms ease-out both}
.s-risein{animation:s-rise ${M.baseMs}ms ease-out both}

@media (max-width:${SITE_BREAKPOINT_PX}px){
  .s-hero-grid,.s-split{grid-template-columns:minmax(0,1fr);gap:24px}
  .s-grid-3,.s-plans,.s-promise{grid-template-columns:minmax(0,1fr)}
  .s-grid-4{grid-template-columns:repeat(2,minmax(0,1fr))}
  .s-foot-grid{grid-template-columns:1fr 1fr}
  .s-try-body{grid-template-columns:minmax(0,1fr);grid-template-rows:auto auto}
  .s-try-stage{border-right:0;border-bottom:2px solid ${C['ink-900']};min-height:0;aspect-ratio:4/3;max-height:52vh}
  .s-try-stage[data-stage="3d"]{aspect-ratio:auto;height:58vh;max-height:none}
  .s-try-panel{padding:16px}
}
@media (max-width:${SITE_PHONE_PX}px){
  .s-wrap{padding:0 16px}
  .s-display{font-size:${T.h1.sizePx}px;line-height:${T.h1.lineHeightPx}px}
  .s-h1{font-size:${T.h2.sizePx}px;line-height:${T.h2.lineHeightPx}px}
  .s-h2{font-size:${T.h3.sizePx + 2}px;line-height:${T.h3.lineHeightPx + 2}px}
  .s-lead{font-size:${T.body.sizePx}px;line-height:${T.body.lineHeightPx}px}
  .s-nav{display:none}
  .s-btn.s-menu-btn{display:inline-flex;margin-left:auto}
  .s-mnav[data-open="1"]{display:grid;gap:4px;padding:8px 16px 16px;border-top:2px solid ${C['ink-900']}}
  .s-mnav a{display:flex;align-items:center;min-height:48px;padding:0 8px;color:${C['ink-900']};font-weight:800;text-decoration:none;border-bottom:1px solid ${C['line-200']}}
  .s-hero{padding:16px 0 32px}
  .s-hero-copy{gap:10px}
  .s-sec{padding:40px 0}
  .s-sec-head{margin-bottom:20px}
  .s-steps{grid-template-columns:minmax(0,1fr)}
  .s-step{min-height:0}
  .s-step+.s-step{border-left:0;border-top:2px solid ${C['ink-900']}}
  .s-grid-2{grid-template-columns:minmax(0,1fr)}
  .s-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}
  .s-card{padding:16px}
  .s-entrances{display:grid;grid-template-columns:1fr 1fr;gap:8px}
  .s-entrance{padding:10px 12px}
  .s-arc{flex-direction:column}
  .s-arc>div{border-right:0;border-bottom:2px solid ${C['ink-900']}}
  .s-foot-grid{grid-template-columns:1fr}
  .s-offer .s-en-sm{font-size:13px;line-height:17px}
  .s-bubble{font-size:15px;line-height:20px}
  .s-stage-bubble{display:none}
  .s-tryband-in{display:grid}
}
@media (prefers-reduced-motion: reduce){
  .s-root *,.s-root *::before,.s-root *::after{animation-duration:1ms !important;animation-iteration-count:1 !important;transition-duration:1ms !important;scroll-behavior:auto !important}
  .s-wave-b{opacity:0}
}
`;
}
