import { describe, expect, it } from 'vitest';
import { ADVENTURE_CHAPTERS, adventureFixedLines, islanderVoice } from '../adventure.js';
import { castVoices, isLocalTtsEngine, npcCast } from '../npc-cast.js';
import { localTtsLines, ttsVoiceId } from '../tts-lines.js';

/**
 * R2625 (11-19): every /adventure/ islander speaks in a Kokoro voice of its own, from one table (the cast pack's
 * `islanders`), made on the operator's GPU like the model voice; a line never falls to the device voice for want of
 * a night's prebuild, and two islanders never share a voice.
 */
describe('islander voices', () => {
  const pack = npcCast('en');
  const people = ADVENTURE_CHAPTERS.flatMap((ch) => [...ch.critters.map((c) => c.id), ch.guardian.id, ch.villager.nameEn]);

  it('every islander (critters, guardians, villagers) has its own entry, all different, none the model voice', () => {
    for (const p of people) expect(pack.islanders[p], p).toBeDefined();
    const ids = people.map((p) => ttsVoiceId(pack.islanders[p]!));
    expect(new Set(ids).size).toBe(people.length);
    expect(ids).not.toContain(ttsVoiceId(pack.modelVoice));
    for (const id of ids) expect(id).toMatch(/^kokoro-[ab][fm]_[a-z]+$/);
  });

  it('the fixed lines speak in those voices, the edge accepts them and the GPU job makes them', () => {
    const cast = castVoices().map(ttsVoiceId);
    const local = new Set(localTtsLines().map((l) => `${ttsVoiceId(l.voice)}|${l.text}`));
    for (const ch of ADVENTURE_CHAPTERS) {
      for (const c of [...ch.critters, ch.guardian]) {
        const v = islanderVoice(c.id, c.voice);
        expect(v).toEqual(pack.islanders[c.id]);
        expect(cast).toContain(ttsVoiceId(v));
        expect(isLocalTtsEngine(v.engine)).toBe(true);
        expect(local.has(`${ttsVoiceId(v)}|${c.intro.en.replace(/\s+/g, ' ').trim()}`), c.id).toBe(true);
      }
      const vv = islanderVoice(ch.villager.nameEn, 'guide');
      expect(local.has(`${ttsVoiceId(vv)}|${ch.villager.lines[0]!.en.replace(/\s+/g, ' ').trim()}`), ch.villager.nameEn).toBe(true);
    }
    // no islander line is left on a Workers AI voice (the night cron would be its only maker)
    const model = ttsVoiceId(pack.modelVoice);
    for (const l of adventureFixedLines()) expect(isLocalTtsEngine(l.voice.engine), `${ttsVoiceId(l.voice)} ${l.text}`).toBe(true);
    expect(model).toBe('kokoro-af_sarah');
  });
});
