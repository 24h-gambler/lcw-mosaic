/**
 * App shell (docs/19 1장, world domain): full-screen 3D world plus the two slots other domains fill —
 * the dialog panel (`dialog/DialogPanel.tsx`, docs/19 3장) and the lesson layer (`lesson/LessonLayer.tsx`, docs/19 4장).
 * A slot whose module is not in the build yet stays empty; when it lands, Vite picks it up with no edit here.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Level } from '@lcw/schemas';
import { canRunWorld, createWorld, SCENE_IDS, type NpcRef, type SceneId, type WorldHandle, type WorldTier } from './world/api.js';
import { WORLD_STRINGS as W } from './world/strings.js';
import { COLOR_TOKENS as C, SHAPE_TOKENS as S, TYPOGRAPHY_TOKENS as T } from '@lcw/ui';

/** What a dialog needs besides the NPC (docs/19 3장 DialogPanelProps without npc/onClose). */
export interface DialogConfig {
  level?: Level;
  mode?: 'free' | 'guided' | 'read' | 'recall';
  offers?: Array<{ stars: 1 | 2 | 3; text: string; hintTags: string[] }>;
  hint?: 'full' | 'keyword' | 'initial' | 'picture' | 'none';
  submit?: (u: unknown) => Promise<DialogResultLike>;
  onDone?: (r: DialogResultLike) => void;
  onClose?: () => void;
}

export interface DialogResultLike {
  pass: boolean;
  stars: number;
  feedbackKo: string;
  coinsTotal?: number;
  itemKey?: string;
}

/** Props the shell passes to the lesson layer (docs/19 5장). */
export interface LessonLayerProps {
  world: WorldHandle | null;
  renderDialog: (npc: NpcRef, cfg: DialogConfig) => React.ReactNode;
  onLessonActive?: (active: boolean) => void;
}

type AnyComponent = React.ComponentType<Record<string, unknown>>;
interface DialogModule {
  DialogPanel?: AnyComponent;
  createSoloSubmit?: (npc: NpcRef) => (u: unknown) => Promise<DialogResultLike>;
}
interface LessonModule {
  LessonLayer?: React.ComponentType<LessonLayerProps>;
}

// Optional slots: an empty record when the other domain has not merged its file yet.
const dialogLoaders = import.meta.glob<DialogModule>('./dialog/DialogPanel.tsx');
const lessonLoaders = import.meta.glob<LessonModule>('./lesson/LessonLayer.tsx');

/** Item that appears in hand after a passed line when the server does not name one. */
const DEFAULT_ITEM_BY_CTX: Partial<Record<NpcRef['ctx'], string>> = { cafe: 'honey_tea' };

export function pickTier(search: string, nav: { deviceMemory?: number; hardwareConcurrency?: number }, coarse: boolean): WorldTier {
  const q = new URLSearchParams(search).get('tier');
  if (q === 'low' || q === 'mid' || q === 'high') return q;
  const mem = nav.deviceMemory ?? null;
  const cores = nav.hardwareConcurrency ?? 4;
  if (coarse) return mem !== null && mem < 4 ? 'low' : 'mid';
  if (mem !== null && mem < 4) return 'low';
  return cores >= 8 && (mem === null || mem >= 8) ? 'high' : 'mid';
}

function startSceneFrom(search: string): SceneId | undefined {
  const s = new URLSearchParams(search).get('scene');
  return s && (SCENE_IDS as readonly string[]).includes(s) ? (s as SceneId) : undefined;
}

function NoWorld(): React.ReactElement {
  const code = new URLSearchParams(location.search).get('code');
  const href = `/join${code ? `?code=${encodeURIComponent(code)}` : ''}`;
  return (
    <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: C['paper-50'], padding: 16, fontFamily: T.fonts.ui }}>
      <div style={{ maxWidth: 420, background: C['paper-0'], border: `2px solid ${C['ink-900']}`, borderRadius: S.radiusCardPx, boxShadow: S.shadowDefault, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h1 style={{ margin: 0, fontSize: T.scale.h3.sizePx }}>{W.noWebglTitle}</h1>
        <p style={{ margin: 0, color: C['ink-700'] }}>{W.noWebglBody}</p>
        <a href={href} style={{ alignSelf: 'flex-start', background: C['brand-d'], color: C['paper-0'], padding: '12px 16px', borderRadius: S.radiusButtonPx, border: `2px solid ${C['ink-900']}`, boxShadow: S.shadowDefault, fontWeight: 800, textDecoration: 'none' }}>
          {W.noWebglCta}
        </a>
      </div>
    </div>
  );
}

/** Wraps the dialog panel so opening pauses the world and the result plays the world's reward. */
function DialogHost(props: { Panel: AnyComponent; world: WorldHandle; npc: NpcRef; cfg: DialogConfig; submit: NonNullable<DialogConfig['submit']>; onClose: () => void }): React.ReactElement {
  const { Panel, world, npc, cfg, submit, onClose } = props;
  useEffect(() => {
    world.setPaused(true);
    return () => world.setPaused(false);
  }, [world]);
  const onDone = useCallback(
    (r: DialogResultLike) => {
      if (r.pass) {
        const stars = Math.max(0, Math.min(3, Math.round(r.stars))) as 0 | 1 | 2 | 3;
        world.celebrate(stars);
        const item = r.itemKey ?? DEFAULT_ITEM_BY_CTX[npc.ctx];
        if (item) world.giveItem(item);
      } else {
        world.celebrate(0);
      }
      cfg.onDone?.(r);
    },
    [world, npc, cfg]
  );
  const close = useCallback(() => {
    cfg.onClose?.();
    onClose();
  }, [cfg, onClose]);
  return (
    <Panel
      npc={npc}
      level={cfg.level ?? 'L1'}
      mode={cfg.mode ?? 'guided'}
      offers={cfg.offers ?? []}
      hint={cfg.hint ?? 'full'}
      submit={submit}
      onDone={onDone}
      onClose={close}
    />
  );
}

export function App(): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);
  const [world, setWorld] = useState<WorldHandle | null>(null);
  const [dialogMod, setDialogMod] = useState<DialogModule | null>(null);
  const [lessonMod, setLessonMod] = useState<LessonModule | null>(null);
  const [soloNpc, setSoloNpc] = useState<NpcRef | null>(null);
  const [failed, setFailed] = useState(false);
  const lessonActive = useRef(false);
  const ok = useMemo(() => canRunWorld(), []);

  useEffect(() => {
    for (const load of Object.values(dialogLoaders)) void load().then(setDialogMod);
    for (const load of Object.values(lessonLoaders)) void load().then(setLessonMod);
  }, []);

  useEffect(() => {
    if (!ok || !canvasRef.current) return;
    let handle: WorldHandle | null = null;
    let cancelled = false;
    const nav = navigator as Navigator & { deviceMemory?: number };
    const tier = pickTier(location.search, nav, matchMedia('(pointer: coarse)').matches);
    createWorld({ canvas: canvasRef.current, tier, startScene: startSceneFrom(location.search), hudRoot: hudRef.current ?? undefined })
      .then((h) => {
        if (cancelled) {
          h.dispose();
          return;
        }
        handle = h;
        setWorld(h);
        (window as unknown as { __lcwWorld?: WorldHandle }).__lcwWorld = h;
      })
      .catch((err: unknown) => {
        console.error('world failed to start', err);
        setFailed(true);
      });
    return () => {
      cancelled = true;
      handle?.dispose();
    };
  }, [ok]);

  // Solo play: tapping an NPC opens the dialog panel when no lesson is running.
  useEffect(() => {
    if (!world) return;
    return world.onNpcInteract((npc) => {
      if (lessonActive.current) return;
      if (dialogMod?.DialogPanel && dialogMod.createSoloSubmit) setSoloNpc(npc);
    });
  }, [world, dialogMod]);

  const renderDialog = useCallback(
    (npc: NpcRef, cfg: DialogConfig): React.ReactNode => {
      const Panel = dialogMod?.DialogPanel;
      if (!Panel || !world) return null;
      const submit = cfg.submit ?? dialogMod?.createSoloSubmit?.(npc);
      if (!submit) return null;
      return <DialogHost key={npc.id} Panel={Panel} world={world} npc={npc} cfg={cfg} submit={submit} onClose={() => undefined} />;
    },
    [dialogMod, world]
  );

  if (!ok || failed) return <NoWorld />;
  const Lesson = lessonMod?.LessonLayer;
  const SoloPanel = dialogMod?.DialogPanel;
  const soloSubmit = soloNpc && dialogMod?.createSoloSubmit ? dialogMod.createSoloSubmit(soloNpc) : null;
  return (
    <div style={{ position: 'fixed', inset: 0, overflow: 'hidden', background: C['paper-50'], touchAction: 'none' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block' }} />
      <div ref={hudRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <div style={{ pointerEvents: 'auto' }}>
          {Lesson ? (
            <Lesson
              world={world}
              renderDialog={renderDialog}
              onLessonActive={(a: boolean) => {
                lessonActive.current = a;
                world?.setLessonBadge?.(a);
              }}
            />
          ) : null}
          {world && SoloPanel && soloNpc && soloSubmit ? (
            <DialogHost Panel={SoloPanel} world={world} npc={soloNpc} cfg={{}} submit={soloSubmit} onClose={() => setSoloNpc(null)} />
          ) : null}
        </div>
      </div>
    </div>
  );
}
