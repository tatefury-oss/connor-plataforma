import { many, tx } from '../db.js';
import { DEFAULT_SETTINGS } from '../seed.js';
import { audit } from './audit.js';

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

export async function getSettings() {
  const rows = await many('SELECT key, value FROM settings');
  const out = { ...Object.fromEntries(SETTING_KEYS.map((k) => [k, ''])) };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function updateSettings(values, req) {
  const changed = {};
  const current = await getSettings();
  await tx(async (db) => {
    for (const key of SETTING_KEYS) {
      if (!(key in values)) continue;
      const value = String(values[key] ?? '').trim().slice(0, 5000);
      if (value === current[key]) continue;
      await db.query(
        `INSERT INTO settings (key, value, updated_at, updated_by) VALUES ($1, $2, now(), $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [key, value, req.user.id],
      );
      changed[key] = { from: current[key], to: value };
    }
    if (Object.keys(changed).length) await audit({ db, req, action: 'settings.update', entity: 'settings', details: changed });
  });
  return changed;
}
