// Family invite link for one child's guardian (the only way into /family until guardian OAuth): the operator makes it,
// a person sends it. This tool only makes it and prints it once; it sends nothing to anyone.
//
//   node tools/family-invite.mjs --player stu-29ddc960 [--base https://lcw.worldwidesomething.com] [--token-file <path>]
//
// - One POST /v1/admin/family-invites. The link is single-use and lives 7 days (FAMILY_INVITE_TTL_MS); a used or
//   expired link just answers "invalid", so making a new one is safe. Several open links can exist at once.
// - The code rides in the URL fragment (/family#k=...), so it never reaches server logs. Treat the printed link like a
//   password: whoever opens it first becomes the family's guardian session on that browser.
// - The operator token is read from --token-file (default LCW_OPERATOR_TOKEN_FILE, else the automation secrets file)
//   and is never printed. `node tools/guardian-check.mjs --player <id> --before` shows the invite and sign-in state.
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const player = opt('player');
if (!player) {
  console.error('usage: node tools/family-invite.mjs --player <id> [--base <url>] [--token-file <path>]');
  process.exit(2);
}
const base = opt('base', 'https://lcw.worldwidesomething.com').replace(/\/$/, '');
const tokenFile = opt('token-file', process.env.LCW_OPERATOR_TOKEN_FILE || 'C:/Users/2idki/automation/secrets/lcw-operator.token');
const token = (process.env.LCW_OPERATOR_TOKEN || readFileSync(tokenFile, 'utf8')).trim();
const res = await fetch(`${base}/v1/admin/family-invites`, {
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ player_id: player }),
  signal: AbortSignal.timeout(20_000)
});
const body = await res.json().catch(() => ({}));
if (res.status !== 201) {
  console.error(`family-invites answered ${res.status} ${body.error ?? ''}`);
  process.exit(1);
}
const until = new Date(body.expires_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
console.log(`${base}${body.invite_path}`);
console.error(`one use, until ${until} KST - send it to the guardian yourself; this tool sent nothing`);
