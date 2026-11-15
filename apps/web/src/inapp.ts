/** In-app browser detection for /try (docs/14 section 8). Pure: takes the UA string, never touches navigator. */

export type InAppKind =
  | 'kakaotalk'
  | 'instagram'
  | 'facebook'
  | 'naver'
  | 'line'
  | 'daum'
  | 'ios_webview';

export interface InAppDetection {
  kind: InAppKind | null;
  isIOS: boolean;
  isAndroid: boolean;
}

const IN_APP_PATTERNS: ReadonlyArray<{ kind: InAppKind; re: RegExp }> = [
  { kind: 'kakaotalk', re: /KAKAOTALK/i },
  { kind: 'instagram', re: /Instagram/i },
  { kind: 'facebook', re: /FBAN|FBAV|FB_IAB/i },
  { kind: 'naver', re: /NAVER\(inapp|NAVER\(in-app/i },
  { kind: 'line', re: /\bLine\/\d/i },
  { kind: 'daum', re: /DaumApps|Daum\//i }
];

export function detectInAppBrowser(ua: string): InAppDetection {
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  for (const { kind, re } of IN_APP_PATTERNS) {
    if (re.test(ua)) return { kind, isIOS, isAndroid };
  }
  // A WKWebView on iOS has AppleWebKit but no "Safari/" token; real Safari and iOS Chrome/Firefox include it.
  if (isIOS && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua)) {
    return { kind: 'ios_webview', isIOS, isAndroid };
  }
  return { kind: null, isIOS, isAndroid };
}

/** Android Chrome intent link that re-opens the same page outside the in-app browser. */
export function buildChromeIntentUrl(pageUrl: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(pageUrl);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const rest = `${parsed.host}${parsed.pathname}${parsed.search}`;
  return `intent://${rest}#Intent;scheme=${parsed.protocol.slice(0, -1)};package=com.android.chrome;end`;
}

export type OpenOutsideAction = 'intent_link' | 'copy_link';

/** Android offers the Chrome intent; iOS cannot be redirected, so it gets instructions plus a copy button. */
export function chooseOpenOutsideAction(d: InAppDetection): OpenOutsideAction | null {
  if (!d.kind) return null;
  return d.isAndroid && !d.isIOS ? 'intent_link' : 'copy_link';
}
