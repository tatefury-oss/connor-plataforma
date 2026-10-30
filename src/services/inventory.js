// Fase 5 · Inventario de lotes: disponibilidad, apartados, ventas e historial auditable.
import { many, one, tx } from '../db.js';
import { can } from '../security/rbac.js';
import { audit } from './audit.js';
import { STAGES, getLead } from './leads.js';
import { notifyRoles, notifyUser } from './realtime.js';

export const LOT_STATUS = {
  disponible: 'Disponible',
  apartado: 'Apartado',
  vendido: 'Vendido',
  bloqueado: 'Bloqueado',
};

const STAGE_ORDER = Object.keys(STAGES);

export function money(value, currency = 'MXN') {
  if (value == null || value === '') return '—';
  return `${Number(value).toLocaleString('es-MX', { style: 'currency', currency, maximumFractionDigits: 0 })} ${currency}`;
}

const num = (v) => {
  const s = String(v ?? '').replace(/[$\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : NaN;
};

/**
 * Lee lotes pegados desde Excel (tabulador) o CSV con ; o ,
 * Columnas: clave, manzana, lote, m², frente, fondo, precio
 */
export function parseLots(text) {
  const rows = [];
  const errors = [];
  const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const sep = line.includes('\t') ? '\t' : line.includes(';') ? ';' : ',';
    const [code, block = '', number = '', area, front, depth, price] = line.split(sep).map((c) => c.trim());
    if (i === 0 && /clave|code/i.test(code)) return; // encabezado
    const parsed = { code: code?.slice(0, 40), block: block.slice(0, 20), number: number.slice(0, 20), area_m2: num(area), front_m: num(front), depth_m: num(depth), price: num(price) };
    if (!parsed.code) return errors.push(`Renglón ${i + 1}: falta la clave del lote.`);
    const bad = ['area_m2', 'front_m', 'depth_m', 'price'].filter((k) => Number.isNaN(parsed[k]));
    if (bad.length) return errors.push(`Renglón ${i + 1} (${parsed.code}): valor no numérico en ${bad.join(', ')}.`);
    rows.push(parsed);
  });
  if (rows.length > 2000) errors.push('Máximo 2,000 lotes por importación.');
  return { rows, errors };
}

export async function importLots(developmentId, rows, currency, req) {
  return tx(async (db) => {
    let created = 0;
    let updated = 0;
    for (const r of rows) {
      // Actualiza medidas y precio, pero nunca cambia el estatus ni el cliente de un lote existente.
      const { rows: [res] } = await db.query(
        `INSERT INTO lots (development_id, code, block, number, area_m2, front_m, depth_m, price, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (development_id, code) DO UPDATE SET block = EXCLUDED.block, number = EXCLUDED.number,
           area_m2 = EXCLUDED.area_m2, front_m = EXCLUDED.front_m, depth_m = EXCLUDED.depth_m,
           price = EXCLUDED.price, currency = EXCLUDED.currency, updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [developmentId, r.code, r.block, r.number, r.area_m2, r.front_m, r.depth_m, r.price, currency],
      );
      if (res.inserted) created++; else updated++;
    }
    await db.query(
      `UPDATE developments SET total_lots = (SELECT count(*) FROM lots WHERE development_id = $1), updated_at = now() WHERE id = $1`,
      [developmentId],
    );
    await audit({ db, req, action: 'lots.import', entity: 'development', entityId: developmentId, details: { created, updated } });
    return { created, updated };
  });
}

export function inventorySummary() {
  return many(
    `SELECT d.id, d.name, d.number, d.zone, d.status, d.slug, d.currency, d.manager_id, m.name AS manager_name,
            count(l.id)::int AS total,
            count(l.id) FILTER (WHERE l.status = 'disponible')::int AS disponible,
            count(l.id) FILTER (WHERE l.status = 'apartado')::int AS apartado,
            count(l.id) FILTER (WHERE l.status = 'vendido')::int AS vendido,
            count(l.id) FILTER (WHERE l.status = 'bloqueado')::int AS bloqueado,
            sum(l.price) FILTER (WHERE l.status = 'disponible') AS available_value,
            sum(l.price) FILTER (WHERE l.status = 'vendido') AS sold_value,
            (SELECT count(*)::int FROM project_tasks t WHERE t.development_id = d.id AND t.status <> 'completada') AS open_tasks,
            (SELECT count(*)::int FROM project_tasks t WHERE t.development_id = d.id AND t.status <> 'completada' AND t.due_date < current_date) AS late_tasks
       FROM developments d
       LEFT JOIN lots l ON l.development_id = d.id
       LEFT JOIN users m ON m.id = d.manager_id
      GROUP BY d.id, m.name ORDER BY d.sort_order, d.number`,
  );
}

export function lotsFor(developmentId, f = {}) {
  const params = [developmentId];
  const where = ['l.development_id = $1'];
  if (f.status && LOT_STATUS[f.status]) { params.push(f.status); where.push(`l.status = $${params.length}`); }
  if (f.block) { params.push(f.block); where.push(`l.block = $${params.length}`); }
  return many(
    `SELECT l.*, le.name AS lead_name, le.assigned_to AS lead_owner, u.name AS reserved_by_name
       FROM lots l LEFT JOIN leads le ON le.id = l.lead_id LEFT JOIN users u ON u.id = l.reserved_by
      WHERE ${where.join(' AND ')}
      ORDER BY l.block, length(l.number), l.number, l.code`,
    params,
  );
}

export function publicAvailability(developmentId) {
  return many(
    `SELECT code, block, number, area_m2, front_m, depth_m, price, currency FROM lots
      WHERE development_id = $1 AND status = 'disponible'
      ORDER BY block, length(number), number, code`,
    [developmentId],
  );
}

export function availableCounts() {
  return many(`SELECT development_id, count(*)::int AS n FROM lots WHERE status = 'disponible' GROUP BY development_id`);
}

export function lotsForLead(leadId) {
  return many(
    `SELECT l.*, d.name AS development_name FROM lots l JOIN developments d ON d.id = l.development_id
      WHERE l.lead_id = $1 ORDER BY l.updated_at DESC`,
    [leadId],
  );
}

export function lotEvents(lotId) {
  return many(
    `SELECT e.*, u.name AS user_name, le.name AS lead_name FROM lot_events e
       LEFT JOIN users u ON u.id = e.user_id LEFT JOIN leads le ON le.id = e.lead_id
      WHERE e.lot_id = $1 ORDER BY e.created_at, e.id`,
    [lotId],
  );
}

export const getLot = (id) => one(
  `SELECT l.*, d.name AS development_name, le.name AS lead_name, u.name AS reserved_by_name
     FROM lots l JOIN developments d ON d.id = l.development_id
     LEFT JOIN leads le ON le.id = l.lead_id LEFT JOIN users u ON u.id = l.reserved_by
    WHERE l.id = $1`, [Number(id) || 0]);

class InventoryError extends Error {}

/**
 * Cambia el estatus de un lote validando permisos y transiciones dentro de una transacción
 * con bloqueo de fila, de modo que dos asesores no puedan apartar el mismo lote.
 */
export async function changeLotStatus(user, lotId, { status, leadId, note = '', reservedUntil = null }, req) {
  if (!LOT_STATUS[status]) return { error: 'Estatus no válido.' };
  try {
    const result = await tx(async (db) => {
      const lot = (await db.query('SELECT * FROM lots WHERE id = $1 FOR UPDATE', [Number(lotId) || 0])).rows[0];
      if (!lot) throw new InventoryError('not_found');
      const from = lot.status;
      if (from === status) throw new InventoryError(`El lote ya está ${LOT_STATUS[status].toLowerCase()}.`);

      let lead = null;
      let targetLead = null;
      if (status === 'apartado' || status === 'vendido') {
        targetLead = Number(leadId) || (status === 'vendido' ? lot.lead_id : null);
        if (!targetLead) throw new InventoryError('Selecciona el prospecto o cliente.');
        // getLead aplica el alcance por rol: un asesor solo puede usar sus propios prospectos.
        lead = await getLead(user, targetLead);
        if (!lead) throw new InventoryError('Prospecto no encontrado o fuera de tu cartera.');
      }

      if (status === 'apartado') {
        if (!can(user, 'inventory.reserve')) throw new InventoryError('forbidden');
        if (from !== 'disponible') throw new InventoryError('Solo se pueden apartar lotes disponibles.');
      } else if (status === 'vendido') {
        if (!can(user, 'inventory.sell')) throw new InventoryError('forbidden');
        if (!['disponible', 'apartado'].includes(from)) throw new InventoryError('Solo se venden lotes disponibles o apartados.');
        if (from === 'apartado' && lot.lead_id !== lead.id && !note.trim()) {
          throw new InventoryError('El lote está apartado para otro cliente: indica el motivo del cambio.');
        }
      } else if (status === 'disponible') {
        if (from === 'vendido') {
          if (!can(user, 'inventory.manage')) throw new InventoryError('forbidden');
          if (!note.trim()) throw new InventoryError('Indica el motivo de la cancelación de la venta.');
        } else if (from === 'apartado') {
          const own = lot.reserved_by === user.id;
          if (!can(user, 'inventory.sell') && !own) throw new InventoryError('forbidden');
        } else if (!can(user, 'inventory.manage')) {
          throw new InventoryError('forbidden');
        }
      } else if (status === 'bloqueado') {
        if (!can(user, 'inventory.manage')) throw new InventoryError('forbidden');
        if (from !== 'disponible') throw new InventoryError('Solo se bloquean lotes disponibles.');
      }

      const keepsLead = status === 'apartado' || status === 'vendido';
      await db.query(
        `UPDATE lots SET status = $2, lead_id = $3, reserved_by = $4, reserved_until = $5, updated_at = now() WHERE id = $1`,
        [lot.id, status, keepsLead ? lead.id : null,
          status === 'apartado' ? user.id : status === 'vendido' ? lot.reserved_by ?? user.id : null,
          status === 'apartado' ? reservedUntil : null],
      );
      await db.query(
        'INSERT INTO lot_events (lot_id, from_status, to_status, lead_id, user_id, note) VALUES ($1, $2, $3, $4, $5, $6)',
        [lot.id, from, status, keepsLead ? lead.id : lot.lead_id, user.id, note.slice(0, 500)],
      );

      const affectedLead = keepsLead ? lead.id : lot.lead_id;
      if (affectedLead) {
        const verb = { apartado: 'Apartó', vendido: 'Vendió', disponible: 'Liberó', bloqueado: 'Bloqueó' }[status];
        await db.query(`INSERT INTO lead_activities (lead_id, user_id, type, body) VALUES ($1, $2, 'sistema', $3)`,
          [affectedLead, user.id, `${verb} el lote ${lot.code}.${note ? ` ${note}` : ''}`]);
      }
      // Una venta mueve al prospecto a la etapa "Venta" si estaba antes en el embudo.
      if (status === 'vendido' && STAGE_ORDER.indexOf(lead.stage) < STAGE_ORDER.indexOf('venta')) {
        await db.query(`UPDATE leads SET stage = 'venta', updated_at = now() WHERE id = $1`, [lead.id]);
        await db.query(`INSERT INTO lead_activities (lead_id, user_id, type, body) VALUES ($1, $2, 'etapa', $3)`,
          [lead.id, user.id, `${STAGES[lead.stage]} → ${STAGES.venta}`]);
      }
      await audit({ db, req, action: `lot.${status}`, entity: 'lot', entityId: lot.id,
        details: { code: lot.code, development_id: lot.development_id, from, to: status, lead_id: keepsLead ? lead.id : lot.lead_id, note } });
      return { lot, from, leadOwner: lead?.assigned_to ?? null };
    });
    const payload = { id: result.lot.id, code: result.lot.code, development_id: result.lot.development_id, status };
    notifyRoles(['admin', 'gerencia', 'asesor'], 'lot:changed', payload);
    if (result.leadOwner && result.leadOwner !== user.id) notifyUser(result.leadOwner, 'lot:changed', payload);
    return { ok: true };
  } catch (err) {
    if (err instanceof InventoryError) return { error: err.message };
    if (err.code === '23514') return { error: 'Cambio de estatus no permitido.' };
    throw err;
  }
}

// Libera apartados cuya fecha límite ya pasó. Lo ejecuta el servidor cada hora.
export async function releaseExpiredReservations() {
  const released = await tx(async (db) => {
    const { rows } = await db.query(
      `SELECT * FROM lots WHERE status = 'apartado' AND reserved_until < (now() AT TIME ZONE 'America/Tijuana')::date FOR UPDATE`,
    );
    for (const lot of rows) {
      await db.query(
        `UPDATE lots SET status = 'disponible', lead_id = NULL, reserved_by = NULL, reserved_until = NULL, updated_at = now() WHERE id = $1`,
        [lot.id],
      );
      await db.query(
        `INSERT INTO lot_events (lot_id, from_status, to_status, lead_id, note) VALUES ($1, 'apartado', 'disponible', $2, 'Apartado vencido: liberado automáticamente')`,
        [lot.id, lot.lead_id],
      );
      await db.query(`INSERT INTO lead_activities (lead_id, type, body) VALUES ($1, 'sistema', $2)`,
        [lot.lead_id, `El apartado del lote ${lot.code} venció y el lote volvió a estar disponible.`]);
      await audit({ db, userId: null, action: 'lot.expired', entity: 'lot', entityId: lot.id, details: { code: lot.code, lead_id: lot.lead_id } });
    }
    return rows;
  });
  for (const lot of released) {
    notifyRoles(['admin', 'gerencia', 'asesor'], 'lot:changed', { id: lot.id, code: lot.code, development_id: lot.development_id, status: 'disponible' });
    if (lot.reserved_by) notifyUser(lot.reserved_by, 'lot:expired', { id: lot.id, code: lot.code });
  }
  return released;
}
