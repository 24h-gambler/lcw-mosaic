// Layout check for every kid-screen part (frame domain, docs/08 §8.6): all visible, positioned boxes on the screen —
// HUD (world/hud.ts), menu button, errand / goal walk buttons and toasts (dialog), lesson layer, connection band —
// checked pair by pair for overlap, and each for running off the screen or cutting its own text. Shared by
// tools/frame-shots.mjs and tools/frame-menu-shots.mjs; `layoutIssues(page)` returns readable problems ([] = clean).
//
// What counts as a part: an element with position absolute/fixed whose box is visible (display, visibility, opacity
// up the tree, size). A transparent full-width holder (no background, border or shadow — a layer or a column) is not a
// part itself: its children are. Parts nested in another part belong to it and are not compared with it.

/** In-page: the parts, their boxes and labels, and the problems. Keep it self-contained (it is serialised). */
export const LAYOUT_SNAPSHOT = () => {
  const vw = innerWidth;
  const vh = innerHeight;
  // a part shows when nothing up the tree hides it and it is not faded down to see-through (a world name plate under a
  // HUD card fades to .12 on purpose: it no longer covers anything)
  const shown = (e) => {
    let alpha = 1;
    for (let n = e; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      alpha *= Number(cs.opacity);
    }
    if (alpha < 0.3) return false;
    const b = e.getBoundingClientRect();
    return b.width > 1 && b.height > 1;
  };
  const plain = (e) => {
    const cs = getComputedStyle(e);
    const bg = cs.backgroundColor;
    const clear = !bg || bg === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(bg);
    return clear && cs.backgroundImage === 'none' && cs.boxShadow === 'none' && parseFloat(cs.borderTopWidth) === 0 && parseFloat(cs.borderLeftWidth) === 0;
  };
  const label = (e) => {
    const cls = typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 2).join('.') : e.tagName.toLowerCase();
    const t = (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28);
    return t ? `${cls} "${t}"` : cls;
  };
  const parts = [];
  const visit = (e, depth) => {
    if (depth > 12 || !(e instanceof HTMLElement) || e.tagName === 'CANVAS' || e.tagName === 'SCRIPT' || e.tagName === 'STYLE') return;
    if (!shown(e) && getComputedStyle(e).display === 'none') return;
    const cs = getComputedStyle(e);
    const positioned = cs.position === 'absolute' || cs.position === 'fixed';
    const b = e.getBoundingClientRect();
    const wide = b.width >= vw * 0.9 || b.height >= vh * 0.9;
    // a box over the whole screen is a layer (the page, the HUD root, a dim backdrop): its children are the parts
    const layer = b.width >= vw * 0.9 && b.height >= vh * 0.9;
    // a box in the flow of a screen layer (the lesson layer's status row and folded window are flex items of a full-screen
    // column): it is on the screen like a positioned one when it shows something (a card, a button); 11-19 the status row
    // lay on the HUD's Talk button and no check saw it
    const flowPart = !positioned && !layer && (!plain(e) || e.matches('button,a[href],[role="button"],[role="status"]'));
    if ((positioned || flowPart) && !layer && shown(e) && !(wide && plain(e)) && !e.hasAttribute('aria-hidden') && !e.closest('[data-layout-ignore]')) {
      // an all-transparent box with no text of its own (an empty holder) is not a part either
      if (!(plain(e) && !(e.textContent || '').trim() && !e.querySelector('img,svg,canvas'))) {
        parts.push(e);
        // what is inside a positioned part belongs to it; a card in the flow (a menu window, the lesson panel) keeps
        // its own parts in the check (pairs where one holds the other are not compared)
        if (positioned) return;
      }
    }
    for (const c of e.children) visit(c, depth + 1);
  };
  visit(document.body, 0);
  // world-anchored labels (name plates, talk prompt, speech bubbles) follow people in the 3D view: two of them meeting is
  // the world, not the frame's layout; they are still held against every HUD part
  const WORLD = '.lw-plate,.lw-prompt,.lw-bub';
  // what shows of a part: its box cut by every scrolling / clipping holder above it (the lesson panel scrolls on a short
  // screen: the card inside runs past the screen edge but only the holder's window of it shows)
  const cutBy = new Map();
  const seen = (e) => {
    const b = e.getBoundingClientRect();
    let x0 = b.left, y0 = b.top, x1 = b.right, y1 = b.bottom;
    for (let n = e.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      const ov = cs.overflow + ' ' + cs.overflowX + ' ' + cs.overflowY;
      const scrolls = /(auto|scroll)/.test(ov);
      const clips = /(hidden|clip)/.test(ov);
      if (!scrolls && !clips) continue;
      const c = n.getBoundingClientRect();
      // a full-screen clipping layer (the HUD root) is the screen edge: the edge check below sees past it
      if (!scrolls && c.width >= vw * 0.9 && c.height >= vh * 0.9) continue;
      // a holder that only clips (no scrolling) and cuts the part: the child cannot get to the rest
      if (!scrolls && (b.left < c.left - 0.5 || b.top < c.top - 0.5 || b.right > c.right + 0.5 || b.bottom > c.bottom + 0.5) && !cutBy.has(e)) cutBy.set(e, n);
      x0 = Math.max(x0, c.left); y0 = Math.max(y0, c.top); x1 = Math.min(x1, c.right); y1 = Math.min(y1, c.bottom);
    }
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  };
  const boxes = parts
    .map((e) => ({ e, ...seen(e), name: label(e), world: e.matches(WORLD) }))
    .filter((b) => b.w > 1 && b.h > 1);
  const cutProblems = [...cutBy.entries()].filter(([e]) => boxes.some((b) => b.e === e)).map(([e, n]) => `cut by its holder: ${label(e)} in ${label(n)}`);
  const problems = [...cutProblems];
  const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    // off the screen: any side past the edge (a part that is hidden by sliding out must also stop showing)
    if (a.x < -0.5 || a.y < -0.5 || a.x + a.w > vw + 0.5 || a.y + a.h > vh + 0.5) problems.push(`cut by the screen edge: ${a.name} [${Math.round(a.x)},${Math.round(a.y)} ${Math.round(a.w)}x${Math.round(a.h)}]`);
    // its own text cut (ellipsis or hidden overflow)
    const cs = getComputedStyle(a.e);
    if ((cs.overflow === 'hidden' || cs.overflowX === 'hidden' || cs.textOverflow === 'ellipsis') && a.e.scrollWidth > a.e.clientWidth + 1) problems.push(`text cut inside: ${a.name}`);
    for (let j = i + 1; j < boxes.length; j++) {
      const b = boxes[j];
      if (a.e.contains(b.e) || b.e.contains(a.e) || (a.world && b.world)) continue;
      const area = inter(a, b);
      // a sliver under 4 px (shadows, rounding) is not an overlap a child sees
      if (area > 0 && Math.min(Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)) >= 4) {
        problems.push(`overlap: ${a.name} / ${b.name}`);
      }
    }
  }
  // labels drawn inside the 3D view (the teacher's name plate, world handle screenLabels): one that still shows over a
  // screen part is a problem (prod 11-18: 'Teacher' through the status chip)
  const labels = window.__lcwWorld?.screenLabels?.() ?? [];
  for (const l of labels) {
    if (l.opacity < 0.5) continue;
    for (const b of boxes) {
      if (b.world) continue;
      const ox = Math.min(l.x + l.w, b.x + b.w) - Math.max(l.x, b.x);
      const oy = Math.min(l.y + l.h, b.y + b.h) - Math.max(l.y, b.y);
      if (ox >= 4 && oy >= 4) problems.push(`world label over a screen part: "${l.name}" / ${b.name}`);
    }
  }
  return { labels, parts: boxes.map(({ e, world, ...r }) => ({ ...r, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })), problems };
};

/** Problems on the page now (dedented labels), plus the parts for a report. */
export async function layoutIssues(page) {
  return page.evaluate(LAYOUT_SNAPSHOT);
}
