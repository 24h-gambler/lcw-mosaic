import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { siteCss } from '../site/siteCss.js';

// Audit 11-16: Korean lines broke inside words ('만든/다', '드립니/다', '넣/어요') on the site and /join.
describe('Korean text breaks between words', () => {
  it('every page of the web app (site, /join, guardian screens) keeps words whole', () => {
    const shell = readFileSync(fileURLToPath(new URL('../../index.html', import.meta.url)), 'utf8');
    expect(shell).toMatch(/body\{word-break:keep-all;overflow-wrap:anywhere\}/);
  });
  it('the site root says so too (pre-rendered pages read before the shell style could be dropped)', () => {
    const css = siteCss();
    expect(css).toMatch(/\.s-root\{[^}]*word-break:keep-all;overflow-wrap:anywhere\}/);
  });
});
