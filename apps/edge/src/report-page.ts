/**
 * HTML shell for /r/<token> (lesson report share link). KakaoTalk and other link previewers read only the served HTML,
 * so the preview tags are set here, on the server: a generic title with no child name, nickname or date of birth
 * (docs/16 §1 "실명 없음"), noindex, and no-referrer so the token never leaks to other sites.
 */

export const REPORT_SHARE_META_KO = {
  title: '오늘의 영어 수업 리포트 · LCW',
  description: '아이가 수업에서 직접 말한 영어 문장과 말한 시간을 담았습니다. 이 링크를 받은 분만 볼 수 있습니다.',
  siteName: 'LCW 말하면 생기는 세계'
} as const;

/** Preview image (1200×630, no names). Served from apps/web/public. */
export const REPORT_OG_IMAGE_PATH = '/og-report.png';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function reportShareHead(origin: string): string {
  const m = REPORT_SHARE_META_KO;
  return [
    `<title>${esc(m.title)}</title>`,
    `<meta name="description" content="${esc(m.description)}" />`,
    '<meta name="robots" content="noindex, nofollow" />',
    '<meta name="referrer" content="no-referrer" />',
    '<meta property="og:type" content="website" />',
    `<meta property="og:site_name" content="${esc(m.siteName)}" />`,
    `<meta property="og:title" content="${esc(m.title)}" />`,
    `<meta property="og:description" content="${esc(m.description)}" />`,
    `<meta property="og:image" content="${esc(origin + REPORT_OG_IMAGE_PATH)}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    '<meta name="twitter:card" content="summary_large_image" />'
  ].join('\n    ');
}

/** Replaces the SPA shell's own title/description/og tags (the site's) with the report ones. og:url is left out on purpose. */
export function rewriteReportShell(html: string, origin: string): string {
  const cleaned = html
    .replace(/<title>[\s\S]*?<\/title>\s*/i, '')
    .replace(/<meta\s+(?:name|property)="(?:description|robots|referrer|og:[^"]*|twitter:[^"]*)"[^>]*>\s*/gi, '');
  return cleaned.replace(/<\/head>/i, `    ${reportShareHead(origin)}\n  </head>`);
}

export async function injectReportShareMeta(shell: Response, url: URL): Promise<Response> {
  const html = shell.ok ? rewriteReportShell(await shell.text(), url.origin) : await shell.text();
  return new Response(html, {
    status: shell.ok ? 200 : shell.status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'private, no-store',
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex, nofollow',
      'x-content-type-options': 'nosniff'
    }
  });
}
