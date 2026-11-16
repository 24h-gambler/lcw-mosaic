import type { EdgePlatformDb } from './storage.js';

/**
 * The child's settings, carried between devices (sound, view, hint toggles the client owns). The server does not read
 * them: it checks the shape, stores one row per player and gives it back. Small and flat on purpose, so a settings
 * write can never become a way to store free text about a child.
 */
export const PLAYER_SETTINGS_SCHEMA_SQL = `
create table if not exists player_settings (player_id text primary key, data text not null, updated_at integer not null)
`;

export const SETTINGS_MAX_KEYS = 40;
export const SETTINGS_MAX_STRING = 32;
export const SETTINGS_MAX_BYTES = 4096;
const KEY_RE = /^[a-z][a-zA-Z0-9_.]{0,39}$/;

export type SettingsValue = number | boolean | string;

/** Flat object, at most 40 keys, finite numbers / booleans / strings of 32 chars or less, 4 KB serialized. */
export function validateSettings(raw: unknown): { ok: true; settings: Record<string, SettingsValue> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'settings_not_object' };
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > SETTINGS_MAX_KEYS) return { ok: false, error: 'too_many_keys' };
  const out: Record<string, SettingsValue> = {};
  for (const [k, v] of entries) {
    if (!KEY_RE.test(k)) return { ok: false, error: 'bad_key' };
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return { ok: false, error: 'bad_value' };
    } else if (typeof v === 'string') {
      if (v.length > SETTINGS_MAX_STRING) return { ok: false, error: 'bad_value' };
    } else if (typeof v !== 'boolean') {
      return { ok: false, error: 'bad_value' };
    }
    out[k] = v as SettingsValue;
  }
  if (new TextEncoder().encode(JSON.stringify(out)).length > SETTINGS_MAX_BYTES) return { ok: false, error: 'too_large' };
  return { ok: true, settings: out };
}

export function readSettings(db: EdgePlatformDb, playerId: string): { settings: Record<string, SettingsValue>; updated_at: number | null } {
  const row = db.sql.get<{ data: string; updated_at: number }>('select data, updated_at from player_settings where player_id = ?', [playerId]);
  if (!row) return { settings: {}, updated_at: null };
  return { settings: JSON.parse(row.data) as Record<string, SettingsValue>, updated_at: Number(row.updated_at) };
}

export function writeSettings(db: EdgePlatformDb, playerId: string, settings: Record<string, SettingsValue>, nowMs: number): { ok: true; updated_at: number } {
  db.sql.run(
    `insert into player_settings (player_id, data, updated_at) values (?, ?, ?)
     on conflict(player_id) do update set data = excluded.data, updated_at = excluded.updated_at`,
    [playerId, JSON.stringify(settings), nowMs]
  );
  return { ok: true, updated_at: nowMs };
}
