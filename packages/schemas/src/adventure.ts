import { z } from 'zod';

/**
 * The student document (english-day) contract v1 for /adventure/ (docs/22 3장; automation repo
 * docs/handbook/06-pipelines/english-day-results.md). Both sides check the same shape: what the document publishes for
 * the day (`EnglishDayFile`) and the result envelope the adventure sends back (`AdventureEnvelope`).
 */

const short = z.string().max(300);

/** `https://english-day.pages.dev/<student>/today.json` or `days/<date>.json` (unknown fields are ignored). */
export const EnglishDayFileSchema = z
  .object({
    v: z.literal(1),
    student: z.string().min(1).max(40),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    day: z.number().int().min(0).max(1000).optional(),
    level: z.number().int().min(1).max(6).optional(),
    topic: z.string().max(40).optional(),
    words: z.array(z.string().max(40)).max(20).default([]),
    wordInfo: z
      .array(z.object({ w: z.string().max(40), ko: z.string().max(80).nullish(), audio: z.string().max(300).nullish(), img: z.string().max(300).nullish() }).passthrough())
      .max(20)
      .default([]),
    sentence: z.string().max(200).nullish(),
    review_words: z.array(z.string().max(40)).max(30).default([]),
    typing: z.array(z.string().max(200)).max(20).default([])
  })
  .passthrough();
export type EnglishDayFile = z.infer<typeof EnglishDayFileSchema>;

export const AdventureLineModeSchema = z.enum(['voice', 'typed', 'pick', 'spell']);
export type AdventureLineMode = z.infer<typeof AdventureLineModeSchema>;

export const AdventureOutcomeSchema = z.enum(['spared', 'fought', 'quit']);
export type AdventureOutcome = z.infer<typeof AdventureOutcomeSchema>;

export const AdventureActivitySchema = z
  .object({
    id: z.string().regex(/^ch[1-4]$/),
    kind: z.literal('chapter'),
    label: short,
    startedAt: short,
    endedAt: short,
    seconds: z.number().int().min(0),
    stars: z.number().int().min(0).max(3),
    starsMax: z.literal(3),
    correct: z.number().int().min(0),
    total: z.number().int().min(0),
    words: z
      .array(z.object({ w: short, ok: z.boolean(), caught: z.number().int().min(0), missed: z.number().int().min(0) }).strict())
      .max(60),
    lines: z
      .array(z.object({ en: short, ko: short, mode: AdventureLineModeSchema, ok: z.boolean(), tries: z.number().int().min(1) }).strict())
      .max(60),
    extra: z
      .object({
        outcome: AdventureOutcomeSchema,
        hp_lost: z.number().int().min(0),
        level: z.string().regex(/^L[1-6]$/),
        /** The lesson day it was played for, when the envelope went under today's date (an old link, contract v1). */
        lessonDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
      })
      .strict()
  })
  .strict();
export type AdventureActivity = z.infer<typeof AdventureActivitySchema>;

export const AdventureEnvelopeSchema = z
  .object({
    v: z.literal(1),
    source: z.literal('lcw-adventure'),
    student: z.string().min(1).max(40),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    activities: z.array(AdventureActivitySchema).min(1).max(50),
    summaryKo: short
  })
  .strict();
export type AdventureEnvelope = z.infer<typeof AdventureEnvelopeSchema>;

/** The receiver's body limit (contract v1). */
export const ADVENTURE_ENVELOPE_MAX_BYTES = 64 * 1024;
