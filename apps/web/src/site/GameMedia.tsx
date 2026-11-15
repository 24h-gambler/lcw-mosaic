/**
 * Real /game pictures on the public pages (docs/14 §10.3 "실제 플레이 화면만"): stills and short clips captured by
 * tools/site-captures.mjs. Every picture carries a "실제 게임 화면 · 시연" tag — the screen is the real game, the voice
 * input was a demonstration (no child voice, docs/14 §10.3).
 *
 * Clips: muted, inline, no download until they are on screen (preload none, poster first — docs/14 §11 budget),
 * play only while visible, never auto-play with reduced motion or Save-Data, and a pause button (WCAG 2.2.2).
 * Captions follow the clip's own marks so the story reads with the sound off (docs/14 §3).
 */
import React, { useEffect, useRef, useState } from 'react';
import { MEDIA } from './copy.js';
import { SITE_CLIPS, SITE_STILLS, type SiteClipKey, type SiteStillKey } from './media.js';
import { prefersReducedMotion } from './sound.js';

/** Index of the caption to show at time t: the last mark (in `order`) that has started. */
export function clipCaptionAt(t: number, marks: Readonly<Record<string, number>>, order: readonly string[]): number {
  let at = 0;
  order.forEach((k, i) => {
    const m = marks[k];
    if (m !== undefined && t >= m - 0.05) at = i;
  });
  return at;
}

function saveData(): boolean {
  const c = (typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: { saveData?: boolean } }).connection : undefined) ?? undefined;
  return !!c?.saveData;
}

export function GameClip(props: {
  clip: SiteClipKey;
  /** [mark, caption] in play order */
  captions: ReadonlyArray<readonly [string, string]>;
  label: string;
}): React.ReactElement {
  const c = SITE_CLIPS[props.clip];
  const ref = useRef<HTMLVideoElement | null>(null);
  const box = useRef<HTMLElement | null>(null);
  const [cap, setCap] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [auto, setAuto] = useState(false);

  useEffect(() => {
    setAuto(!prefersReducedMotion() && !saveData());
    const el = box.current;
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((es) => setVisible(es.some((e) => e.isIntersecting)), { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (visible && auto && !userPaused) {
      v.play().then(
        () => setPlaying(true),
        () => setPlaying(false)
      );
    } else if (!v.paused) {
      v.pause();
      setPlaying(false);
    }
  }, [visible, auto, userPaused]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    if (v.paused) {
      setUserPaused(false);
      setAuto(true);
      void v.play().then(() => setPlaying(true), () => setPlaying(false));
    } else {
      setUserPaused(true);
      v.pause();
      setPlaying(false);
    }
  };
  const order = props.captions.map(([k]) => k);
  return (
    <figure className="s-clip" ref={box} aria-label={props.label} data-testid={`clip-${props.clip}`} style={{ margin: 0, aspectRatio: `${c.width} / ${c.height}` }}>
      <video
        ref={ref}
        src={c.src}
        poster={c.poster}
        width={c.width}
        height={c.height}
        muted
        playsInline
        loop
        preload="none"
        aria-hidden="true"
        tabIndex={-1}
        onTimeUpdate={(e) => setCap(clipCaptionAt(e.currentTarget.currentTime, c.marks, order))}
        onPause={() => setPlaying(false)}
        onPlay={() => setPlaying(true)}
      />
      <span className="s-tag s-clip-tag">{MEDIA.realTag}</span>
      <button type="button" className="s-clip-btn" onClick={toggle} aria-label={playing ? MEDIA.pause : MEDIA.play} aria-pressed={!playing}>
        {playing ? 'Ⅱ' : '▶'}
      </button>
      <figcaption className="s-loop-cap" aria-live="off">
        <span>{props.captions[cap]?.[1] ?? ''}</span>
      </figcaption>
    </figure>
  );
}

export function GameShot(props: { still: SiteStillKey; alt: string; sizes?: string; eager?: boolean; className?: string }): React.ReactElement {
  const s = SITE_STILLS[props.still];
  return (
    <figure className={`s-shot ${props.className ?? ''}`.trim()} style={{ margin: 0 }}>
      <img
        src={s.src}
        srcSet={`${s.src480} 480w, ${s.src} 960w`}
        sizes={props.sizes ?? '(max-width: 720px) 92vw, 480px'}
        width={s.width}
        height={s.height}
        alt={props.alt}
        loading={props.eager ? 'eager' : 'lazy'}
        decoding="async"
      />
      <span className="s-tag s-clip-tag">{MEDIA.realTag}</span>
    </figure>
  );
}
