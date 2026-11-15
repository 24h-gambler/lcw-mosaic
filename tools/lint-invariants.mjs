import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FORBIDDEN_AI_ENDPOINTS = [
  'generativelanguage.googleapis.com',
  'api.openai.com',
  'api.anthropic.com'
];

const FORBIDDEN_COMPETITOR_TERMS = [
  'minecraft',
  'terraria',
  'roblox',
  'animal crossing',
  'grand theft auto',
  '마인크래프트',
  '테라리아',
  '로블록스',
  '동물의 숲'
];

export function scanSourceForDirectChunkWrite(code, filename) {
  const norm = filename.replace(/\\/g, '/');
  const violations = [];
  const lines = code.split(/\r?\n/);
  const isChunkFile = norm.endsWith('packages/sim-core/src/chunk.ts');
  const isDestructionKernel = norm.endsWith('packages/destruction/src/kernel.ts');
  const isVoxelWorldFile = norm.endsWith('packages/sim-core/src/world.ts');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // Direct voxel buffer assignment outside CubicChunk.setVoxelInternal
    if (/\.voxels\s*\[[^\]]+\]\s*=/.test(line) && !isChunkFile) {
      violations.push(`${norm}:${i + 1}: direct voxel buffer write outside CubicChunk.setVoxelInternal`);
    }

    // Calling setVoxelInternal outside VoxelWorld.setBlock or CubicChunk
    if (/\.setVoxelInternal\s*\(/.test(line) && !isChunkFile && !isVoxelWorldFile) {
      violations.push(`${norm}:${i + 1}: direct setVoxelInternal call bypasses setBlock`);
    }

    // Direct delta/temp Map writes outside destruction kernel
    if (/\b(?:delta|temp)\.set\s*\(/.test(line) && !isDestructionKernel) {
      violations.push(`${norm}:${i + 1}: direct delta/temp map write bypasses setBlock`);
    }
  }
  return violations;
}

export function scanSourceForInvariants(code, filename) {
  const norm = filename.replace(/\\/g, '/');
  const violations = [...scanSourceForDirectChunkWrite(code, norm)];
  const lower = code.toLowerCase();
  const isTestFile = /\.test\.tsx?$/.test(norm);

  if (!isTestFile) {
    for (const endpoint of FORBIDDEN_AI_ENDPOINTS) {
      if (lower.includes(endpoint)) {
        violations.push(`${norm}: forbidden external LLM endpoint "${endpoint}"`);
      }
    }
    for (const term of FORBIDDEN_COMPETITOR_TERMS) {
      if (lower.includes(term)) {
        violations.push(`${norm}: forbidden reference game term "${term}"`);
      }
    }
  } else {
    if (/\b(?:it|test|describe)\.(?:skip|todo)\s*\(/.test(code)) {
      violations.push(`${norm}: skipped or todo test is forbidden (AGENTS.md 4.13)`);
    }
  }

  // UI hardcoded color check (AGENTS.md 6: UI tokens only)
  const isUiComponentFile =
    norm.includes('packages/ui/src/components') ||
    norm.includes('apps/web/src/') ||
    norm.includes('apps/client/src/Hud') ||
    norm.includes('apps/client/src/dialog/');
  if (isUiComponentFile && !isTestFile) {
    const lines = code.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim().startsWith('//')) continue;
      if (/#[0-9a-fA-F]{3,8}\b/.test(line)) {
        violations.push(`${norm}:${i + 1}: hardcoded hex color in UI file; use @lcw/ui tokens`);
      }
    }
  }

  return violations;
}

export function checkAudioLicenses(rootDir = ROOT) {
  const audioDir = path.join(rootDir, 'assets', 'audio');
  if (!fs.existsSync(audioDir)) return [];
  const ledgerPath = path.join(audioDir, 'LICENSES.md');
  if (!fs.existsSync(ledgerPath)) {
    return ['assets/audio/LICENSES.md is missing'];
  }
  const ledger = fs.readFileSync(ledgerPath, 'utf8');
  const violations = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name !== 'LICENSES.md') {
        const rel = path.relative(audioDir, full).replace(/\\/g, '/');
        if (!ledger.includes(rel) && !ledger.includes(entry.name)) {
          violations.push(`assets/audio/${rel} is not listed in assets/audio/LICENSES.md`);
        }
      }
    }
  };
  walk(audioDir);
  return violations;
}

function collectSourceFiles(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectSourceFiles(full, out);
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

export function runAllChecks(rootDir = ROOT) {
  const violations = [];
  const files = [
    ...collectSourceFiles(path.join(rootDir, 'packages')),
    ...collectSourceFiles(path.join(rootDir, 'apps'))
  ];
  for (const file of files) {
    const code = fs.readFileSync(file, 'utf8');
    const rel = path.relative(rootDir, file).replace(/\\/g, '/');
    violations.push(...scanSourceForInvariants(code, rel));
  }
  violations.push(...checkAudioLicenses(rootDir));
  return violations;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const violations = runAllChecks(ROOT);
  if (violations.length > 0) {
    console.error('Invariant lint failed:');
    for (const v of violations) console.error('  -', v);
    process.exit(1);
  }
  console.log('Invariant lint passed.');
}
