/**
 * NPC cast per target language (docs/04 4.8, Dan 2026-11-16 "원어민 이름과 말투"): the names a native child of that
 * language would know, the Korean label shown next to them, and the voice each one speaks with. The world's name
 * plates, the dialog header and the neural voice (edge tts.ts) all read this one table; a new target language brings
 * its own pack (its native names and voices), never the English ones.
 *
 * The cast is keyed by the world NPC id (apps/client/src/world/town.ts) — ids never change with the language.
 */

export type CastLang = 'en';

/** Workers AI neural voice (edge tts.ts): Deepgram Aura speakers, or MeloTTS as the cheap fallback engine. */
export interface NpcVoice {
  engine: 'aura' | 'melo';
  /** Aura speaker id (asteria, luna, stella, athena, hera, orion, arcas, perseus, angus, orpheus, helios, zeus). */
  speaker: string;
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
}

const EN: NpcCastPack = {
  lang: 'en',
  npcs: {
    guide: { nameEn: 'Luna', nameKo: '안내인 루나 선생님', nameKoShort: '루나', age: 'adult', voice: { engine: 'aura', speaker: 'asteria' } },
    cafe_owner: { nameEn: 'Hannah', nameKo: '카페 주인 해나', nameKoShort: '해나', age: 'adult', voice: { engine: 'aura', speaker: 'stella' } },
    shop_owner: { nameEn: 'Toby', nameKo: '상점 주인 토비', nameKoShort: '토비', age: 'adult', voice: { engine: 'aura', speaker: 'arcas' } },
    errand_neighbor: { nameEn: 'Mia', nameKo: '이웃 미아', nameKoShort: '미아', age: 'child', voice: { engine: 'aura', speaker: 'luna' } }
  }
};

export const NPC_CAST_PACKS: Readonly<Record<CastLang, NpcCastPack>> = { en: EN };

/** The pack for a target language (falls back to English, the only world language today). */
export function npcCast(lang: string = 'en'): NpcCastPack {
  return (NPC_CAST_PACKS as Record<string, NpcCastPack>)[lang] ?? EN;
}

/** One NPC's persona, or null when the pack has no entry (the world keeps its own label then). */
export function npcPersona(npcId: string, lang: string = 'en'): NpcPersona | null {
  return npcCast(lang).npcs[npcId] ?? null;
}
