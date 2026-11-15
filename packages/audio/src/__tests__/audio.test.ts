import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AUDIO_LIMITS,
  BUS_CAPS,
  applyHearingProtectionLimiter,
  createAudioEngine,
  encodeWavBytes,
  getLadderSemitoneOffset,
  synthesizeProceduralPcm
} from '../index.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('packages/audio (WP-110, docs/12 §12)', () => {
  it('Test 1: unlock is idempotent and enforces 12 SFX cap + 100ms explosion coalescing', () => {
    const engine = createAudioEngine(1000);
    engine.unlock();
    engine.unlock();
    expect(engine.getSnapshot().unlocked).toBe(true);

    // Attempt 50 SFX calls simultaneously on sfx bus (cap = 12)
    for (let i = 0; i < 50; i++) {
      engine.play('blk.place', { bus: 'sfx', nowMs: 1000, durationMs: 500, priority: 5 });
    }
    const sfxVoices = engine.getSnapshot().activeVoices.filter((v) => v.bus === 'sfx');
    expect(sfxVoices.length).toBeLessThanOrEqual(BUS_CAPS.sfx);

    // 8 explosions within 100ms coalesce down to <= 3 (AUDIO_LIMITS.EXPLOSION_MAX_SIMULTANEOUS)
    let exploded = 0;
    for (let i = 0; i < 8; i++) {
      const r = engine.play('fx.explode', { bus: 'sfx', nowMs: 1010 + i * 5, priority: 10 });
      if (r.played) exploded += 1;
    }
    expect(exploded).toBe(AUDIO_LIMITS.EXPLOSION_MAX_SIMULTANEOUS);
  });

  it('Test 2: enforces strict NPC end -> 150ms -> dlg.mic_on -> mic record sequence and blocks NPC while mic open', () => {
    const engine = createAudioEngine(2000);
    engine.voice.say('What drink would you like?', { nowMs: 2000, durationMs: 500 });
    const schedule = engine.voice.notifyNpcEnded(2500);
    expect(schedule.micOnCueAtMs).toBe(2650);

    // Before 150ms elapsed, mic cannot open
    expect(engine.voice.completeMicOpenDelay(2600)).toBe(false);
    expect(engine.getSnapshot().micOpen).toBe(false);

    // At >= 2650ms, dlg.mic_on fires BEFORE mic recording opens, then NPC speech is blocked
    expect(engine.voice.completeMicOpenDelay(2650)).toBe(true);
    expect(engine.getSnapshot().micOpen).toBe(true);

    const blockedNpc = engine.voice.say('Interrupting NPC', { nowMs: 2700 });
    expect(blockedNpc.played).toBe(false);
    expect(blockedNpc.reason).toBe('blocked_while_mic_open');

    const log = engine.getSnapshot().eventLog;
    const npcEndIdx = log.findIndex((e) => e.event === 'npc_end');
    const cueIdx = log.findIndex((e) => e.event === 'play' && e.id === 'dlg.mic_on');
    const recIdx = log.findIndex((e) => e.event === 'mic_record_start');
    expect(npcEndIdx).toBeGreaterThan(-1);
    expect(cueIdx).toBeGreaterThan(npcEndIdx);
    expect(recIdx).toBeGreaterThan(cueIdx);
  });

  it('Test 3: mic_open and npc_speaking apply ducking attenuation and restore when ended', () => {
    const engine = createAudioEngine(1000);
    const baseBgm = engine.getEffectiveBusGain('bgm');
    engine.duck('npc_speaking', true);
    const duckedNpc = engine.getEffectiveBusGain('bgm');
    expect(duckedNpc).toBeLessThan(baseBgm);

    engine.duck('mic_open', true);
    const duckedMic = engine.getEffectiveBusGain('bgm');
    expect(duckedMic).toBeLessThan(duckedNpc);

    engine.duck('mic_open', false);
    engine.duck('npc_speaking', false);
    expect(engine.getEffectiveBusGain('bgm')).toBeCloseTo(baseBgm, 4);
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
});
