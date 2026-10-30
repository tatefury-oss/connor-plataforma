import { query } from '../db.js';

// db puede ser el pool o un cliente de transacción.
export async function audit({ db, req, userId, action, entity, entityId, details = {} }) {
  await (db?.query ? db : { query }).query(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId ?? req?.user?.id ?? null, action, entity, entityId == null ? null : String(entityId), JSON.stringify(details), req?.ip ?? null],
  );
}
