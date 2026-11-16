/**
 * Director console: '승인 대기' — student sign-ups waiting for the teacher (edge student-account.ts). The teacher links
 * each to an existing student row (same player_id, history continues) or approves it as a new student; the waiting
 * student device then opens as that student's world.
 * Safety (a stranger can type any nickname): each line shows how the adult signed in (provider, masked hint, who
 * consented); approving needs the 4 digits shown on the waiting student screen (never listed here); linking to an
 * existing row asks once more, with a warning when that row already has signed-in devices; a wrong approval can be
 * undone for 24 h. Also: a 6-digit code to connect another device of a consented student.
 * Polls while the console is open; nothing here touches the lesson start path.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Button, TOKENS } from '@lcw/ui';
import { createLessonApi, type AdminStudent, type LessonApi } from './lessonApi.js';
import { Box, Notice, inputStyle, labelStyle, sp } from './lessonUi.js';
import { StudentApiError, createStudentAccountApi, type PendingSignup, type StudentAccountApi } from './studentAccountApi.js';
import { SIGNUP_STRINGS_KO } from './signupStrings.js';

const Q = SIGNUP_STRINGS_KO.queue;
const T = TOKENS.typography;
export const SIGNUP_QUEUE_POLL_MS = 8000;

/** /v1/admin/students rows carry `linked_devices` (lesson-mode.ts) since the account domain. */
type StudentRow = AdminStudent & { linked_devices?: number };
type Recent = { id: string; player_id: string; nickname: string; decided_at: number; moved: boolean };

export interface SignupQueueProps {
  token: string;
  api?: StudentAccountApi;
  lessonApi?: LessonApi;
  pollMs?: number;
  now?: () => number;
  initialSignups?: PendingSignup[];
  initialStudents?: AdminStudent[];
  /** During a live lesson: render nothing until a sign-up is waiting. */
  hideWhenEmpty?: boolean;
}

export function SignupQueue(props: SignupQueueProps): React.ReactElement | null {
  const api = useRef<StudentAccountApi>(props.api ?? createStudentAccountApi()).current;
  const lessons = useRef<LessonApi>(props.lessonApi ?? createLessonApi()).current;
  const now = props.now ?? Date.now;
  const pollMs = props.pollMs ?? SIGNUP_QUEUE_POLL_MS;
  const [signups, setSignups] = useState<PendingSignup[]>(props.initialSignups ?? []);
  const [students, setStudents] = useState<StudentRow[]>(props.initialStudents ?? []);
  const [recent, setRecent] = useState<Recent[]>([]);
  const [pick, setPick] = useState<Record<string, string>>({});
  const [checks, setChecks] = useState<Record<string, string>>({});
  /** The signup whose link to an existing row waits for the second press. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [note, setNote] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [codeFor, setCodeFor] = useState('');
  const [code, setCode] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [q, st, rc] = await Promise.all([
        api.pending(props.token),
        lessons.listStudents(props.token),
        api.recent(props.token).catch(() => ({ approved: [] as Recent[] }))
      ]);
      setSignups(q.signups);
      setStudents(st);
      setRecent(rc.approved);
    } catch {
      /* the console shows its own auth/network errors; the queue just keeps its last view */
    }
  }, [api, lessons, props.token]);
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(t);
  }, [refresh, pollMs]);

  /** `id`: the sign-up acted on; a wrong 4-digit number closes its confirm box and empties the number to type again. */
  const act = async (fn: () => Promise<string>, id?: string) => {
    setBusy(true);
    setNote(null);
    try {
      setNote({ kind: 'ok', text: await fn() });
      setConfirming(null);
      await refresh();
    } catch (e) {
      const c = e instanceof StudentApiError ? e.code : '';
      if (c === 'check_mismatch' && id) {
        setConfirming(null);
        setChecks((m) => ({ ...m, [id]: '' }));
      }
      setNote({
        kind: 'error',
        text:
          c === 'player_has_guardian'
            ? Q.hasGuardian
            : c === 'nickname_taken'
              ? Q.nickTaken
              : c === 'check_mismatch'
              ? Q.checkWrong
              : c === 'player_has_devices'
                ? Q.hasDevices(Number((e as StudentApiError).body.devices ?? 1))
                : c === 'service_consent_required'
                  ? Q.codeNeedsConsent
                  : Q.err
      });
    } finally {
      setBusy(false);
    }
  };

  const small: React.CSSProperties = { margin: 0, fontSize: `${T.scale.small.sizePx}px` };
  if (props.hideWhenEmpty && signups.length === 0 && !note) return null;
  return (
    <Box title={`${Q.title}${signups.length ? ` (${signups.length})` : ''}`} testId="signup-queue">
      {signups.length === 0 ? <p style={small}>{Q.empty}</p> : null}
      <div style={{ display: 'grid', gap: sp(3) }}>
        {signups.map((s) => {
          // A name that matched a teacher-made student starts on that student (the 4 digits still decide), only when
          // that student is one the teacher can pick in the list below (never a hidden smoke or demo row).
          const match = s.match && students.some((st) => st.player_id === s.match!.player_id) ? s.match : null;
          const target = pick[s.id] ?? match?.player_id ?? '';
          const check = checks[s.id] ?? '';
          const checkOk = /^\d{4}$/.test(check);
          const row = students.find((st) => st.player_id === target);
          const devices = row?.linked_devices ?? 0;
          const asking = confirming === s.id && Boolean(target);
          return (
            <div key={s.id} data-testid="signup-row" style={{ display: 'grid', gap: sp(2) }}>
              <div>
                <strong style={{ fontSize: `${T.scale['body-l'].sizePx}px` }}>{s.nickname}</strong>{' '}
                <span style={small}>{Q.ago(Math.floor((now() - s.created_at) / 60_000))}</span>
                {s.signer ? (
                  <p style={small} data-testid="signup-signer">
                    {Q.signer(s.signer.provider, s.signer.hint)} · {Q.attest(s.signer.attest)}
                  </p>
                ) : null}
                {s.family_students.length ? <p style={small}>{Q.family(s.family_students.map((k) => k.nickname).join(', '))}</p> : null}
                {match ? (
                  <p style={small} data-testid="signup-match">
                    {Q.match(match.nickname)}
                  </p>
                ) : s.match_ambiguous ? (
                  <p style={small} data-testid="signup-match-ambiguous">
                    {Q.ambiguous(s.nickname)}
                  </p>
                ) : s.name_taken ? (
                  <p style={small} data-testid="signup-name-taken">
                    {Q.nameTakenNow(s.nickname)}
                  </p>
                ) : null}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'end' }}>
                <label style={{ ...labelStyle, flex: '0 0 150px' }}>
                  {Q.checkLabel}
                  <input
                    data-testid="signup-check-input"
                    inputMode="numeric"
                    maxLength={4}
                    autoComplete="off"
                    value={check}
                    onChange={(e) => {
                      setChecks({ ...checks, [s.id]: e.target.value.replace(/\D/g, '').slice(0, 4) });
                      setConfirming(null);
                    }}
                    style={inputStyle}
                  />
                </label>
                <label style={{ ...labelStyle, flex: '1 1 200px' }}>
                  {Q.linkTo}
                  <select
                    data-testid="signup-target"
                    value={target}
                    onChange={(e) => {
                      setPick({ ...pick, [s.id]: e.target.value });
                      setConfirming(null);
                    }}
                    style={inputStyle}
                  >
                    <option value="">{Q.pick}</option>
                    {students.map((st) => (
                      <option key={st.player_id} value={st.player_id}>
                        {st.nickname} · {st.player_id}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  type="button"
                  variant="brand"
                  disabled={!target || !checkOk || busy || asking}
                  data-testid="signup-approve"
                  onClick={() => setConfirming(s.id)}
                >
                  {Q.approve}
                </Button>
                <Button
                  type="button"
                  variant="paper"
                  disabled={!checkOk || busy}
                  data-testid="signup-approve-new"
                  onClick={() => void act(async () => Q.approved((await api.approve(props.token, s.id, { new_student: { level: 'L1' }, check })).nickname), s.id)}
                >
                  {Q.newStudent}
                </Button>
                <Button type="button" variant="paper" disabled={busy} data-testid="signup-reject" onClick={() => void act(async () => (await api.reject(props.token, s.id), Q.rejected(s.nickname)))}>
                  {Q.reject}
                </Button>
              </div>
              <p style={small}>{Q.checkHelp}</p>
              {asking ? (
                <div data-testid="signup-confirm" style={{ display: 'grid', gap: sp(2) }}>
                  <Notice kind={devices > 0 ? 'error' : 'ok'}>
                    {Q.confirmLink(s.nickname, `${row?.nickname ?? target} (${target})`)}
                    {devices > 0 ? ` ${Q.hasDevices(devices)}` : ''}
                  </Notice>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2) }}>
                    <Button
                      type="button"
                      variant="brand"
                      disabled={busy}
                      data-testid="signup-confirm-yes"
                      onClick={() =>
                        void act(async () => Q.approved((await api.approve(props.token, s.id, { player_id: target, check, confirm: true })).nickname), s.id)
                      }
                    >
                      {Q.confirmYes}
                    </Button>
                    <Button type="button" variant="paper" disabled={busy} onClick={() => setConfirming(null)}>
                      {SIGNUP_STRINGS_KO.student.cancel}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      {recent.length ? (
        <details style={{ marginTop: sp(3) }} data-testid="signup-recent">
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{Q.recentTitle}</summary>
          <ul style={{ margin: `${sp(2)} 0 0`, paddingLeft: sp(4), display: 'grid', gap: sp(2) }}>
            {recent.map((r) => (
              <li key={r.id} data-testid="signup-recent-row">
                {r.nickname} · {r.player_id} · {Q.ago(Math.floor((now() - r.decided_at) / 60_000))}{' '}
                <Button
                  type="button"
                  variant="paper"
                  disabled={busy}
                  data-testid="signup-undo"
                  onClick={() => void act(async () => (await api.undo(props.token, r.id), Q.undone(r.nickname)))}
                >
                  {Q.undo}
                </Button>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      <details style={{ marginTop: sp(3) }} data-testid="device-code-box">
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>{Q.deviceTitle}</summary>
        <p style={small}>{Q.deviceHelp}</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: sp(2), alignItems: 'end', marginTop: sp(2) }}>
          <select data-testid="device-code-student" value={codeFor} onChange={(e) => setCodeFor(e.target.value)} style={{ ...inputStyle, flex: '1 1 200px' }}>
            <option value="">{Q.pick}</option>
            {students.map((st) => (
              <option key={st.player_id} value={st.player_id}>
                {st.nickname} · {st.player_id}
              </option>
            ))}
          </select>
          <Button
            type="button"
            variant="paper"
            disabled={!codeFor || busy}
            data-testid="device-code-make"
            onClick={() =>
              void act(async () => {
                const r = await api.deviceCode(props.token, codeFor);
                setCode(r.code);
                return Q.deviceHelp;
              })
            }
          >
            {Q.makeCode}
          </Button>
        </div>
        {code ? (
          <p data-testid="device-code" style={{ fontFamily: T.fonts.target, fontSize: `${T.scale.display.sizePx}px`, letterSpacing: '0.2em', margin: `${sp(2)} 0 0` }}>
            {code}
          </p>
        ) : null}
      </details>
      {note ? (
        <div style={{ marginTop: sp(2) }}>
          <Notice kind={note.kind} testId="signup-queue-note">
            {note.text}
          </Notice>
        </div>
      ) : null}
    </Box>
  );
}
