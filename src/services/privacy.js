// Fase 9 · Protección de datos personales (LFPDPPP): derechos ARCO y retención.
import { config } from '../config.js';
import { many, one, query, tx } from '../db.js';
import { can } from '../security/rbac.js';
import { audit } from './audit.js';
import { getLead } from './leads.js';

/** Derecho de acceso: todos los datos personales que la empresa tiene de un prospecto o cliente. */
export async function exportLeadData(user, leadId, req) {
  if (!can(user, 'privacy.manage')) return { error: 'forbidden' };
  const lead = await getLead(user, leadId);
  if (!lead) return { error: 'not_found' };
  const [activities, whatsapp, lots, sales, payments] = await Promise.all([
    many('SELECT type, body, created_at FROM lead_activities WHERE lead_id = $1 ORDER BY id', [lead.id]),
    many('SELECT direction, body, created_at FROM wa_messages WHERE lead_id = $1 ORDER BY id', [lead.id]),
    many('SELECT l.code, d.name AS development, l.status FROM lots l JOIN developments d ON d.id = l.development_id WHERE l.lead_id = $1', [lead.id]),
    many('SELECT id, sale_date, currency, agreed_price, down_payment, installments_count, status FROM sales WHERE lead_id = $1', [lead.id]),
    many(`SELECT p.paid_at, p.amount, s.currency, p.method, p.status FROM payments p JOIN sales s ON s.id = p.sale_id WHERE s.lead_id = $1 ORDER BY p.paid_at`, [lead.id]),
  ]);
  await audit({ req, action: 'privacy.export', entity: 'lead', entityId: lead.id });
  return {
    generado: new Date().toISOString(),
    titular: { nombre: lead.name, telefono: lead.phone, correo: lead.email, presupuesto: lead.budget, fuente: lead.source,
      desarrollo_de_interes: lead.development_name, etapa: lead.stage, alta: lead.created_at, consentimiento_aviso_privacidad: lead.privacy_consent_at },
    actividades: activities, mensajes_whatsapp: whatsapp, lotes: lots, ventas: sales, pagos: payments,
  };
}

/**
 * Derecho de cancelación: elimina los datos personales y conserva solo registros sin identificar.
 * Si existen ventas o lotes ligados, la información debe conservarse por obligaciones fiscales y
 * contractuales; en ese caso solo se bloquea su uso comercial.
 */
export async function anonymizeLead(user, leadId, reason, req) {
  if (!can(user, 'privacy.manage')) return { error: 'forbidden' };
  if (!String(reason ?? '').trim()) return { error: 'Indica el folio o motivo de la solicitud.' };
  const lead = await getLead(user, leadId);
  if (!lead) return { error: 'not_found' };
  const ties = await one(`SELECT (SELECT count(*)::int FROM sales WHERE lead_id = $1) AS sales,
                                 (SELECT count(*)::int FROM lots WHERE lead_id = $1) AS lots`, [lead.id]);
  if (ties.sales || ties.lots) {
    await tx(async (db) => {
      await db.query(`UPDATE leads SET tags = array(SELECT DISTINCT unnest(tags || ARRAY['no-contactar'])), bot_paused_at = COALESCE(bot_paused_at, now()),
                             bot_pause_reason = 'Solicitud ARCO', next_contact_at = NULL, updated_at = now() WHERE id = $1`, [lead.id]);
      await db.query(`INSERT INTO lead_activities (lead_id, user_id, type, body) VALUES ($1, $2, 'sistema', 'Solicitud ARCO: datos bloqueados para uso comercial (se conservan por obligación legal).')`, [lead.id, user.id]);
      await audit({ db, req, action: 'privacy.block', entity: 'lead', entityId: lead.id, details: { reason } });
    });
    return { blocked: true };
  }
  await tx(async (db) => {
    await db.query(`UPDATE leads SET name = $2, phone = NULL, phone_normalized = NULL, email = NULL, budget = NULL, tags = '{}',
                           next_contact_at = NULL, stage = 'perdido', bot_paused_at = COALESCE(bot_paused_at, now()), bot_pause_reason = 'Solicitud ARCO', updated_at = now()
                     WHERE id = $1`, [lead.id, `Titular anonimizado #${lead.id}`]);
    await db.query(`UPDATE lead_activities SET body = '[eliminado por solicitud ARCO]' WHERE lead_id = $1`, [lead.id]);
    await db.query(`UPDATE wa_messages SET body = '[eliminado por solicitud ARCO]', phone = '' WHERE lead_id = $1`, [lead.id]);
    await db.query(`INSERT INTO lead_activities (lead_id, user_id, type, body) VALUES ($1, $2, 'sistema', 'Datos personales eliminados por solicitud ARCO.')`, [lead.id, user.id]);
    // La bitácora guarda el folio de la solicitud, nunca los datos eliminados.
    await audit({ db, req, action: 'privacy.anonymize', entity: 'lead', entityId: lead.id, details: { reason } });
  });
  return { anonymized: true };
}

/** Retención: borra datos operativos que ya no se necesitan. La bitácora y la información financiera no se tocan. */
export async function applyRetention() {
  const r = config.retention;
  const [s, n, a, b] = await Promise.all([
    query('DELETE FROM sessions WHERE expires_at < now()'),
    query(`DELETE FROM notifications WHERE read_at < now() - $1 * interval '1 day'`, [r.readNotificationsDays]),
    query(`DELETE FROM assistant_conversations WHERE updated_at < now() - $1 * interval '1 day'`, [r.assistantDays]),
    query(`DELETE FROM bot_runs WHERE created_at < now() - $1 * interval '1 day'`, [r.botRunsDays]),
  ]);
  return { sessions: s.rowCount, notifications: n.rowCount, assistant: a.rowCount, botRuns: b.rowCount };
}
