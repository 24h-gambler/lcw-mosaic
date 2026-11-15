/**
 * W01 first screen (docs/14 §3): one-line title, the looping "say it → the sentence grows ★→★★★ → a jetpack appears"
 * scene with on-screen captions (understandable without sound), two entrances, the three steps and the try CTA.
 * The scene is inline SVG + CSS from tokens (no external assets); prefers-reduced-motion shows the final frame.
 */
import React from 'react';
import { Button, TOKENS } from '@lcw/ui';
import { LESSON_STRINGS_KO, WEB_UX_STRINGS_KO } from './strings.js';
import { border, sp } from './lessonUi.js';

const C = TOKENS.colors;
const T = TOKENS.typography;
const L = LESSON_STRINGS_KO.landing;
const U = WEB_UX_STRINGS_KO.site;

/** One loop of the hero scene. */
export const HERO_LOOP_MS = 12_000;

const HERO_CSS = `
.lcw-hero .b1 { animation: lcw-h-b1 ${HERO_LOOP_MS}ms linear infinite; }
.lcw-hero .b2 { animation: lcw-h-b2 ${HERO_LOOP_MS}ms linear infinite; }
.lcw-hero .b3 { animation: lcw-h-b3 ${HERO_LOOP_MS}ms linear infinite; }
.lcw-hero .s1, .lcw-hero .s2, .lcw-hero .s3, .lcw-hero .jet { transform-box: fill-box; transform-origin: center; }
.lcw-hero .s1 { animation: lcw-h-s1 ${HERO_LOOP_MS}ms ease-out infinite; }
.lcw-hero .s2 { animation: lcw-h-s2 ${HERO_LOOP_MS}ms ease-out infinite; }
.lcw-hero .s3 { animation: lcw-h-s3 ${HERO_LOOP_MS}ms ease-out infinite; }
.lcw-hero .jet { animation: lcw-h-jet ${HERO_LOOP_MS}ms ease-out infinite; }
.lcw-hero .flame { transform-box: fill-box; transform-origin: top; animation: lcw-h-flame ${TOKENS.motion.popMs}ms ease-in-out infinite alternate; }
.lcw-hero .kid { animation: lcw-h-fly ${HERO_LOOP_MS}ms ease-in-out infinite; }
.lcw-hero .island { animation: lcw-h-island ${HERO_LOOP_MS}ms ease-out infinite; }
.lcw-hero .cloud { animation: lcw-h-cloud 9s ease-in-out infinite alternate; }
.lcw-hero .cap1 { animation: lcw-h-c1 ${HERO_LOOP_MS}ms steps(1) infinite; }
.lcw-hero .cap2 { animation: lcw-h-c2 ${HERO_LOOP_MS}ms steps(1) infinite; }
.lcw-hero .cap3 { animation: lcw-h-c3 ${HERO_LOOP_MS}ms steps(1) infinite; }
@keyframes lcw-h-b1 { 0% { opacity: 0; } 3% { opacity: 1; } 30% { opacity: 1; } 33%, 100% { opacity: 0; } }
@keyframes lcw-h-b2 { 0%, 33% { opacity: 0; } 36%, 59% { opacity: 1; } 62%, 100% { opacity: 0; } }
@keyframes lcw-h-b3 { 0%, 62% { opacity: 0; } 65%, 96% { opacity: 1; } 99%, 100% { opacity: 0; } }
@keyframes lcw-h-s1 { 0%, 3% { opacity: 0; transform: scale(0.2); } 6% { opacity: 1; transform: scale(1.15); } 8%, 96% { opacity: 1; transform: scale(1); } 99%, 100% { opacity: 0; } }
@keyframes lcw-h-s2 { 0%, 36% { opacity: 0; transform: scale(0.2); } 39% { opacity: 1; transform: scale(1.15); } 41%, 96% { opacity: 1; transform: scale(1); } 99%, 100% { opacity: 0; } }
@keyframes lcw-h-s3 { 0%, 65% { opacity: 0; transform: scale(0.2); } 68% { opacity: 1; transform: scale(1.15); } 70%, 96% { opacity: 1; transform: scale(1); } 99%, 100% { opacity: 0; } }
@keyframes lcw-h-jet { 0%, 70% { opacity: 0; transform: scale(0.6); } 73% { opacity: 1; transform: scale(1.15); } 75%, 96% { opacity: 1; transform: scale(1); } 99%, 100% { opacity: 0; } }
@keyframes lcw-h-flame { 0% { transform: scaleY(1); } 100% { transform: scaleY(0.55); } }
@keyframes lcw-h-fly { 0%, 77% { transform: translateY(0); } 87%, 94% { transform: translateY(-58px); } 100% { transform: translateY(0); } }
@keyframes lcw-h-island { 0%, 78% { opacity: 0; transform: translateY(14px); } 86%, 96% { opacity: 1; transform: translateY(0); } 100% { opacity: 0; transform: translateY(0); } }
@keyframes lcw-h-cloud { 0% { transform: translateX(0); } 100% { transform: translateX(-36px); } }
@keyframes lcw-h-c1 { 0% { background-color: ${C.sun}; } 33%, 100% { background-color: ${C['paper-0']}; } }
@keyframes lcw-h-c2 { 0% { background-color: ${C['paper-0']}; } 33% { background-color: ${C.sun}; } 62%, 100% { background-color: ${C['paper-0']}; } }
@keyframes lcw-h-c3 { 0% { background-color: ${C['paper-0']}; } 62% { background-color: ${C.sun}; } 100% { background-color: ${C.sun}; } }
@media (prefers-reduced-motion: reduce) {
  .lcw-hero *, .lcw-hero .kid { animation: none !important; }
  .lcw-hero .b1, .lcw-hero .b2 { opacity: 0; }
  .lcw-hero .b3, .lcw-hero .s1, .lcw-hero .s2, .lcw-hero .s3, .lcw-hero .jet, .lcw-hero .island { opacity: 1; }
  .lcw-hero .cap3 { background-color: ${C.sun}; }
}
`;

/** Voxel blocks: every shape is a rect on a 4px grid, outlined like the 2D UI. */
function Block(props: { x: number; y: number; w: number; h: number; fill: string; stroke?: boolean }): React.ReactElement {
  return (
    <rect
      x={props.x}
      y={props.y}
      width={props.w}
      height={props.h}
      fill={props.fill}
      stroke={props.stroke === false ? 'none' : C['ink-900']}
      strokeWidth={props.stroke === false ? 0 : 2}
    />
  );
}

export function HeroLoop(): React.ReactElement {
  const groundBlocks = Array.from({ length: 10 }, (_, i) => i * 36);
  return (
    <figure className="lcw-hero" data-testid="hero-loop" style={{ margin: 0, display: 'grid', gap: sp(2) }}>
      <style>{HERO_CSS}</style>
      <svg
        viewBox="0 0 360 270"
        role="img"
        aria-label={L.heroAria}
        style={{
          width: '100%',
          height: 'auto',
          display: 'block',
          border,
          borderRadius: `${TOKENS.shape.radiusCardPx}px`,
          boxShadow: TOKENS.shape.shadowDefault,
          backgroundColor: C['paper-0']
        }}
      >
        <rect x="0" y="0" width="360" height="270" fill={C.sky} opacity="0.28" />
        <g className="cloud">
          <Block x={40} y={28} w={44} h={12} fill={C['paper-0']} stroke={false} />
          <Block x={52} y={20} w={20} h={8} fill={C['paper-0']} stroke={false} />
          <Block x={196} y={48} w={36} h={10} fill={C['paper-0']} stroke={false} />
        </g>
        {/* sky island: the world grows */}
        <g className="island">
          <Block x={262} y={52} w={72} h={10} fill={C.leaf} />
          <Block x={270} y={62} w={56} h={10} fill={C['sun-d']} />
          <Block x={284} y={72} w={28} h={8} fill={C['sun-d']} />
          <Block x={292} y={32} w={12} h={20} fill={C['leaf-d']} />
          <Block x={284} y={22} w={28} h={12} fill={C.leaf} />
        </g>
        {/* ground */}
        {groundBlocks.map((x) => (
          <g key={x}>
            <Block x={x} y={232} w={36} h={10} fill={C.leaf} />
            <Block x={x} y={242} w={36} h={28} fill={C['sun-d']} />
          </g>
        ))}
        {/* the kid (flies once the jetpack is on) */}
        <g className="kid">
          <g className="jet">
            <Block x={52} y={170} w={14} h={30} fill={C['brand-d']} />
            <Block x={54} y={164} w={10} h={6} fill={C.silver} />
            <rect className="flame" x="54" y="200" width="10" height="14" fill={C.sun} stroke={C['ink-900']} strokeWidth="2" />
            <rect className="flame" x="57" y="204" width="4" height="8" fill={C.brand} />
          </g>
          <Block x={66} y={196} w={12} h={36} fill={C['sky-d']} />
          <Block x={84} y={196} w={12} h={36} fill={C['sky-d']} />
          <Block x={62} y={164} w={38} h={34} fill={C.brand} />
          <Block x={100} y={168} w={10} h={24} fill={C['paper-100']} />
          <Block x={64} y={124} w={34} h={40} fill={C['paper-100']} />
          <Block x={62} y={120} w={38} h={12} fill={C['ink-700']} />
          <rect x="84" y="138" width="6" height="6" fill={C['ink-900']} />
          <rect x="84" y="152" width="10" height="4" fill={C['brand-d']} />
        </g>
        {/* speech bubble with the sentence that grows */}
        <g>
          <polygon points="122,150 136,140 136,158" fill={C['paper-0']} stroke={C['ink-900']} strokeWidth="2" />
          <rect x="134" y="118" width="214" height="62" fill={C['paper-0']} stroke={C['ink-900']} strokeWidth="2" />
          <text
            className="b1"
            x="146"
            y="154"
            fontFamily={T.fonts.target}
            fontSize="17"
            fontWeight="700"
            fill={C['ink-900']}
          >
            {L.bubble1}
          </text>
          <text className="b2" x="146" y="154" fontFamily={T.fonts.target} fontSize="17" fontWeight="700" fill={C['ink-900']}>
            {L.bubble2}
          </text>
          <text className="b3" x="146" y="143" fontFamily={T.fonts.target} fontSize="15" fontWeight="700" fill={C['ink-900']}>
            <tspan x="146">{L.bubble3a}</tspan>
            <tspan x="146" dy="20" fill={C['leaf-d']}>
              {L.bubble3b}
            </tspan>
          </text>
        </g>
        <g fontSize="26" fontWeight="700" stroke={C['ink-900']} strokeWidth="1.5" fill={C.sun}>
          <text className="s1" x="140" y="108">★</text>
          <text className="s2" x="168" y="108">★</text>
          <text className="s3" x="196" y="108">★</text>
        </g>
      </svg>
      <figcaption style={{ display: 'flex', gap: sp(1), flexWrap: 'wrap', justifyContent: 'center' }}>
        {L.captions.map((c, i) => (
          <span
            key={c}
            className={`cap cap${i + 1}`}
            style={{
              border,
              borderRadius: `${TOKENS.shape.radiusButtonPx}px`,
              padding: `${sp(0)} ${sp(2)}`,
              fontWeight: 700,
              fontSize: `${T.scale.small.sizePx}px`,
              backgroundColor: C['paper-0']
            }}
          >
            {c}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export type LandingRoute = '/parents' | '/play' | '/try' | '/join';

export function LandingPage({ onNavigate }: { onNavigate: (r: LandingRoute) => void }): React.ReactElement {
  return (
    <div data-testid="landing" style={{ display: 'grid', gap: sp(6), maxWidth: `${TOKENS.shape.dashboardMaxWidthPx}px`, margin: '0 auto' }}>
      <section
        style={{
          display: 'grid',
          gap: sp(5),
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
          alignItems: 'center'
        }}
      >
        <div style={{ display: 'grid', gap: sp(3) }}>
          <h1
            style={{
              margin: 0,
              fontSize: `clamp(${T.scale.h1.sizePx}px, 6vw, ${T.scale.display.sizePx}px)`,
              lineHeight: 1.15,
              letterSpacing: '-0.02em'
            }}
          >
            {U.heroTitle}
          </h1>
          <p style={{ margin: 0, fontSize: `${T.scale['body-l'].sizePx}px`, lineHeight: `${T.scale['body-l'].lineHeightPx}px`, color: C['ink-700'] }}>
            {U.heroBody}
          </p>
          <div style={{ display: 'grid', gap: sp(2), gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
            <Entrance title={U.forParents} body={L.parentsBody} variant="brand" onClick={() => onNavigate('/parents')} />
            <Entrance title={U.forPlayers} body={L.playersBody} variant="sky" onClick={() => onNavigate('/play')} />
          </div>
          <button
            type="button"
            onClick={() => onNavigate('/join')}
            style={{
              justifySelf: 'start',
              background: 'none',
              border: 'none',
              padding: `${sp(1)} 0`,
              minHeight: `${TOKENS.shape.touchTargetMinPx}px`,
              color: C['sky-d'],
              fontWeight: 700,
              fontSize: `${T.scale.body.sizePx}px`,
              textDecoration: 'underline',
              cursor: 'pointer'
            }}
          >
            {L.lessonJoin} →
          </button>
        </div>
        <HeroLoop />
      </section>
      <section aria-label={L.stepsTitle}>
        <ol
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'grid',
            gap: sp(3),
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))'
          }}
        >
          {U.steps.map((st, i) => (
            <li
              key={st.title}
              style={{
                border,
                borderRadius: `${TOKENS.shape.radiusCardPx}px`,
                boxShadow: TOKENS.shape.shadowDefault,
                backgroundColor: [C['paper-0'], C['paper-100'], C['paper-0']][i],
                padding: sp(3),
                display: 'grid',
                gap: sp(1)
              }}
            >
              <strong style={{ fontSize: `${T.scale.h3.sizePx}px` }}>{st.title}</strong>
              <span lang="en" style={{ fontFamily: T.fonts.target, fontSize: `${T.scale['body-l'].sizePx}px`, color: C['ink-700'] }}>
                {st.body}
              </span>
            </li>
          ))}
        </ol>
      </section>
      <section style={{ display: 'grid', justifyItems: 'center' }}>
        <Button
          type="button"
          variant="leaf"
          size="game"
          onClick={() => onNavigate('/try')}
          style={{ fontSize: `${T.scale['body-l'].sizePx}px`, maxWidth: '100%', whiteSpace: 'normal' }}
        >
          {U.tryCta}
        </Button>
      </section>
    </div>
  );
}

function Entrance({
  title,
  body,
  variant,
  onClick
}: {
  title: string;
  body: string;
  variant: 'brand' | 'sky';
  onClick: () => void;
}): React.ReactElement {
  return (
    <Button
      type="button"
      variant={variant}
      size="game"
      onClick={onClick}
      style={{ display: 'grid', gap: sp(0), textAlign: 'left', whiteSpace: 'normal', padding: sp(3) }}
    >
      <span style={{ fontSize: `${T.scale.h3.sizePx}px` }}>{title}</span>
      <span style={{ fontWeight: 400, fontSize: `${T.scale.small.sizePx}px` }}>{body}</span>
    </Button>
  );
}
