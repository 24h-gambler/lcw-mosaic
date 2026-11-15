// Assembles the static site for the edge Worker: apps/web/dist → apps/edge/public, apps/client/dist → apps/edge/public/game.
// Files are copied over the previous build (no cleanup step; hashed asset names make stale files harmless).
import { cpSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'apps/edge/public');
for (const app of ['apps/web/dist', 'apps/client/dist']) {
  if (!existsSync(join(root, app, 'index.html'))) throw new Error(`${app} missing — run pnpm build first`);
}
mkdirSync(join(out, 'game'), { recursive: true });
cpSync(join(root, 'apps/web/dist'), out, { recursive: true, force: true });
cpSync(join(root, 'apps/client/dist'), join(out, 'game'), { recursive: true, force: true });
let sha = 'dev';
try {
  sha = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim();
} catch {
  // not a git checkout — keep 'dev'
}
writeFileSync(join(out, 'version.json'), JSON.stringify({ sha, built_at: new Date().toISOString() }));
writeFileSync(
  join(out, '_headers'),
  [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: microphone=(self), camera=()',
    ''
  ].join('\n')
);
console.log(`site assembled at ${out} (sha ${sha})`);
