import { describe, expect, it } from 'vitest';
import { LlmConverseInputSchema } from '@lcw/schemas';
import { QuotaMeter } from '@lcw/quota';
import { createNodeSqliteExecutor } from '../node-sqlite.js';
import { createEdgeApp, buildSanitizedWorkersAiConverseInput } from '../app.js';
import { EdgePlatformDb, InMemoryR2Store, LessonDO, WorldDO } from '../storage.js';

function setupTestEnv(now = 1_700_000_000_000) {
  let clock = now;
  const db = new EdgePlatformDb(createNodeSqliteExecutor(':memory:'));
  db.ensureFamilyAndPlayer({
    familyId: 'fam-1',
    guardianId: 'guard-1',
    playerId: 'child-1',
    nickname: 'Minseo',
    nowMs: clock
  });

  const r2 = new InMemoryR2Store();
  const worldDo = new WorldDO({ sql: createNodeSqliteExecutor(':memory:'), r2, seed: 'edge-seed' });
  worldDo.appendLedger('child-1', 100, 'initial_errand', 'e0', clock);

  const lessonDo = new LessonDO('lesson-1', db, 'child-1', 'world-1', clock);

  const app = createEdgeApp({
    db,
    worlds: new Map([['world-1', worldDo]]),
    lessons: new Map([['lesson-1', lessonDo]]),
    quota: new QuotaMeter('2026-11-15'),
    nowMs: () => clock
  });

  return {
    db,
    r2,
    worldDo,
    lessonDo,
    app,
    advanceClock(ms: number) {
      clock += ms;
    }
  };
}

describe('apps/edge (WP-003, WP-205, WP-301, WP-304, WP-501)', () => {
  it('rolls back atomic WorldDO chunk save cleanly on simulated mid-tx failure (WP-205)', () => {
    const { worldDo } = setupTestEnv();
    // Place valid block in player's plot first
    const ok1 = worldDo.applyBlockEditsAtomic({
      actorId: 'child-1',
      isOwner: true,
      edits: [{ x: 108, y: 2, z: 164, block_id: 2 }],
      nowMs: 1000
    });
    expect(ok1.ok).toBe(true);
    expect(worldDo.world.getBlock(108, 2, 164)).toBe(2);

    // Mid-transaction failure must roll back BOTH SQLite chunks/journal AND in-memory voxels
    const failTx = worldDo.applyBlockEditsAtomic({
      actorId: 'child-1',
      isOwner: true,
      edits: [{ x: 109, y: 2, z: 164, block_id: 5 }],
      nowMs: 2000,
      simulateCrashMidTx: true
    });
    expect(failTx.ok).toBe(false);
    expect(worldDo.world.getBlock(109, 2, 164)).toBe(0);

    // Core zone mutation stays rejected
    const coreDeny = worldDo.applyBlockEditsAtomic({
      actorId: 'child-1',
      isOwner: true,
      edits: [{ x: 144, y: 2, z: 144, block_id: 2 }],
      nowMs: 3000
    });
    expect(coreDeny.ok).toBe(false);
    expect(coreDeny.reason).toBe('보호 구역이에요');
  });

  it('enters Safe Mode after 2 consecutive load failures and rewinds cleanly to R2 snapshot', async () => {
    const { worldDo } = setupTestEnv();
    worldDo.applyBlockEditsAtomic({
      actorId: 'child-1',
      isOwner: true,
      edits: [{ x: 110, y: 2, z: 165, block_id: 4 }],
      nowMs: 1000
    });
    await worldDo.saveSnapshot('snap-1', 'before_change', 1100);

    // Modify further after snapshot
    worldDo.applyBlockEditsAtomic({
      actorId: 'child-1',
      isOwner: true,
      edits: [{ x: 110, y: 2, z: 165, block_id: 7 }],
      nowMs: 1500
    });
    expect(worldDo.world.getBlock(110, 2, 165)).toBe(7);

    // 2 load failures trigger Safe Mode
    const load1 = await worldDo.loadWorldWithRecovery({ injectCorruption: true });
    expect(load1.safeMode).toBe(false);
    const load2 = await worldDo.loadWorldWithRecovery({ injectCorruption: true });
    expect(load2.safeMode).toBe(true);

    // Rewind restores block back to snapshot state (block 4) and clears Safe Mode
    const rewound = await worldDo.rewindToSnapshot('snap-1');
    expect(rewound).toBe(true);
    expect(worldDo.safeMode).toBe(false);
    expect(worldDo.world.getBlock(110, 2, 165)).toBe(4);
  });

  it('strictly blocks minor audio storage without voice_store consent and deletes audio refs on revoke', async () => {
    const { db, app } = setupTestEnv();

    // Score utterance with audio_key BEFORE consent is granted -> stored audio columns must be null!
    const res1 = await app.request('/v1/converse/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dialog_id: 'd-1',
        chosen_stars: 3,
        hint_level: 'none',
        transcript: 'Can I have hot green tea, please?',
        audio_key: 'r2://voice/raw-1.opus',
        player_id: 'child-1',
        world_id: 'world-1',
        session_id: 's-1',
        npc_ctx: 'cafe',
        level: 'L2',
        target_text: 'Can I have hot green tea please',
        price: 20,
        item_id: 'green_tea'
      })
    });
    expect(res1.status).toBe(200);
    const rowsBeforeConsent = db.listUtterancesForPlayer('child-1');
    expect(rowsBeforeConsent).toHaveLength(1);
    expect(rowsBeforeConsent[0]!.audio_final).toBeNull();

    // Grant voice_store consent -> now audio_final may be stored
    await app.request('/v1/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        player_id: 'child-1',
        guardian_id: 'guard-1',
        scope: 'voice_store',
        granted: true
      })
    });

    await app.request('/v1/converse/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dialog_id: 'd-2',
        chosen_stars: 3,
        hint_level: 'none',
        transcript: 'Can I have warm honey tea please?',
        audio_key: 'r2://voice/raw-2.opus',
        player_id: 'child-1',
        world_id: 'world-1',
        session_id: 's-1',
        npc_ctx: 'cafe',
        level: 'L2',
        target_text: 'Can I have warm honey tea please',
        price: 20,
        item_id: 'honey_tea'
      })
    });
    // Even with consent a client-chosen key is never stored: audio is attached by the server after an upload
    // (voice.ts /v1/voice/upload, covered in voice.test.ts).
    const rowsAfterConsent = db.listUtterancesForPlayer('child-1');
    expect(rowsAfterConsent[1]!.audio_final).toBeNull();
    // Simulate an uploaded clip on that turn, then check the revoke scrubs it.
    db.sql.run('update utterances set audio_final = ? where id = ?', ['0123456789abcdef01234567', rowsAfterConsent[1]!.id]);

    // Revoke consent -> previously stored audio links are scrubbed immediately
    await app.request('/v1/consents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        player_id: 'child-1',
        guardian_id: 'guard-1',
        scope: 'voice_store',
        granted: false
      })
    });
    const rowsAfterRevoke = db.listUtterancesForPlayer('child-1');
    expect(rowsAfterRevoke.every((r) => r.audio_final === null && r.audio_first === null)).toBe(
      true
    );
  });

  it('rejects guardian audio uplink on Lesson Window and strips PII before Workers AI calls', async () => {
    const { app } = setupTestEnv();

    const audioUplink = await app.request('/v1/lessons/lesson-1/window/audio', {
      method: 'POST'
    });
    expect(audioUplink.status).toBe(403);
    const json = (await audioUplink.json()) as { reason: string };
    expect(json.reason).toBe('listen_only_window');

    const sanitized = buildSanitizedWorkersAiConverseInput({
      player_id: 'child-1',
      nickname: 'Minseo',
      oauth_sub: 'secret-oauth',
      audio_key: 'r2://raw.opus',
      npc_ctx: 'cafe',
      level: 'L2',
      normalized: 'honey tea please',
      slots: { item: 'honey tea', modifiers: ['hot'] }
    });
    expect(LlmConverseInputSchema.safeParse(sanitized).success).toBe(true);
    expect(JSON.stringify(sanitized)).not.toContain('Minseo');
    expect(JSON.stringify(sanitized)).not.toContain('child-1');
  });

  it('auto-suspends public server_list entry upon 3 distinct abuse reporters (docs/16)', async () => {
    const { db, app } = setupTestEnv();
    db.registerPublicWorld({
      worldId: 'world-pub',
      ownerId: 'child-1',
      title: 'English Tea Village',
      tags: ['cafe', 'english'],
      audience: 'public',
      nowMs: 1000
    });

    for (const reporter of ['rep-1', 'rep-2']) {
      const r = await app.request('/v1/worlds/world-pub/report-abuse', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reporter_id: reporter, reason: 'spam build' })
      });
      const body = (await r.json()) as { suspended: boolean };
      expect(body.suspended).toBe(false);
    }

    // 3rd distinct reporter triggers auto-suspend
    const r3 = await app.request('/v1/worlds/world-pub/report-abuse', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reporter_id: 'rep-3', reason: 'inappropriate sign' })
    });
    const body3 = (await r3.json()) as { distinctReporters: number; suspended: boolean };
    expect(body3.distinctReporters).toBe(3);
    expect(body3.suspended).toBe(true);
    expect(
      db.sql.get('select * from server_list where world_id = ?', ['world-pub'])
    ).toBeUndefined();
  });

  it('verifies weekly report numbers and opens shared report token', async () => {
    const { app } = setupTestEnv();
    await app.request('/v1/converse/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dialog_id: 'd-rep',
        chosen_stars: 3,
        hint_level: 'none',
        transcript: 'Can I have hot green tea please',
        player_id: 'child-1',
        world_id: 'world-1',
        session_id: 's-1',
        npc_ctx: 'cafe',
        level: 'L2',
        target_text: 'Can I have hot green tea please',
        price: 20
      })
    });

    const createRes = await app.request('/v1/reports/weekly', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'rep-1',
        player_id: 'child-1',
        week: '2026-W46',
        draft_body: '이번 주 999문장을 완주해 천재가 되었습니다.',
        share_token: 'tok-abc-123'
      })
    });
    const created = (await createRes.json()) as { replaced: boolean; body: string };
    expect(created.replaced).toBe(true);
    expect(created.body).toContain('1건');

    const viewRes = await app.request('/v1/reports/tok-abc-123');
    expect(viewRes.status).toBe(200);
    const viewed = (await viewRes.json()) as { share_token: string; opened_at: number | null };
    expect(viewed.share_token).toBe('tok-abc-123');
    expect(viewed.opened_at).not.toBeNull();
  });

  it('executes bilateral trade atomically, tracks solo expression reuse, sends parent report, triggers 48h reminder, and updates on open', async () => {
    const env = setupTestEnv(1_763_200_000_000);
    env.worldDo.grantOrSetItem('child-1', 'itm-iron-1', '{"kind":"ore"}');
    env.worldDo.grantOrSetItem('teacher-1', 'itm-tea-1', '{"kind":"drink"}');

    const scenariosRes = await env.app.request('/v1/trades/scenarios');
    expect(scenariosRes.status).toBe(200);
    const scenariosBody = (await scenariosRes.json()) as {
      scenarios: unknown[];
      lesson_stages: unknown[];
    };
    expect(scenariosBody.scenarios).toHaveLength(4);
    expect(scenariosBody.lesson_stages).toHaveLength(7);

    // Unilateral speech (teacher transcript empty) is rejected with 422
    const blockedRes = await env.app.request('/v1/worlds/world-1/trades', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        trade_id: 'tr-blocked',
        student_id: 'child-1',
        teacher_id: 'teacher-1',
        student_give_item_id: 'itm-iron-1',
        teacher_give_item_id: 'itm-tea-1',
        base_value_coins: 100,
        stars: 2,
        level: 'L2',
        target_text: 'Could we swap three iron ores for two warm honey teas',
        teacher_transcript: '',
        student_transcript: 'Could we swap three iron ores for two warm honey teas'
      })
    });
    expect(blockedRes.status).toBe(422);
    const blockedBody = (await blockedRes.json()) as { reason: string };
    expect(blockedBody.reason).toBe('bilateral_utterance_required');

    // Bilateral speech settles swap, 5% fee for 2 stars (= 5 coins), and logs pinned lesson expression
    const tradeRes = await env.app.request('/v1/worlds/world-1/trades', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        trade_id: 'tr-ok',
        student_id: 'child-1',
        teacher_id: 'teacher-1',
        student_give_item_id: 'itm-iron-1',
        teacher_give_item_id: 'itm-tea-1',
        base_value_coins: 100,
        stars: 2,
        level: 'L2',
        target_text: 'Could we swap three iron ores for two warm honey teas',
        teacher_transcript: 'What would you like to trade for this warm honey tea?',
        student_transcript: 'Could we swap three iron ores for two warm honey teas',
        lesson_id: 'lesson-1',
        pin_expression: 'warm honey tea'
      })
    });
    expect(tradeRes.status).toBe(200);
    const tradeBody = (await tradeRes.json()) as {
      ok: boolean;
      fee_coins: number;
      swapped_item_ids: string[];
    };
    expect(tradeBody.ok).toBe(true);
    expect(tradeBody.fee_coins).toBe(5);
    expect(tradeBody.swapped_item_ids).toEqual(['itm-iron-1', 'itm-tea-1']);
    expect(env.worldDo.getPlayerBalance('child-1')).toBe(95);
    expect(env.worldDo.listPlayerItems('child-1').map((i) => i.id)).toContain('itm-tea-1');
    expect(env.worldDo.listPlayerItems('teacher-1').map((i) => i.id)).toContain('itm-iron-1');

    // Solo play reuse increments reuse_solo on lesson-born expression
    env.advanceClock(60_000);
    const soloRes = await env.app.request('/v1/converse/score', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        dialog_id: 'd-solo-reuse',
        chosen_stars: 3,
        hint_level: 'none',
        transcript: 'Can I have warm honey tea please',
        player_id: 'child-1',
        world_id: 'world-1',
        session_id: 's-solo-1',
        session_kind: 'solo',
        npc_ctx: 'cafe',
        level: 'L2',
        target_text: 'Can I have warm honey tea please',
        price: 20
      })
    });
    expect(soloRes.status).toBe(200);
    const trackedExpr = env.db.listExpressionsForPlayer('child-1');
    expect(trackedExpr.some((e) => e.lemma_key === 'warm honey tea' && e.reuse_solo === 1)).toBe(
      true
    );

    // Complete lesson and deliver parent report (invalid fabrication is replaced automatically)
    env.lessonDo.recordMinute({
      minute: 1,
      studentMs: 30_000,
      teacherMs: 25_000,
      exchanges: 4,
      activity: 'barter_and_dungeon'
    });
    const sendRes = await env.app.request('/v1/lessons/lesson-1/complete-and-send-report', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        report_id: 'rep-lesson-1',
        player_id: 'child-1',
        guardian_id: 'guard-1',
        ref_id: 'lesson-1',
        draft_body: '오늘 999문장을 발화했습니다.',
        teacher_comment: '물물교환에서 스스로 조건절을 사용했습니다.',
        next_lesson_at: '2026-11-22 오전 10:00',
        share_token: 'tok-lesson-1-0123456789'
      })
    });
    expect(sendRes.status).toBe(200);
    const sendBody = (await sendRes.json()) as {
      ok: boolean;
      delivery_status: string;
      replaced: boolean;
      teacher_contribution: { solo_transfer_14d_rate: number };
    };
    expect(sendBody.ok).toBe(true);
    expect(sendBody.delivery_status).toBe('sent');
    expect(sendBody.replaced).toBe(true);
    expect(sendBody.teacher_contribution.solo_transfer_14d_rate).toBe(1);

    // Before 48h: no reminder triggered
    env.advanceClock(60_000);
    const remEarly = await env.app.request('/v1/reports/reminders/run', { method: 'POST' });
    expect(((await remEarly.json()) as { remindedCount: number }).remindedCount).toBe(0);

    // After 48h without open: 1 reminder triggered and delivery status flips to reminder_sent
    env.advanceClock(2 * 86_400_000);
    const remDue = await env.app.request('/v1/reports/reminders/run', { method: 'POST' });
    const remDueBody = (await remDue.json()) as { remindedCount: number; reportIds: string[] };
    expect(remDueBody.remindedCount).toBe(1);
    expect(remDueBody.reportIds).toContain('rep-lesson-1');
    expect(env.db.getReportDeliveryByToken('tok-lesson-1-0123456789')?.status).toBe('reminder_sent');

    // Guardian opens report -> opened_at recorded, delivery_status -> opened, nextTargetsUpdated -> true
    env.advanceClock(10_000);
    const openRes = await env.app.request('/v1/reports/tok-lesson-1-0123456789');
    expect(openRes.status).toBe(200);
    const openedBody = (await openRes.json()) as {
      opened_at: number | null;
      delivery_status: string;
      nextTargetsUpdated: boolean;
    };
    expect(openedBody.opened_at).not.toBeNull();
    expect(openedBody.delivery_status).toBe('opened');
    expect(openedBody.nextTargetsUpdated).toBe(true);
    expect(env.db.getReportDeliveryByToken('tok-lesson-1-0123456789')?.status).toBe('opened');
  });
});
