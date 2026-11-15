/**
 * Static HTML for the public pages (docs/14 §11): crawlers and link previews get the real page, and people see the
 * page before the script runs. tools/prerender-site.mjs builds this file for node and writes dist/<path>.html.
 */
import React from 'react';
import { renderToString } from 'react-dom/server';
import { SiteRoot } from './SiteRoot.js';
import { SHARE_IMAGE_SIZE, indexable, metaFor, parseSitePath, prerenderPaths, shareImageFor, type ShareImage } from './routes.js';

/** Production host (apps/edge/wrangler.toml routes). */
export const SITE_ORIGIN = 'https://lcw.worldwidesomething.com';

export interface PrerenderedPage {
  path: string;
  title: string;
  description: string;
  body: string;
  image: ShareImage;
  index: boolean;
}

export const SITE_NAME = 'LCW 말하면 생기는 세계';

export function prerenderPage(path: string): PrerenderedPage {
  const loc = parseSitePath(path);
  if (!loc) throw new Error(`not a site path: ${path}`);
  const meta = metaFor(loc);
  return { path: loc.path, ...meta, image: shareImageFor(loc), index: indexable(loc), body: renderToString(<SiteRoot initialPath={loc.path} />) };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Fills the Vite index.html shell for one page. Unknown paths fall back to the root file (SPA), so the root copy clears
 * its pre-rendered landing before first paint when it is served for another address (lesson, director, family…).
 */
export function fillShell(shell: string, page: PrerenderedPage, origin = SITE_ORIGIN): string {
  const url = `${origin}${page.path === '/' ? '/' : page.path}`;
  const head = [
    `<title>${esc(page.title)}</title>`,
    `<meta name="description" content="${esc(page.description)}" />`,
    `<link rel="canonical" href="${esc(url)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(page.title)}" />`,
    `<meta property="og:description" content="${esc(page.description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:locale" content="ko_KR" />`,
    `<meta property="og:site_name" content="${esc(SITE_NAME)}" />`,
    `<meta property="og:image" content="${esc(`${origin}/og/${page.image}.jpg`)}" />`,
    `<meta property="og:image:width" content="${SHARE_IMAGE_SIZE.width}" />`,
    `<meta property="og:image:height" content="${SHARE_IMAGE_SIZE.height}" />`,
    `<meta property="og:image:alt" content="${esc(page.title)} — 실제 게임 화면" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    ...(page.index ? [] : ['<meta name="robots" content="noindex" />'])
  ].join('\n    ');
  const guard = `<script>(function(){var p=location.pathname.replace(/\\/+$/,'')||'/';if(p!==${JSON.stringify(page.path)}){var r=document.getElementById('root');if(r)r.innerHTML='';}})();</script>`;
  let out = shell.replace(/<title>[\s\S]*?<\/title>/, '').replace(/\s*<meta name="description"[^>]*>/, '');
  out = out.replace('</head>', `    ${head}\n  </head>`);
  out = out.replace('<div id="root"></div>', `<div id="root">${page.body}</div>\n    ${guard}`);
  return out;
}

export function allPages(): PrerenderedPage[] {
  return prerenderPaths().map(prerenderPage);
}

/** robots.txt for the whole host (tools/prerender-site.mjs). /r/ and /s/ stay crawlable for link previews, see there. */
export function robotsTxt(origin = SITE_ORIGIN): string {
  return ['User-agent: *', 'Disallow: /join', 'Disallow: /director', 'Disallow: /family', 'Disallow: /link', 'Disallow: /seats', 'Disallow: /window', 'Disallow: /report', 'Disallow: /dashboard', 'Disallow: /claim', 'Disallow: /guest-end', 'Disallow: /game/', 'Disallow: /v1/', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n');
}
