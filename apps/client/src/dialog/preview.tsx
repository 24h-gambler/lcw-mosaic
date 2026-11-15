import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { COLOR_TOKENS } from '@lcw/ui';
import { DialogPanel } from './DialogPanel.js';
import { createScriptedSpeechEngine, createBrowserSpeechEngine, type MicIssue } from './speech.js';
import { createLessonSubmit, createSoloSubmitWith } from './submit.js';
import type { DialogHint, DialogMode, DialogOffer, DialogResult, Level, NpcRef } from './types.js';

/**
 * Dev-only stand-alone page for the dialog window (vite dev: /game/dialog-preview.html). Not part of the build.
 * Query: npc=cafe|trade_shop|guide, level=L1..L3, hint=full|keyword|initial|picture|none, mode, fs=1..1.5,
 * say=line1|line2 (scripted mic; "denied"/"no_speech" simulate failures), mic=in_app|unsupported|denied,
 * api=<edge base url> + token=<student token> (real server scoring; lesson=1 → /v1/lesson/utterance).
 */

const q = new URLSearchParams(location.search);
const ctx = (q.get('npc') ?? 'cafe') as NpcRef['ctx'];
const NPCS: Record<string, NpcRef> = {
  cafe: { id: 'cafe_owner', ctx: 'cafe', nameKo: '꿀벌 카페 주인', nameEn: 'Honey' },
  trade_shop: { id: 'shop_owner', ctx: 'trade_shop', nameKo: '물물교환 상점 주인', nameEn: 'Pip' },
  guide: { id: 'guide', ctx: 'guide', nameKo: '광장 안내인', nameEn: 'Fern' }
};
const npc = NPCS[ctx] ?? NPCS.cafe!;
const level = (q.get('level') ?? 'L1') as Level;
const hint = (q.get('hint') ?? 'full') as DialogHint;
const mode = (q.get('mode') ?? 'guided') as DialogMode;
const fs = Number(q.get('fs') ?? '1');
const say = q.get('say');
const micOverride = q.get('mic') as MicIssue | null;
const offersParam = q.get('offers');
const offers: DialogOffer[] = offersParam ? (JSON.parse(offersParam) as DialogOffer[]) : [];

const speech = micOverride
  ? { source: 'browser' as const, availability: () => ({ ok: false as const, issue: micOverride }), start: createScriptedSpeechEngine([]).start }
  : say
    ? createScriptedSpeechEngine(say.split('|').map((s) => (s === 'null' ? null : s)), { delayMs: Number(q.get('delay') ?? '350') })
    : createBrowserSpeechEngine();

const api = q.get('api');
const token = q.get('token') ?? '';
const submit = api
  ? q.get('lesson') === '1'
    ? createLessonSubmit({ token, baseUrl: api })
    : createSoloSubmitWith({ token, npc, baseUrl: api })
  : async (): Promise<DialogResult> => {
      throw new Error('preview without api');
    };

function Preview() {
  const [open, setOpen] = useState(true);
  const [last, setLast] = useState<DialogResult | null>(null);
  return (
    <div
      style={{
        minHeight: '100vh',
        background: `linear-gradient(180deg, ${COLOR_TOKENS.sky} 0%, ${COLOR_TOKENS['paper-100']} 70%)`,
        fontFamily: 'system-ui'
      }}
    >
      <div style={{ padding: 16, color: COLOR_TOKENS['ink-900'] }} id="preview-status">
        {last ? `done: pass=${last.pass} stars=${last.stars} coins=${last.coinsTotal ?? '-'} item=${last.itemKey ?? '-'} asked=${last.askedKey ?? '-'}` : 'preview'}
        {!open ? (
          <button type="button" style={{ marginLeft: 12 }} onClick={() => setOpen(true)}>
            open
          </button>
        ) : null}
      </div>
      {open ? (
        <DialogPanel
          npc={npc}
          level={level}
          mode={mode}
          offers={offers}
          hint={hint}
          fontScale={fs}
          speech={speech}
          submit={submit}
          onDone={(r) => {
            setLast(r);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Preview />);
