/**
 * The student document link (english-day contract v1, docs/22 3장): the document opens
 * `/adventure/?ed=<student>&edd=<lesson day>&edk=<write key>&edr=<back URL>`. The four values stay in sessionStorage so
 * a reload keeps them. Without `ed` nothing is sent anywhere.
 */
export const ED_ORIGIN = 'https://english-day.pages.dev';
export const ED_SESSION_KEY = 'lcw.adventure.ed';

export interface EdLink {
  student: string;
  date: string | null;
  key: string | null;
  back: string | null;
}

const STUDENT = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEY = /^[A-Za-z0-9_-]{8,128}$/;

/** Only a page of the student document may be the way back (no open redirect). */
export function safeBack(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    const url = new URL(u);
    return url.origin === ED_ORIGIN && url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function parseEdLink(search: string): EdLink | null {
  const q = new URLSearchParams(search);
  const student = (q.get('ed') ?? '').trim().toLowerCase();
  if (!STUDENT.test(student)) return null;
  const date = q.get('edd');
  const key = q.get('edk');
  return {
    student,
    date: date && DAY.test(date) ? date : null,
    key: key && KEY.test(key) ? key : null,
    back: safeBack(q.get('edr'))
  };
}

export function readEdLink(search: string, session: Pick<Storage, 'getItem' | 'setItem'> | null): EdLink | null {
  const fromUrl = parseEdLink(search);
  if (fromUrl) {
    try {
      session?.setItem(ED_SESSION_KEY, JSON.stringify(fromUrl));
    } catch {
      // storage blocked: the link still works for this page view
    }
    return fromUrl;
  }
  try {
    const raw = session?.getItem(ED_SESSION_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as EdLink;
    if (!STUDENT.test(j.student)) return null;
    return { student: j.student, date: j.date && DAY.test(j.date) ? j.date : null, key: j.key && KEY.test(j.key) ? j.key : null, back: safeBack(j.back) };
  } catch {
    return null;
  }
}

/** Day files to try, most specific first. */
export function dayFileUrls(link: EdLink): string[] {
  const base = `${ED_ORIGIN}/${encodeURIComponent(link.student)}`;
  return [...(link.date ? [`${base}/days/${link.date}.json`] : []), `${base}/today.json`];
}

export function resultUrl(link: EdLink): string | null {
  return link.key ? `${ED_ORIGIN}/api/result?k=${encodeURIComponent(link.key)}` : null;
}
