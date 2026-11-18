/**
 * G14 설정 (docs/08 8.6, 11장 접근성, docs/12 2장): 조작 · 소리 · 화면 · 접근성 · 마이크 점검. Every control changes
 * `frame/settings.ts`, which puts it into effect at once (audio buses, <html> text size / font / colours / motion / focus,
 * the world's look and FPS, the dialog's mic mode and voice) and keeps it on the device (and the server for accounts).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { LangLevel } from '@lcw/content';
import { SHAPE_TOKENS, TYPOGRAPHY_TOKENS } from '@lcw/ui';
import { FRAME_STRINGS as F, FRAME_STRINGS_EN as E, FRAME_STRINGS_KO, frameBi } from '../strings.js';
import type { MenuPanelProps } from './types.js';
import { KoHelp } from './ko-help.js';
import {
  KEY_ACTIONS,
  DEFAULT_KEYS,
  SETTINGS_LIMITS,
  browserSettingsStore,
  frameSettings,
  onFrameSettings,
  rebindKey,
  setKeyCapture,
  updateFrameSettings,
  type FrameSettings,
  type KeyAction,
  type Quality,
  type VolumeGroup
} from '../settings.js';
import { helpKoOn, onLearnLang, setHelpKo } from '../../world/lang.js';
import { MIC_STATUS_KEY, MicCheckCard, readMicStatus, type MicCheckStatus } from '../../dialog/FirstVisitGuide.js';
import { playSfx, speakEnglish, unlockDialogAudio } from '../../dialog/sound.js';

type Section = 'controls' | 'sound' | 'screen' | 'access' | 'mic';
const SECTIONS: readonly Section[] = ['controls', 'sound', 'screen', 'access', 'mic'];
/** Read at render time: the strings follow the screen language. */
const sectionLabel = (sec: Section): string => ({ controls: E.sControls, sound: E.sSound, screen: E.sScreen, access: E.sAccess, mic: E.sMic })[sec];
const SECTION_ICON: Record<Section, string> = { controls: '🎮', sound: '🔊', screen: '🖥️', access: '♿', mic: '🎤' };

const KEY_GROUPS: ReadonlyArray<readonly [string, readonly KeyAction[]]> = [
  ['move', ['forward', 'back', 'left', 'right', 'jump', 'run']],
  ['act', ['talk', 'view', 'mirror']],
  ['menu', ['bag', 'map', 'book']],
  ['build', ['rotate', 'undo', 'chest']]
];

/** A key's name on the screen (English: "Left Shift"); `names` picks the table (the Korean one for the help line). */
export function keyLabel(code: string, names: Readonly<Record<string, string>> = E.keyNames): string {
  if (names[code]) return names[code]!;
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `Num ${code.slice(6)}`;
  return code;
}

/** Both sides of a key name, for the rebind notes (each sentence with its own words). */
const keyBi = (code: string): { en: string; ko: string } => ({ en: keyLabel(code), ko: keyLabel(code, FRAME_STRINGS_KO.keyNames) });

const T = TYPOGRAPHY_TOKENS.scale;
const px = (n: number): string => `calc(${n}px * var(--fs))`;
const S = SHAPE_TOKENS;
const PANEL_STYLE_ID = 'lcw-frame-settings-panel-style';
const PANEL_CSS = `
.lcw-set{display:grid;grid-template-columns:${px(176)} minmax(0,1fr);gap:16px;min-height:100%}
.lcw-set__nav{display:flex;flex-direction:column;gap:6px;position:sticky;top:0;align-self:start}
.lcw-set__nav button{display:flex;align-items:center;gap:8px;min-height:${S.touchTargetMinPx}px;padding:6px 12px;text-align:left;border:${S.borderWidthPx}px solid transparent;
  border-radius:${S.radiusButtonPx}px;background:transparent;font-weight:700;font-size:${px(T.small.sizePx)};cursor:pointer;color:var(--c-ink-700)}
.lcw-set__nav button[aria-selected="true"]{background:var(--c-paper-0);border-color:var(--c-ink-900);color:var(--c-ink-900);box-shadow:${S.shadowPressed}}
.lcw-set__main{min-width:0;display:flex;flex-direction:column;gap:12px}
.lcw-set__saved{margin:0}
.lcw-set__row{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px 16px;padding:12px;background:var(--c-paper-0);
  border:${S.borderWidthPx}px solid var(--c-ink-900);border-radius:${S.radiusCardPx}px}
.lcw-set__lbl{display:flex;flex-direction:column;gap:2px;min-width:min(220px,100%);flex:1 1 220px}
.lcw-set__lbl strong{font-size:${px(T.body.sizePx)}}
.lcw-set__row.col{flex-direction:column;align-items:stretch}
.lcw-set__row.col .lcw-set__lbl{flex:none}
.lcw-set__ctl{display:flex;flex-wrap:wrap;align-items:center;gap:8px;flex:0 1 auto;max-width:100%}
.lcw-set__ctl.wide{flex:1 1 260px}
.lcw-set input[type=range]{flex:1;min-width:140px;height:${S.touchTargetMinPx}px;accent-color:var(--c-brand-d);cursor:pointer}
.lcw-set output{min-width:4.5em;font-weight:800;font-variant-numeric:tabular-nums;text-align:right}
.lcw-set .seg{display:flex;flex-wrap:wrap;gap:4px}
.lcw-set .seg button{min-height:${S.touchTargetMinPx}px;min-width:${S.touchTargetMinPx}px;padding:4px 12px;border:${S.borderWidthPx}px solid var(--c-ink-900);border-radius:${S.radiusButtonPx}px;
  background:var(--c-paper-0);font-weight:700;font-size:${px(T.small.sizePx)};cursor:pointer}
.lcw-set .seg button[aria-checked="true"]{background:var(--c-sky-d);color:var(--c-paper-0)}
.lcw-set .seg button[aria-checked="true"]::before{content:"✓ "}
.lcw-switch{display:inline-flex;align-items:center;gap:8px;min-height:${S.touchTargetMinPx}px;padding:4px 10px 4px 4px;border:${S.borderWidthPx}px solid var(--c-ink-900);
  border-radius:999px;background:var(--c-paper-100);font-weight:800;font-size:${px(T.small.sizePx)};cursor:pointer}
.lcw-switch i{width:${px(44)};height:${px(26)};border-radius:999px;border:${S.borderWidthPx}px solid var(--c-ink-900);background:var(--c-paper-0);position:relative;flex:none}
.lcw-switch i::after{content:"";position:absolute;top:2px;left:2px;width:calc(50% - 4px);height:calc(100% - 4px);border-radius:50%;background:var(--c-ink-500);transition:left 120ms ease-out}
.lcw-switch[aria-checked="true"]{background:var(--c-leaf)}
.lcw-switch[aria-checked="true"] i::after{left:calc(50% + 2px);background:var(--c-leaf-d)}
.lcw-set__keys{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:8px 16px}
.lcw-set__kgroup{display:flex;flex-direction:column;gap:6px}
.lcw-set__kgroup h4{margin:4px 0 0;font-size:${px(T.small.sizePx)};color:var(--c-ink-700)}
.lcw-set__key{display:flex;align-items:center;gap:8px;min-height:${S.touchTargetMinPx}px}
.lcw-set__key span{flex:1;min-width:0}
.lcw-set__key .btn{min-height:36px;padding:2px 10px}
.lcw-kbd{display:inline-flex;align-items:center;justify-content:center;min-width:${px(36)};min-height:${px(32)};padding:0 8px;border:${S.borderWidthPx}px solid var(--c-ink-900);
  border-bottom-width:4px;border-radius:${S.radiusButtonPx}px;background:var(--c-paper-50);font-weight:800;font-size:${px(T.small.sizePx)};white-space:nowrap}
.lcw-kbd.changed{background:var(--c-sun)}
.lcw-set__cap{flex:1;min-width:0;min-height:36px;padding:4px 8px;border:${S.borderWidthPx}px dashed var(--c-sky-d);border-radius:${S.radiusButtonPx}px;background:var(--c-paper-0);
  font:inherit;font-weight:700;color:var(--c-sky-d);caret-color:transparent}
.lcw-set__fixed{display:flex;flex-wrap:wrap;gap:6px 16px;margin:0;padding:0;list-style:none}
.lcw-set__fixed li{display:flex;align-items:center;gap:6px}
.lcw-set__sample{padding:8px 12px;border:${S.borderWidthPx}px dashed var(--c-line-200);border-radius:${S.radiusCardPx}px;background:var(--c-paper-50);overflow-wrap:anywhere}
.lcw-set__chips{display:flex;gap:8px;flex-wrap:wrap}
.lcw-set__chips span{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border:${S.borderWidthPx}px solid var(--c-ink-900);border-radius:999px;font-weight:800;font-size:${px(T.small.sizePx)}}
.lcw-set__live{min-height:1.5em}
@media (max-width:720px){
  .lcw-set{grid-template-columns:minmax(0,1fr);gap:10px}
  .lcw-set__nav{flex-direction:row;flex-wrap:wrap;position:static;padding-bottom:2px}
  .lcw-set__nav::-webkit-scrollbar{display:none}
  .lcw-set__nav button{flex:none}
}
@media (max-height:500px){
  .lcw-set{grid-template-columns:minmax(0,1fr);gap:8px}
  .lcw-set__nav{flex-direction:row;overflow-x:auto;position:static;scrollbar-width:none}
  .lcw-set__nav button{flex:none;min-height:40px}
  .lcw-set__row{padding:8px 10px}
}
`;

function ensurePanelStyle(): void {
  if (typeof document === 'undefined' || document.getElementById(PANEL_STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = PANEL_STYLE_ID;
  st.textContent = PANEL_CSS;
  document.head.appendChild(st);
}

function useSettings(): Readonly<FrameSettings> {
  const [s, set] = useState(frameSettings());
  useEffect(() => onFrameSettings(set), []);
  return s;
}

function Row(props: { title: string; hint?: string; wide?: boolean; children: React.ReactNode; id?: string; koAlways?: string }): React.ReactElement {
  return (
    <div className="lcw-set__row">
      <div className="lcw-set__lbl">
        <strong id={props.id}>{props.title}</strong>
        {props.koAlways ? (
          <span className="ko" lang="ko">
            {props.koAlways}
          </span>
        ) : (
          <KoHelp of={props.title} />
        )}
        {props.hint ? (
          <span className="muted">
            {props.hint}
            <KoHelp of={props.hint} />
          </span>
        ) : null}
      </div>
      <div className={`lcw-set__ctl${props.wide ? ' wide' : ''}`}>{props.children}</div>
    </div>
  );
}

function Switch(props: { on: boolean; label: string; onChange(on: boolean): void }): React.ReactElement {
  return (
    <button type="button" role="switch" className="lcw-switch" aria-checked={props.on} aria-label={props.label} onClick={() => props.onChange(!props.on)}>
      <i aria-hidden="true" />
      <span aria-hidden="true">{props.on ? F.on : F.off}</span>
    </button>
  );
}

function Seg<V extends string>(props: { value: V; options: ReadonlyArray<readonly [V, string]>; label: string; onChange(v: V): void }): React.ReactElement {
  return (
    <div className="seg" role="radiogroup" aria-label={props.label}>
      {props.options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={props.value === v} onClick={() => props.onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

function Slider(props: { value: number; lim: { min: number; max: number; step: number }; label: string; show(v: number): string; onChange(v: number): void }): React.ReactElement {
  return (
    <>
      <input
        type="range"
        min={props.lim.min}
        max={props.lim.max}
        step={props.lim.step}
        value={props.value}
        aria-label={props.label}
        aria-valuetext={props.show(props.value)}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <output>{props.show(props.value)}</output>
    </>
  );
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

// ---- 조작

function KeysEditor({ s }: { s: Readonly<FrameSettings> }): React.ReactElement {
  const [wait, setWait] = useState<KeyAction | null>(null);
  const [note, setNote] = useState('');
  const capRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    setKeyCapture(wait !== null);
    if (wait) capRef.current?.focus();
    return () => setKeyCapture(false);
  }, [wait]);

  const onCapture = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (!wait) return;
    e.preventDefault();
    e.stopPropagation();
    const code = e.nativeEvent.code;
    if (!code || code === 'Unidentified') return;
    const action = wait;
    if (code === 'Escape') {
      setWait(null);
      setNote('');
      requestAnimationFrame(() => document.getElementById(`lcw-set-key-${action}`)?.focus());
      return;
    }
    const r = rebindKey(s.keys, action, code);
    if (!r.ok) {
      setNote(F.rebindReserved(keyBi(code)));
      return;
    }
    updateFrameSettings({ keys: r.keys });
    const swapped = r.swappedWith;
    setNote(
      swapped
        ? F.rebindSwapped(keyBi(code), frameBi((t) => t.keyActions[swapped]))
        : F.rebindDone(keyBi(code), frameBi((t) => t.keyActions[action]))
    );
    setWait(null);
    requestAnimationFrame(() => document.getElementById(`lcw-set-key-${action}`)?.focus());
  };

  const changed = KEY_ACTIONS.some((a) => s.keys[a] !== DEFAULT_KEYS[a]);
  return (
    <div className="lcw-set__row col">
      <div className="lcw-set__lbl">
        <strong>{E.keysTitle}</strong>
        <KoHelp of={E.keysTitle} />
        <span className="muted">
          {E.keysHint}
          <KoHelp of={E.keysHint} />
        </span>
      </div>
      <div className="lcw-set__keys">
        {KEY_GROUPS.map(([g, actions]) => (
          <div key={g} className="lcw-set__kgroup">
            <h4>{F.keyGroups[g]}</h4>
            {actions.map((a) => (
              <div key={a} className="lcw-set__key">
                <span>{F.keyActions[a]}</span>
                {wait === a ? (
                  <input
                    ref={capRef}
                    className="lcw-set__cap"
                    readOnly
                    inputMode="none"
                    value={F.rebindWait}
                    aria-label={`${F.keyActions[a]}: ${F.rebindWait}`}
                    onKeyDown={onCapture}
                    onBlur={() => setWait(null)}
                  />
                ) : (
                  <>
                    <kbd className={`lcw-kbd${s.keys[a] !== DEFAULT_KEYS[a] ? ' changed' : ''}`}>{keyLabel(s.keys[a])}</kbd>
                    <button
                      id={`lcw-set-key-${a}`}
                      type="button"
                      className="btn"
                      aria-label={`${F.keyActions[a]} ${keyLabel(s.keys[a])} ${F.rebind}`}
                      onClick={() => {
                        setNote('');
                        setWait(a);
                      }}
                    >
                      {F.rebind}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="lcw-set__live muted" aria-live="polite">
        {note}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h4 style={{ margin: '0 0 6px', fontSize: px(T.small.sizePx) }}>{F.keyFixedTitle}</h4>
          <ul className="lcw-set__fixed">
            {F.keyFixed.map(([k, what]) => (
              <li key={k}>
                <kbd className="lcw-kbd">{k}</kbd>
                <span className="muted">{what}</span>
              </li>
            ))}
          </ul>
        </div>
        <button type="button" className="btn" disabled={!changed} onClick={() => updateFrameSettings({ keys: { ...DEFAULT_KEYS } })}>
          {F.keysReset}
        </button>
      </div>
    </div>
  );
}

function ControlsSection({ s }: { s: Readonly<FrameSettings> }): React.ReactElement {
  return (
    <>
      {/* look speed first (what children change most); the long key list last */}
      <Row title={E.touchTitle}>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {F.touchGuide.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      </Row>
      <Row title={E.lookMouseTitle} wide>
        <Slider value={s.lookMouse} lim={SETTINGS_LIMITS.look} label={F.lookMouseTitle} show={pct} onChange={(v) => updateFrameSettings({ lookMouse: v })} />
      </Row>
      <Row title={E.lookTouchTitle} wide>
        <Slider value={s.lookTouch} lim={SETTINGS_LIMITS.look} label={F.lookTouchTitle} show={pct} onChange={(v) => updateFrameSettings({ lookTouch: v })} />
      </Row>
      <Row title={E.invertYTitle} hint={E.invertYHint}>
        <Switch on={s.invertY} label={F.invertYTitle} onChange={(on) => updateFrameSettings({ invertY: on })} />
      </Row>
      <Row title={E.autoJumpTitle} hint={E.autoJumpHint}>
        <Switch on={s.autoJump} label={F.autoJumpTitle} onChange={(on) => updateFrameSettings({ autoJump: on })} />
      </Row>
      <Row title={E.micModeTitle} hint={E.micModeHint}>
        <Seg
          value={s.micMode}
          label={F.micModeTitle}
          options={[
            ['toggle', F.micModeToggle],
            ['hold', F.micModeHold]
          ]}
          onChange={(v) => updateFrameSettings({ micMode: v })}
        />
      </Row>
      <KeysEditor s={s} />
    </>
  );
}

// ---- 소리

function SoundSection({ s, level }: { s: Readonly<FrameSettings>; level: LangLevel }): React.ReactElement {
  const vol = (g: VolumeGroup, v: number): void => {
    unlockDialogAudio();
    updateFrameSettings({ volume: { ...s.volume, [g]: v } });
  };
  const showVol = (v: number): string => (v <= 0 ? F.volMuted : pct(v));
  const tryVoice = (): void => {
    unlockDialogAudio();
    void speakEnglish(F.volTryLine, level);
  };
  return (
    <>
      {(['master', 'music', 'effects', 'voice'] as const).map((g) => (
        <Row key={g} title={E.volTitles[g]!} hint={g === 'voice' ? E.volHint : undefined} wide>
          <Slider value={s.volume[g]} lim={SETTINGS_LIMITS.volume} label={F.volTitles[g]!} show={showVol} onChange={(v) => vol(g, v)} />
          {g === 'effects' || g === 'master' ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                unlockDialogAudio();
                playSfx('coin.drop');
              }}
            >
              🔔 {F.volTry}
            </button>
          ) : null}
          {g === 'voice' ? (
            <button type="button" className="btn" onClick={tryVoice}>
              🗣️ {F.volTry}
            </button>
          ) : null}
        </Row>
      ))}
      <h3>{E.npcVoiceTitle}<KoHelp of={E.npcVoiceTitle} /></h3>
      <Row title={E.voiceRateTitle} wide>
        <Slider
          value={s.voiceRate}
          lim={SETTINGS_LIMITS.voiceRate}
          label={F.voiceRateTitle}
          show={(v) => F.voiceRateNames[String(v)] ?? pct(v)}
          onChange={(v) => updateFrameSettings({ voiceRate: v })}
        />
        <button type="button" className="btn" onClick={tryVoice}>
          🗣️ {F.volTry}
        </button>
      </Row>
      <Row title={E.neuralTitle} hint={E.neuralHint}>
        <Switch on={s.neuralVoice} label={F.neuralTitle} onChange={(on) => updateFrameSettings({ neuralVoice: on })} />
      </Row>
    </>
  );
}

// ---- 화면

const TEXT_STEPS = [1, 1.1, 1.2, 1.3, 1.4, 1.5] as const;

function ScreenSection({ s, props }: { s: Readonly<FrameSettings>; props: MenuPanelProps }): React.ReactElement {
  const stats = props.world?.getStats?.() as (ReturnType<NonNullable<NonNullable<MenuPanelProps['world']>['getStats']>> & { autoTier?: string }) | undefined;
  const tierNow = stats?.autoTier ?? stats?.tier;
  const liveSwitch = typeof (props.world as { setGraphics?: unknown } | null)?.setGraphics === 'function';
  return (
    <>
      <Row title={E.textSizeTitle} hint={E.textSizeHint} wide>
        <Seg
          value={String(s.textScale)}
          label={F.textSizeTitle}
          options={TEXT_STEPS.map((v) => [String(v), pct(v)] as const)}
          onChange={(v) => updateFrameSettings({ textScale: Number(v) })}
        />
        <div className="lcw-set__sample" style={{ width: '100%' }}>
          {F.textSizeSample}
        </div>
      </Row>
      <Row title={E.motionTitle} hint={E.motionHint}>
        <Seg
          value={s.reduceMotion === null ? 'auto' : s.reduceMotion ? 'on' : 'off'}
          label={F.motionTitle}
          options={[
            ['auto', F.motionDevice],
            ['on', F.on],
            ['off', F.off]
          ]}
          onChange={(v) => updateFrameSettings({ reduceMotion: v === 'auto' ? null : v === 'on' })}
        />
      </Row>
      <Row title={E.qualityTitle} hint={liveSwitch ? E.qualityHintLive : E.qualityHint}>
        <Seg
          value={s.quality}
          label={F.qualityTitle}
          options={(['auto', 'low', 'mid', 'high'] as const).map(
            (q) => [q, q === 'auto' && tierNow ? F.qualityAutoNow(frameBi((t) => t.qualities[tierNow] ?? tierNow)) : F.qualities[q]!] as const
          )}
          onChange={(v: Quality) => updateFrameSettings({ quality: v })}
        />
        {tierNow && s.quality !== 'auto' ? <span className="muted">{F.qualityNow(frameBi((t) => t.qualities[tierNow] ?? tierNow))}</span> : null}
        {!liveSwitch && !props.lessonOn && s.quality !== 'auto' && tierNow && s.quality !== tierNow ? (
          <button type="button" className="btn pri" onClick={() => location.reload()}>
            {F.qualityRestart}
          </button>
        ) : null}
      </Row>
      <Row title={E.viewChunksTitle} hint={E.viewChunksHint}>
        <Seg
          value={s.viewChunks === null ? 'tier' : String(s.viewChunks)}
          label={F.viewChunksTitle}
          options={[['tier', F.tierDefault] as const, ...[3, 4, 5, 6, 7, 8].map((n) => [String(n), String(n)] as const)]}
          onChange={(v) => updateFrameSettings({ viewChunks: v === 'tier' ? null : Number(v) })}
        />
      </Row>
      <Row title={E.shadowsTitle} hint={E.shadowsHint}>
        <Seg
          value={s.shadows === null ? 'tier' : s.shadows ? 'on' : 'off'}
          label={F.shadowsTitle}
          options={[
            ['tier', F.tierDefault],
            ['on', F.on],
            ['off', F.off]
          ]}
          onChange={(v) => updateFrameSettings({ shadows: v === 'tier' ? null : v === 'on' })}
        />
      </Row>
      <Row title={E.renderScaleTitle} hint={E.renderScaleHint}>
        <Seg
          value={s.renderScale === null ? 'tier' : String(s.renderScale)}
          label={F.renderScaleTitle}
          options={[['tier', F.tierDefault] as const, ...[0.5, 0.6, 0.75, 0.9, 1].map((n) => [String(n), pct(n)] as const)]}
          onChange={(v) => updateFrameSettings({ renderScale: v === 'tier' ? null : Number(v) })}
        />
      </Row>
      <Row title={E.fpsTitle} hint={E.fpsHint}>
        <Switch on={s.showFps} label={F.fpsTitle} onChange={(on) => updateFrameSettings({ showFps: on })} />
      </Row>
    </>
  );
}

// ---- 접근성

function AccessSection({ s }: { s: Readonly<FrameSettings> }): React.ReactElement {
  // Korean help is kept by world/lang.ts (one switch with the start screen), not in the settings record
  const [helpKo, setHelpKoView] = useState(helpKoOn());
  useEffect(() => onLearnLang((v) => setHelpKoView(v.helpKo)), []);
  return (
    <>
      {/* first, and always with its Korean name, so a child who reads only Korean can find it */}
      <Row title={E.helpKoTitle} hint={E.helpKoHint} koAlways={FRAME_STRINGS_KO.helpKoTitle}>
        <Switch on={helpKo} label={F.helpKoTitle} onChange={(on) => setHelpKo(on)} />
      </Row>
      <Row title={E.readableTitle} hint={E.readableHint}>
        <Switch on={s.readableFont} label={F.readableTitle} onChange={(on) => updateFrameSettings({ readableFont: on })} />
        <span className="lcw-set__sample" lang="en" style={{ fontFamily: s.readableFont ? TYPOGRAPHY_TOKENS.fonts.dyslexic : TYPOGRAPHY_TOKENS.fonts.target }}>
          {F.readableSample}
        </span>
      </Row>
      <Row title={E.assistTitle} hint={E.assistHint}>
        <Switch on={s.colorAssist} label={F.assistTitle} onChange={(on) => updateFrameSettings({ colorAssist: on })} />
        <span className="lcw-set__chips" aria-hidden="true">
          <span style={{ background: 'var(--c-leaf)' }}>✓ {F.assistOk}</span>
          <span style={{ background: 'var(--c-danger)' }}>! {F.assistWarn}</span>
        </span>
      </Row>
      <Row title={E.syllableTitle} hint={E.syllableHint}>
        <Switch on={s.syllables} label={F.syllableTitle} onChange={(on) => updateFrameSettings({ syllables: on })} />
        <span className="lcw-set__sample" lang="en" style={{ fontFamily: TYPOGRAPHY_TOKENS.fonts.target, fontWeight: 700 }}>
          {s.syllables ? F.syllableSample : F.syllableSample.replace(/·/g, '')}
        </span>
      </Row>
      <Row title={E.focusTitle} hint={E.focusHint}>
        <Switch on={s.strongFocus} label={F.focusTitle} onChange={(on) => updateFrameSettings({ strongFocus: on })} />
      </Row>
      <div className="note">
        <strong>{F.noMicTitle}</strong> · {F.noMicHint}
      </div>
    </>
  );
}

// ---- 마이크 점검 (the dialog lane's "Hello!" card, #61)

function writeMicStatus(st: MicCheckStatus): void {
  try {
    sessionStorage.setItem(MIC_STATUS_KEY, st);
  } catch {
    /* private mode: the result shows on screen only */
  }
}

function MicSection(): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [last, setLast] = useState<MicCheckStatus | null>(() => (typeof sessionStorage === 'undefined' ? null : readMicStatus()));
  const startRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.lcw-firstvisit-mic')?.focus());
  }, [open]);
  return (
    <>
      <p>{F.micCheckIntro}</p>
      <Row title={E.micCheckLast}>
        <strong style={{ color: last === 'ok' ? 'var(--c-leaf-d)' : 'var(--c-ink-700)' }}>
          {last === 'ok' ? '✓ ' : ''}
          {last ? F.micCheckStatus[last] : F.micCheckNever}
        </strong>
        <button ref={startRef} type="button" className="btn pri" onClick={() => setOpen(true)}>
          🎤 {F.micCheckStart}
        </button>
      </Row>
      <ul className="muted" style={{ margin: 0, paddingLeft: 18 }}>
        {F.micCheckTips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {open ? (
        <MicCheckCard
          title={F.sMic}
          tips
          onDone={(st) => {
            writeMicStatus(st);
            setLast(st);
            setOpen(false);
            requestAnimationFrame(() => startRef.current?.focus());
          }}
        />
      ) : null}
    </>
  );
}

export function SettingsPanel(props: MenuPanelProps): React.ReactElement {
  ensurePanelStyle();
  const s = useSettings();
  const [sec, setSec] = useState<Section>('controls');
  const saved = useMemo(() => browserSettingsStore() !== null, []);
  const level: LangLevel = props.identity?.kind === 'child' ? (props.identity.level as LangLevel) : 'L1';
  const navRef = useRef<HTMLDivElement | null>(null);
  const onNavKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    e.stopPropagation();
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
    const next = SECTIONS[(SECTIONS.indexOf(sec) + d + SECTIONS.length) % SECTIONS.length]!;
    setSec(next);
    requestAnimationFrame(() => navRef.current?.querySelector<HTMLElement>(`[data-sec="${next}"]`)?.focus());
  };
  return (
    <div className="lcw-set">
      <div className="lcw-set__nav" role="tablist" aria-orientation="vertical" aria-label={F.settingsTitle} ref={navRef} onKeyDown={onNavKey}>
        {SECTIONS.map((x) => (
          <button
            key={x}
            type="button"
            role="tab"
            data-sec={x}
            id={`lcw-set-tab-${x}`}
            aria-selected={sec === x}
            aria-controls="lcw-set-sec"
            tabIndex={sec === x ? 0 : -1}
            onClick={() => setSec(x)}
          >
            <span aria-hidden="true">{SECTION_ICON[x]}</span>
            <span>
              {sectionLabel(x)}
              <KoHelp of={sectionLabel(x)} />
            </span>
          </button>
        ))}
      </div>
      <div className="lcw-set__main" id="lcw-set-sec" role="tabpanel" aria-labelledby={`lcw-set-tab-${sec}`}>
        <h2>{sectionLabel(sec)}<KoHelp of={sectionLabel(sec)} /></h2>
        <p className="muted lcw-set__saved">{saved ? E.settingsSavedHere : E.settingsNotSaved}<KoHelp of={saved ? E.settingsSavedHere : E.settingsNotSaved} /></p>
        {sec === 'controls' ? <ControlsSection s={s} /> : null}
        {sec === 'sound' ? <SoundSection s={s} level={level} /> : null}
        {sec === 'screen' ? <ScreenSection s={s} props={props} /> : null}
        {sec === 'access' ? <AccessSection s={s} /> : null}
        {sec === 'mic' ? <MicSection /> : null}
      </div>
    </div>
  );
}
