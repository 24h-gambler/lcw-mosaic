/**
 * HTML shell for /s/<token> (showroom share link, WP-703). Link previewers (KakaoTalk, search, messengers) read only
 * the served HTML, so the preview tags are set here: the world's own title (already checked for names and contact
 * details when it was published, see showroom.ts), a generic picture, noindex and no-referrer. A withdrawn or unknown
 * link answers 404 with a neutral title, so a preview never shows a world whose guardian took consent back.
 */
import { SHOWROOM_TOKEN_RE } from './showroom.js';

export const SHOWROOM_SHARE_META_KO = {
  suffix: ' — LCW 쇼룸',
  description: '친구가 LCW에서 지은 월드예요. 정지된 장면이라 위치·목소리·실명은 담기지 않아요.',
  missingTitle: '찾을 수 없는 쇼룸 — LCW',
  missingDescription: '공개가 끝났거나 없는 쇼룸이에요.',
  siteName: 'LCW 말하면 생기는 세계',
  demoTitle: '예시 월드'
} as const;

/** Preview picture (1200×630, a real /world capture, no player names). Stable name so previewers can cache it. */
export const SHOWROOM_OG_IMAGE_PATH = '/og/showroom.jpg';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function showroomShareHead(origin: string, title: string | null): string {
  const m = SHOWROOM_SHARE_META_KO;
  const t = title === null ? m.missingTitle : `${title}${m.suffix}`;
  const d = title === null ? m.missingDescription : m.description;
  return [
    `<title>${esc(t)}</title>`,
    `<meta name="description" content="${esc(d)}" />`,
    '<meta name="robots" content="noindex, nofollow" />',
    '<meta name="referrer" content="no-referrer" />',
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${esc(m.siteName)}" />`,
    `<meta property="og:title" content="${esc(t)}" />`,
    `<meta property="og:description" content="${esc(d)}" />`,
    `<meta property="og:image" content="${esc(origin + SHOWROOM_OG_IMAGE_PATH)}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta name="twitter:card" content="summary_large_image" />'
  ].join('\n    ');
}

/** Swaps the landing file's own title/description/og/canonical for the showroom ones (og:url left out on purpose). */
export function rewriteShowroomShell(html: string, origin: string, title: string | null): string {
  const cleaned = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+(?:name|property)="(?:description|robots|referrer|og:[^"]*|twitter:[^"]*)"[^>]*>\s*/gi, '')
    .replace(/<link\s+rel="canonical"[^>]*>\s*/gi, '');
  return cleaned.replace(/<\/head>/i, `    ${showroomShareHead(origin, title)}\n  </head>`);
}

/** `/s/<token>` → token, else null (the page itself handles `/s/demo`). */
export function showroomTokenFromPath(pathname: string): string | null {
  const m = /^\/s\/([^/]+)\/?$/.exec(pathname);
  return m ? m[1]! : null;
}

/**
 * Serves the SPA shell for a showroom link with preview tags. `lookup` reads the published title through the same
 * route the page uses (GET /v1/showroom/:token), so consent checks stay in one place.
 */
export async function injectShowroomShareMeta(
  shell: Response,
  url: URL,
  lookup: (token: string) => Promise<{ title: string } | null>
): Promise<Response> {
  const token = showroomTokenFromPath(url.pathname);
  let title: string | null = null;
  if (token === 'demo') title = SHOWROOM_SHARE_META_KO.demoTitle;
  else if (token && SHOWROOM_TOKEN_RE.test(token)) title = (await lookup(token).catch(() => null))?.title ?? null;
  const html = shell.ok ? rewriteShowroomShell(await shell.text(), url.origin, title) : await shell.text();
  return new Response(html, {
    status: !shell.ok ? shell.status : title === null ? 404 : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': title === null ? 'private, no-store' : 'public, max-age=60',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff'
    }
  });
}
