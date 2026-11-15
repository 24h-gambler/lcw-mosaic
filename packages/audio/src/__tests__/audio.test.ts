import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AUDIO_LIMITS,
  BUS_CAPS,
  BUS_DEFAULT_VOLUMES,
  BUS_PRIORITY,
  DUCK_RELEASE_MS,
  DUCK_TABLE_DB,
  PROCEDURAL_SFX_PRESETS,
  dbToGain,
  duckDbFor,
  applyHearingProtectionLimiter,
  createAudioEngine,
  encodeWavBytes,
  MIC_CAPTURE_IDLE,
  micInputModeFor,
  reduceDialogMic,
  vadHangoverMs,
  getLadderSemitoneOffset,
  synthesizeProceduralPcm
} from '../index.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('packages/audio (WP-110, docs/12 §12)', () => {
  // docs/12 12장 자동 시험 1: 덕킹 상태 기계.
  it('ducking: overlapping reasons apply only the deepest cut per bus, and every bus returns when all end', () => {
    const engine = createAudioEngine(1000);
    const base = Object.fromEntries((['bgm', 'amb', 'sfx', 'ui', 'voice_npc', 'voice_lesson'] as const).map((b) => [b, engine.getEffectiveBusGain(b)]));
    expect(base.bgm).toBeCloseTo(BUS_DEFAULT_VOLUMES.bgm, 4);
    engine.duck('lesson_active', true); // -9 / -6 / -3
    engine.duck('npc_speaking', true); // -12 / -9 / -6
    engine.duck('mic_open', true); // -24 / -18 / -12
    expect(engine.getEffectiveBusGain('bgm')).toBeCloseTo(base.bgm! * dbToGain(-24), 5);
    expect(engine.getEffectiveBusGain('amb')).toBeCloseTo(base.amb! * dbToGain(-18), 5);
    expect(engine.getEffectiveBusGain('sfx')).toBeCloseTo(base.sfx! * dbToGain(-12), 5);
    // never the sum (-24 -12 -9 = -45 dB would be near silence)
    expect(engine.getEffectiveBusGain('bgm')).toBeGreaterThan(base.bgm! * dbToGain(-25));
    expect(engine.getEffectiveBusGain('voice_lesson')).toBeCloseTo(base.voice_lesson!, 5);
    engine.duck('mic_open', false);
    expect(engine.getEffectiveBusGain('bgm')).toBeCloseTo(base.bgm! * dbToGain(-12), 5);
    engine.duck('npc_speaking', false);
    engine.duck('lesson_active', false);
    for (const [bus, g] of Object.entries(base)) expect(engine.getEffectiveBusGain(bus as keyof typeof BUS_CAPS)).toBeCloseTo(g, 6);
    expect(duckDbFor('bgm', [])).toBe(0);
    // the guardian lesson window: no game sound, the call bus only
    engine.lesson.setListenOnly(true);
    for (const bus of ['bgm', 'amb', 'sfx', 'ui', 'voice_npc'] as const) expect(engine.getEffectiveBusGain(bus)).toBe(0);
    expect(engine.getEffectiveBusGain('voice_lesson')).toBeGreaterThan(0);
    // docs/12 3장 table values and release times
    expect(DUCK_TABLE_DB.skill_or_bubble).toEqual({ bgm: -18, amb: -12, sfx: -6 });
    expect(DUCK_TABLE_DB.lesson_vad).toEqual({ bgm: -24, amb: -18, sfx: -9 });
    expect(DUCK_RELEASE_MS).toMatchObject({ mic_open: 400, npc_speaking: 300, lesson_vad: 600, skill_or_bubble: 300 });
  });

  // docs/12 12장 자동 시험 2: 동시 재생 상한.
  it('caps: 100 requests at once never exceed any bus cap; lower priority and older sounds go first', () => {
    const engine = createAudioEngine(1000);
    engine.unlock();
    engine.unlock();
    expect(engine.getSnapshot().unlocked).toBe(true);
    expect(BUS_CAPS).toEqual({ ui: 4, sfx: 16, amb: 4, bgm: 3, voice_npc: 2, voice_lesson: 8 });
    for (const bus of Object.keys(BUS_CAPS) as Array<keyof typeof BUS_CAPS>) {
      for (let i = 0; i < 100; i++) engine.play(`${bus}.tone.${i}`, { bus, nowMs: 1000, durationMs: 5000 });
      expect(engine.getSnapshot().activeVoices.filter((v) => v.bus === bus).length).toBe(BUS_CAPS[bus]);
    }
    // a higher-priority sound replaces the oldest low one; an equal one cannot push out the oldest of a full bus
    const e2 = createAudioEngine(0);
    for (let i = 0; i < 16; i++) e2.play(`blk.place.${i}`, { bus: 'sfx', nowMs: i, durationMs: 5000, priority: 1 });
    const r = e2.play('exp.boom.m', { bus: 'sfx', nowMs: 20, durationMs: 600, priority: 9 });
    expect(r.played).toBe(true);
    const ids = e2.getSnapshot().activeVoices.filter((v) => v.bus === 'sfx').map((v) => v.soundId);
    expect(ids).not.toContain('blk.place.0');
    expect(ids).toContain('blk.place.1');
    expect(BUS_PRIORITY.voice_lesson).toBeGreaterThan(BUS_PRIORITY.voice_npc);
    expect(BUS_PRIORITY.voice_npc).toBeGreaterThan(BUS_PRIORITY.ui);
    expect(BUS_PRIORITY.ui).toBeGreaterThan(BUS_PRIORITY.sfx);
    expect(BUS_PRIORITY.sfx).toBeGreaterThan(BUS_PRIORITY.amb);
  });

  // docs/12 12장 자동 시험 3: 폭발 묶기.
  it('explosions: 20 within 100 ms play once (+3 dB at most); at most 3 explosion sounds at a time', () => {
    const engine = createAudioEngine(1000);
    const results = Array.from({ length: 20 }, (_, i) => engine.play('exp.boom.m', { nowMs: 1000 + i * 5, durationMs: 600 }));
    expect(results.filter((r) => r.played)).toHaveLength(1);
    expect(results.slice(1).every((r) => r.reason === 'explosion_coalesced' && r.mergedInto === results[0]!.handleId)).toBe(true);
    const voice = engine.getSnapshot().activeVoices.find((v) => v.handleId === results[0]!.handleId)!;
    expect(voice.boostDb).toBe(AUDIO_LIMITS.EXPLOSION_MERGE_MAX_BOOST_DB);
    // separate blasts 150 ms apart: three play, the fourth waits for one to end
    const e2 = createAudioEngine(0);
    const apart = [0, 150, 300, 450].map((t) => e2.play('exp.boom.m', { nowMs: t, durationMs: 600 }).played);
    expect(apart).toEqual([true, true, true, false]);
    expect(e2.play('exp.boom.m', { nowMs: 700, durationMs: 600 }).played).toBe(true);
  });

  // docs/12 12장 자동 시험 4: 마이크 순서.
  it('mic order: no recording before the NPC voice ends; then 150 ms, the cue, and recording after the cue', () => {
    const engine = createAudioEngine(2000);
    expect(engine.voice.say('What drink would you like?', { nowMs: 2000, durationMs: 1500 }).played).toBe(true);
    expect(engine.voice.npcSpeaking(2100)).toBe(true);
    for (const t of [2000, 2500, 3000, 3499]) expect(engine.voice.completeMicOpenDelay(t)).toBe(false);
    expect(engine.getSnapshot().micOpen).toBe(false);
    // the voice ends on its own at 3500 -> cue at 3650 -> recording at 3710
    expect(engine.voice.npcSpeaking(3500)).toBe(false);
    const s = engine.voice.requestMic(3550);
    expect(s).toEqual({ npcEndedAtMs: 3500, micOnCueAtMs: 3650, recordingStartedAtMs: 3650 + PROCEDURAL_SFX_PRESETS['dlg.mic_on']!.durationMs });
    expect(engine.voice.completeMicOpenDelay(3660)).toBe(false); // the cue is playing
    expect(engine.voice.completeMicOpenDelay(3710)).toBe(true);
    expect(engine.getSnapshot().micOpen).toBe(true);
    expect(engine.getSnapshot().activeDuckReasons).toContain('mic_open');
    // while the mic is open NPC voice and UI sounds do not play
    expect(engine.voice.say('Interrupting NPC', { nowMs: 3800 }).reason).toBe('blocked_while_mic_open');
    expect(engine.play('ui.click', { nowMs: 3800 }).played).toBe(false);
    const log = engine.getSnapshot().eventLog;
    const at = (ev: string) => log.find((e) => e.event === ev)!.atMs;
    expect(at('mic_cue')).toBeGreaterThanOrEqual(at('npc_end') + AUDIO_LIMITS.NPC_END_TO_MIC_ON_MS);
    expect(at('mic_record_start')).toBeGreaterThanOrEqual(at('mic_cue') + PROCEDURAL_SFX_PRESETS['dlg.mic_on']!.durationMs);
    engine.voice.stopMic(4000);
    expect(engine.getSnapshot().activeDuckReasons).not.toContain('mic_open');

    // a tap while the NPC talks cuts the voice first, then waits the same 150 ms + cue
    const e2 = createAudioEngine(0);
    e2.voice.say('Hello there, what would you like today?', { nowMs: 0, durationMs: 3000 });
    const cut = e2.voice.requestMic(800);
    expect(cut.npcEndedAtMs).toBe(800);
    expect(e2.voice.npcSpeaking(801)).toBe(false);
    expect(e2.voice.completeMicOpenDelay(800 + 150 + 59)).toBe(false);
    expect(e2.voice.completeMicOpenDelay(cut.recordingStartedAtMs)).toBe(true);
  });

  // docs/12 12장 자동 시험 5: 라이선스 검사 — an audio file not in assets/audio/LICENSES.md fails the test run.
  it('license gate: every audio file shipped in the repo is listed in assets/audio/LICENSES.md', () => {
    const ledger = fs.readFileSync(path.join(ROOT_DIR, 'assets', 'audio', 'LICENSES.md'), 'utf8');
    const AUDIO = /\.(ogg|opus|mp3|wav|webm|m4a|aac|flac)$/i;
    const SKIP = new Set(['node_modules', '.git', 'dist', '.wrangler', '.turbo']);
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (AUDIO.test(e.name)) found.push(path.relative(ROOT_DIR, full).split(path.sep).join('/'));
      }
    };
    for (const top of ['assets', 'apps', 'packages']) if (fs.existsSync(path.join(ROOT_DIR, top))) walk(path.join(ROOT_DIR, top));
    const missing = found.filter((f) => !ledger.includes(path.basename(f)));
    expect(missing).toEqual([]);
  });

  it('a hidden tab stops music and ambience and keeps the call bus', () => {
    const engine = createAudioEngine(0);
    engine.setHidden(true);
    expect(engine.getEffectiveBusGain('bgm')).toBe(0);
    expect(engine.getEffectiveBusGain('amb')).toBe(0);
    expect(engine.getEffectiveBusGain('voice_lesson')).toBeGreaterThan(0);
    engine.setHidden(false);
    expect(engine.getEffectiveBusGain('bgm')).toBeGreaterThan(0);
  });

  it('Test 4: synthesizes procedural WAV & climbs semitone ladder without external files', () => {
    const engine = createAudioEngine(500);
    const r0 = engine.play('build.note', { step: 0, nowMs: 500 });
    const r1 = engine.play('build.note', { step: 2, nowMs: 600 });
    expect(r0.semitoneOffset).toBe(0);
    expect(r1.semitoneOffset).toBe(getLadderSemitoneOffset(2));
    expect(r1.semitoneOffset).toBeGreaterThan(r0.semitoneOffset);

    const pcm = synthesizeProceduralPcm('star.chime', 16_000, 3);
    expect(pcm.length).toBeGreaterThan(100);
    for (const s of pcm) {
      expect(Math.abs(s)).toBeLessThanOrEqual(AUDIO_LIMITS.MASTER_PEAK_LINEAR + 1e-6);
    }
    expect(applyHearingProtectionLimiter(1.5)).toBeCloseTo(AUDIO_LIMITS.MASTER_PEAK_LINEAR, 4);

    const wav = encodeWavBytes(pcm, 16_000);
    expect(String.fromCharCode(wav[0]!, wav[1]!, wav[2]!, wav[3]!)).toBe('RIFF');
  });

  it('Test 5: Lesson Window listen-only blocks guardian transmit & LICENSES.md documents audio assets', () => {
    const engine = createAudioEngine(1000);
    engine.lesson.setListenOnly(true);
    expect(engine.lesson.canGuardianTransmitVoice()).toBe(false);
    expect(engine.getSnapshot().activeDuckReasons).toContain('lesson_window');

    const licensePath = path.join(ROOT_DIR, 'assets', 'audio', 'LICENSES.md');
    expect(fs.existsSync(licensePath)).toBe(true);
    const content = fs.readFileSync(licensePath, 'utf8');
    expect(content).toContain('CC0-1.0');
  });

  it('feedback: VAD hold is 1500ms for conversation, 500ms for combat skills', () => {
    expect(vadHangoverMs('conversation')).toBe(1500);
    expect(vadHangoverMs('skill')).toBe(500);
    const engine = createAudioEngine(0);
    // 1.0s mid-clause pause after speech: conversation keeps listening, skill ends
    expect(engine.lesson.evaluateVadFrame(0, 600, 1000)).toBe('speech');
    expect(engine.lesson.evaluateVadFrame(0, 600, 1000, 'conversation')).toBe('speech');
    expect(engine.lesson.evaluateVadFrame(0, 600, 1000, 'skill')).toBe('silence');
    expect(engine.lesson.evaluateVadFrame(0, 600, 1500, 'conversation')).toBe('silence');
    expect(engine.lesson.evaluateVadFrame(0, 600, 400, 'skill')).toBe('speech');
  });

  it('feedback: dialog mic is tap-toggle with 2.5s silence auto-stop; V skill stays hold', () => {
    expect(micInputModeFor('dialog')).toBe('tap_toggle');
    expect(micInputModeFor('combat_skill')).toBe('hold');
    let s = reduceDialogMic(MIC_CAPTURE_IDLE, { type: 'tap' });
    expect(s.recording).toBe(true);
    s = reduceDialogMic(s, { type: 'frame', speaking: true, frameMs: 20 });
    for (let i = 0; i < 100; i++) s = reduceDialogMic(s, { type: 'frame', speaking: false, frameMs: 20 });
    expect(s.recording).toBe(true); // 2000ms silence
    for (let i = 0; i < 25; i++) s = reduceDialogMic(s, { type: 'frame', speaking: false, frameMs: 20 });
    expect(s.recording).toBe(false); // >= 2500ms
    // second tap finishes manually
    s = reduceDialogMic(reduceDialogMic(MIC_CAPTURE_IDLE, { type: 'tap' }), { type: 'tap' });
    expect(s.recording).toBe(false);
  });
});
