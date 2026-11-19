/**
 * Cookie-free visit counters (docs/14 §11). Only the event name and the page path are sent; no identifiers,
 * no cookies, no third-party script. The edge keeps daily counts per (event, path).
 */

export const SITE_EVENTS = [
  'entrance_parents',
  'entrance_players',
  'try_start',
  'mic_allowed',
  'order_done',
  'save_yes',
  'save_no',
  'send_to_parent',
  'pricing_view',
  'consult_submit',
  // R326: the world entrance and the paid step
  'entrance_play',
  'checkout_start',
  'checkout_done'
] as const;

export type SiteEvent = (typeof SITE_EVENTS)[number];

export const SITE_EVENT_ENDPOINT = '/v1/site/event';

export function eventPayload(event: SiteEvent, path: string): string {
  const cleanPath = (path.split(/[?#]/)[0] ?? '/').slice(0, 64);
  return JSON.stringify({ event, path: cleanPath });
}

export function track(event: SiteEvent): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
  const body = eventPayload(event, window.location.pathname);
  try {
    if (typeof navigator.sendBeacon === 'function') {
      navigator.sendBeacon(SITE_EVENT_ENDPOINT, new Blob([body], { type: 'application/json' }));
      return;
    }
    void fetch(SITE_EVENT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'omit'
    }).catch(() => undefined);
  } catch {
    // Counting must never break the page.
  }
}
