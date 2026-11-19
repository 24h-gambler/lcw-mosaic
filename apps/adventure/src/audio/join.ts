import { saveStudentSession, type JoinResult } from '../../../client/src/lesson/api.js';
import { ADV } from '../core/tuning.js';
import { tokenRenewed } from './listen.js';

/**
 * The class code for the 🎤 (docs/22 1.3): a child with no token in this tab and no linked device types the 6-digit code
 * from the teacher's console. It goes to the same `POST /v1/join` as LCW, and the answer is kept under the same
 * sessionStorage keys (apps/client lesson/api.ts saveStudentSession), so a later LCW page in this tab is in the
 * lesson too. The code is never kept; the token never leaves this tab.
 */
export type JoinEnd = { ok: true; nickname: string } | { ok: false; reason: 'format' | 'invalid' | 'busy' | 'network' };

export function cleanCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, ADV.joinCodeDigits);
}

export async function joinWithCode(raw: string, fetchImpl: typeof fetch = (...a) => fetch(...a)): Promise<JoinEnd> {
  const code = cleanCode(raw);
  if (code.length !== ADV.joinCodeDigits) return { ok: false, reason: 'format' };
  let res: Response;
  try {
    res = await fetchImpl('/v1/join', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
  } catch {
    return { ok: false, reason: 'network' };
  }
  if (res.status === 429) return { ok: false, reason: 'busy' };
  if (!res.ok) return { ok: false, reason: res.status === 404 || res.status === 400 ? 'invalid' : 'network' };
  const j = (await res.json().catch(() => null)) as JoinResult | null;
  if (!j || typeof j.student_token !== 'string' || !j.student_token) return { ok: false, reason: 'network' };
  tokenRenewed();
  saveStudentSession({ token: j.student_token, lessonId: j.lesson_id, nickname: j.nickname ?? '', level: j.level ?? 'L1', voiceStore: Boolean(j.voice_store) });
  return { ok: true, nickname: j.nickname ?? '' };
}
