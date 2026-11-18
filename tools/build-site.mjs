// Assembles the static site for the edge Worker: apps/web/dist → apps/edge/public, apps/client/dist → apps/edge/public/world,
// apps/adventure/dist → apps/edge/public/adventure (docs/22).
// Files are copied over the previous build (no cleanup step; hashed asset names make stale files harmless).
// apps/edge/public is ignored by git, so "previous build" means this checkout only: deploy from the tree that made the
// last deploy, or tabs opened before it lose their lazy chunks (/game/assets/* and /world/assets/* of older builds).
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteHeadersFile } from './site-headers.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'apps/edge/public');
for (const app of ['apps/web/dist', 'apps/client/dist', 'apps/adventure/dist']) {
  if (!existsSync(join(root, app, 'index.html'))) throw new Error(`${app} missing — run pnpm build first`);
}
const oldChunks = ['game', 'world'].map((d) => join(out, d, 'assets')).filter((d) => existsSync(d) && readdirSync(d).length > 0);
if (!oldChunks.length)
  console.warn('build-site: no earlier world chunks in apps/edge/public (fresh checkout). Deploying from here drops the chunks tabs opened before the deploy still load; deploy from the tree that made the last deploy.');
mkdirSync(join(out, 'world'), { recursive: true });
mkdirSync(join(out, 'adventure'), { recursive: true });
cpSync(join(root, 'apps/web/dist'), out, { recursive: true, force: true });
cpSync(join(root, 'apps/client/dist'), join(out, 'world'), { recursive: true, force: true });
cpSync(join(root, 'apps/adventure/dist'), join(out, 'adventure'), { recursive: true, force: true });
let sha = 'dev';
try {
  sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
} catch {
  // not a git checkout — keep 'dev'
}
writeFileSync(join(out, 'version.json'), JSON.stringify({ sha, built_at: new Date().toISOString() }));
// Security headers, cache lifetimes and the HTML-only no-transform (keeps Cloudflare's analytics beacon out): site-headers.mjs.
writeFileSync(join(out, '_headers'), siteHeadersFile());
console.log(`site assembled at ${out} (sha ${sha})`);
