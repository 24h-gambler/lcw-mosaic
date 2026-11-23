/**
 * NPC cast per target language (docs/04 4.8, Dan 2026-11-16 "원어민 이름과 말투"): the names a native child of that
 * language would know, the Korean label shown next to them, and the voice each one speaks with. The world's name
 * plates, the dialog header and the neural voice (edge tts.ts) all read this one table; a new target language brings
 * its own pack (its native names and voices), never the English ones.
 *
 * The cast is keyed by the world NPC id (apps/client/src/world/town.ts) — ids never change with the language.
 */

export type CastLang = 'en';

/** Workers AI neural engines (edge tts.ts makes their lines through the quota meter). */
export type WorkersAiTtsEngine = 'aura' | 'aura2' | 'melo';

/**
 * Open-weights engines run on the operator's own GPU (tools/tts-local, R2625): their lines are made ahead and uploaded
 * by the operator (edge `PUT /v1/admin/tts/line`), never made at the edge, and cost no neurons.
 */
export type LocalTtsEngine = 'kokoro';
export const LOCAL_TTS_ENGINES: readonly LocalTtsEngine[] = ['kokoro'];

export function isLocalTtsEngine(engine: string): engine is LocalTtsEngine {
  return (LOCAL_TTS_ENGINES as readonly string[]).includes(engine);
}

/** A neural voice (edge tts.ts): a Workers AI speaker (Aura, MeloTTS) or a local open-weights speaker (Kokoro). */
export interface NpcVoice {
  engine: WorkersAiTtsEngine | LocalTtsEngine;
  /** Speaker id: Aura (athena, hera, luna...) or Kokoro (af_sarah...). */
  speaker: string;
  /**
   * Local engines only: the Workers AI voice that reads a line the local engine has not made yet (a sentence added
   * during the day, before the nightly upload). The edge stores and labels that audio under the stand-in's own key, so
   * a file is always named by the engine that spoke it; the uploaded local line wins from then on.
   */
  standIn?: NpcVoice;
}

export interface NpcPersona {
  /** Name in the target language (dialog header, English lines). */
  nameEn: string;
  /** Korean label as shown on the name plate and dialog header: role + name ("카페 주인 해나"). */
  nameKo: string;
  /** The name alone in Hangul ("해나"), for Korean UI sentences ("해나에게 주문해요"). */
  nameKoShort: string;
  age: 'child' | 'adult';
  voice: NpcVoice;
}

export interface NpcCastPack {
  lang: CastLang;
  npcs: Readonly<Record<string, NpcPersona>>;
  /** The voice that reads the child's own sentences (the 🔊 on each offer): a clear, warm model, not an NPC. */
  modelVoice: NpcVoice;
  /** Dialog ctx -> the world NPC who speaks it (ctxs without a world NPC yet speak in the guide's voice). */
  ctxNpc: Readonly<Record<string, string>>;
  /**
   * The /adventure/ islanders' own voices, one per character (creature id, or a villager's English name), the one
   * table the game, the edge and the nightly GPU job read (adventure.ts islanderVoice). Kokoro voices: made on the
   * operator's GPU and uploaded (0 neurons, like the model voice); the prebuild and cron skip them.
   */
  islanders: Readonly<Record<string, NpcVoice>>;
}

/*
 * Aura-2 since 11-16 afternoon (Dan: "아직도 목소리가 기계음"): same line on aura-1 and aura-2, pitch movement
 * (semitone SD of voiced frames) aura-1 cast 2.9-4.4 vs aura-2 picks athena 5.5, hera 3.6, apollo 4.3, delia 6.2,
 * luna 5.0 - livelier, less flat. Toby is apollo (male, ~155 Hz), Mia delia (cheerful, breathy, the youngest-sounding).
 * Earlier aura-1 pick (11-16 morning, Workers AI aura-1, 4 lines each, Whisper round trip, EBU R128, median F0):
 * guide athena (calm adult, F0 ~185 Hz), cafe owner hera (warm adult, ~185 Hz), shop owner arcas (male, ~155 Hz),
 * Mia stella (the highest, youngest voice, ~275 Hz), the child's model sentences luna (clear, WER 0 on all four,
 * steady -20..-22 LUFS). Every one was understood word for word by Whisper (one contraction aside).
 */
const EN: NpcCastPack = {
  lang: 'en',
  npcs: {
    guide: { nameEn: 'Luna', nameKo: '안내인 루나 선생님', nameKoShort: '루나', age: 'adult', voice: { engine: 'aura2', speaker: 'athena' } },
    cafe_owner: { nameEn: 'Hannah', nameKo: '카페 주인 해나', nameKoShort: '해나', age: 'adult', voice: { engine: 'aura2', speaker: 'hera' } },
    shop_owner: { nameEn: 'Toby', nameKo: '상점 주인 토비', nameKoShort: '토비', age: 'adult', voice: { engine: 'aura2', speaker: 'apollo' } },
    errand_neighbor: { nameEn: 'Mia', nameKo: '이웃 미아', nameKoShort: '미아', age: 'child', voice: { engine: 'aura2', speaker: 'delia' } }
  },
  modelVoice: { engine: 'kokoro', speaker: 'af_sarah', standIn: { engine: 'aura2', speaker: 'luna' } },
  ctxNpc: { cafe: 'cafe_owner', trade_shop: 'shop_owner', guide: 'guide', errand: 'errand_neighbor' },
  // R2625 (11-19, coordinator): every islander a voice of its own, none shared with another islander or the model
  // voice (af_sarah). Kokoro-82M American (a*) and British (b*) speakers.
  islanders: {
    // island 1 (forest)
    rootle: { engine: 'kokoro', speaker: 'am_puck' },
    conekin: { engine: 'kokoro', speaker: 'af_nova' },
    fernip: { engine: 'kokoro', speaker: 'af_jessica' },
    bramblebun: { engine: 'kokoro', speaker: 'af_bella' },
    'Old Fern': { engine: 'kokoro', speaker: 'bf_isabella' },
    // island 2 (beach)
    bubblit: { engine: 'kokoro', speaker: 'af_sky' },
    shellbop: { engine: 'kokoro', speaker: 'am_echo' },
    driftcap: { engine: 'kokoro', speaker: 'am_liam' },
    clatterclaw: { engine: 'kokoro', speaker: 'bm_george' },
    Dune: { engine: 'kokoro', speaker: 'am_fenrir' },
    // island 3 (bakery)
    doughdot: { engine: 'kokoro', speaker: 'af_alloy' },
    sugarfly: { engine: 'kokoro', speaker: 'bf_emma' },
    crumbun: { engine: 'kokoro', speaker: 'bf_lily' },
    ovenna: { engine: 'kokoro', speaker: 'af_heart' },
    'Pip Toast': { engine: 'kokoro', speaker: 'af_nicole' },
    // island 4 (library tower)
    blotling: { engine: 'kokoro', speaker: 'am_michael' },
    paperkite: { engine: 'kokoro', speaker: 'af_kore' },
    glimmerbat: { engine: 'kokoro', speaker: 'bm_daniel' },
    hushwind: { engine: 'kokoro', speaker: 'bm_fable' },
    'Nim the Lamplighter': { engine: 'kokoro', speaker: 'bm_lewis' }
  }
};

export const NPC_CAST_PACKS: Readonly<Record<CastLang, NpcCastPack>> = { en: EN };

/** The pack for a target language (falls back to English, the only world language today). */
export function npcCast(lang: string = 'en'): NpcCastPack {
  return (NPC_CAST_PACKS as Record<string, NpcCastPack>)[lang] ?? EN;
}

/** The voice a dialog ctx speaks with (its world NPC's, else the guide's). */
export function voiceForCtx(ctx: string, lang: string = 'en'): NpcVoice {
  const pack = npcCast(lang);
  return (pack.npcs[pack.ctxNpc[ctx] ?? 'guide'] ?? pack.npcs.guide!).voice;
}

/** Every voice a pack may speak with, stand-ins included (the edge refuses others). */
export function castVoices(lang: string = 'en'): NpcVoice[] {
  const pack = npcCast(lang);
  const base = [...Object.values(pack.npcs).map((p) => p.voice), pack.modelVoice, ...Object.values(pack.islanders)];
  const all = base.flatMap((v) => (v.standIn ? [v, v.standIn] : [v]));
  return all.filter((v, i) => all.findIndex((w) => w.engine === v.engine && w.speaker === v.speaker) === i);
}

/** One NPC's persona, or null when the pack has no entry (the world keeps its own label then). */
export function npcPersona(npcId: string, lang: string = 'en'): NpcPersona | null {
  return npcCast(lang).npcs[npcId] ?? null;
}
