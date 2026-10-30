// Fase 6 · Ventas, planes de pago, abonos y cartera.
// Los importes se calculan en centavos (enteros) para evitar errores de redondeo.
import { many, one, tx } from '../db.js';
import { can } from '../security/rbac.js';
import { audit } from './audit.js';
import { STAGES } from './leads.js';
import { notifyRoles } from './realtime.js';

export const PAYMENT_METHODS = { transferencia: 'Transferencia', deposito: 'Depósito', efectivo: 'Efectivo', tarjeta: 'Tarjeta', cheque: 'Cheque', otro: 'Otro' };
export const PAYMENT_CONCEPTS = { mensualidad: 'Mensualidad', enganche: 'Enganche', anticipo: 'Anticipo', abono: 'Abono a capital', liquidacion: 'Liquidación' };
export const SALE_STATUS = { activa: 'Vigente', liquidada: 'Liquidada', cancelada: 'Cancelada' };

// Moroso: dos o más parcialidades vencidas o más de 30 días de atraso.
export const DELINQUENT_SQL = '(overdue_count >= 2 OR max_days_late > 30)';

const toCents = (v) => Math.round(Number(v) * 100);
const fromCents = (c) => (c / 100).toFixed(2);
export const todayTijuana = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tijuana' }).format(new Date());

// Suma meses conservando el día; si el mes es más corto se usa su último día (31 ene → 28/29 feb).
export function addMonths(isoDate, months) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

/**
 * Calcula el calendario: enganche (número 0) + n mensualidades.
 * Sin interés: partes iguales y la última absorbe los centavos.
 * Con interés anual: amortización francesa (pago fijo) y la última liquida el saldo exacto.
 */
export function buildSchedule({ agreedPrice, downPayment = 0, installments, annualRate = 0, firstDueDate, downPaymentDate }) {
  const total = toCents(agreedPrice);
  const down = toCents(downPayment);
  const n = Number(installments);
  const rows = [];
  if (down > 0) rows.push({ number: 0, due_date: downPaymentDate, amount: down, principal: down, interest: 0 });
  let balance = total - down;
  if (balance > 0) {
    const r = Number(annualRate) / 100 / 12;
    const fixed = r > 0 ? Math.round((balance * r) / (1 - (1 + r) ** -n)) : Math.floor(balance / n);
    for (let k = 1; k <= n; k++) {
      const interest = Math.round(balance * r);
      let principal = r > 0 ? fixed - interest : fixed;
      if (k === n) principal = balance;
      balance -= principal;
      rows.push({ number: k, due_date: addMonths(firstDueDate, k - 1), amount: principal + interest, principal, interest });
    }
  }
  return rows.map((x) => ({ ...x, amount: fromCents(x.amount), principal: fromCents(x.principal), interest: fromCents(x.interest) }));
}

export function validatePlan(p) {
  const errors = [];
  const agreed = Number(p.agreedPrice);
  const down = Number(p.downPayment || 0);
  const n = Number(p.installments);
  const rate = Number(p.annualRate || 0);
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!(agreed > 0) || agreed > 1e10) errors.push('El precio pactado debe ser mayor a cero.');
  if (!(down >= 0) || down > agreed) errors.push('El enganche no puede ser mayor al precio pactado.');
  if (!Number.isInteger(n) || n < 0 || n > 360) errors.push('Número de mensualidades entre 0 y 360.');
  if (agreed - down > 0 && n < 1) errors.push('Indica el número de mensualidades para el saldo financiado.');
  if (agreed - down === 0 && n > 0) errors.push('Si el enganche cubre el precio, no hay mensualidades.');
  if (!(rate >= 0 && rate <= 60)) errors.push('Tasa anual entre 0 y 60 %.');
  if (!iso.test(p.saleDate ?? '')) errors.push('Fecha de venta no válida.');
  if (down > 0 && !iso.test(p.downPaymentDate ?? '')) errors.push('Fecha del enganche no válida.');
  if (n > 0 && !iso.test(p.firstDueDate ?? '')) errors.push('Fecha de la primera mensualidad no válida.');
  return errors;
}

// ---------- Alcance por rol ----------
function scope(user, params, alias = 's') {
  if (can(user, 'finance.view_all')) return 'TRUE';
  if (can(user, 'finance.view_own')) {
    params.push(user.id);
    return `EXISTS (SELECT 1 FROM leads l2 WHERE l2.id = ${alias}.lead_id AND l2.assigned_to = $${params.length})`;
  }
  return 'FALSE';
}

const SALE_SELECT = `SELECT s.*, le.name AS client_name, le.phone AS client_phone, le.email AS client_email, le.assigned_to AS lead_owner,
       lo.code AS lot_code, lo.area_m2, d.name AS development_name, a.name AS advisor_name
  FROM v_sales s
  JOIN leads le ON le.id = s.lead_id
  JOIN lots lo ON lo.id = s.lot_id
  JOIN developments d ON d.id = s.development_id
  LEFT JOIN users a ON a.id = s.advisor_id`;

export async function listSales(user, f = {}) {
  const params = [];
  const where = [scope(user, params)];
  if (f.status && SALE_STATUS[f.status]) { params.push(f.status); where.push(`s.status = $${params.length}`); }
  if (f.development) { params.push(Number(f.development) || 0); where.push(`s.development_id = $${params.length}`); }
  if (f.cartera === 'vencida') where.push(`s.status = 'activa' AND s.overdue_amount > 0`);
  if (f.cartera === 'morosos') where.push(`s.status = 'activa' AND ${DELINQUENT_SQL.replace(/(overdue_count|max_days_late)/g, 's.$1')}`);
  if (f.q) { params.push(`%${String(f.q).replace(/[\\%_]/g, '\\$&')}%`); where.push(`(le.name ILIKE $${params.length} OR lo.code ILIKE $${params.length})`); }
  return many(`${SALE_SELECT} WHERE ${where.join(' AND ')} ORDER BY s.status = 'cancelada', s.max_days_late DESC, s.sale_date DESC LIMIT 500`, params);
}

export async function getSale(user, id) {
  const params = [Number(id) || 0];
  return one(`${SALE_SELECT} WHERE s.id = $1 AND ${scope(user, params)}`, params);
}

export const scheduleFor = (saleId) => many('SELECT * FROM v_installments WHERE sale_id = $1 ORDER BY number', [saleId]);
export const paymentsFor = (saleId) => many(
  `SELECT p.*, r.name AS received_by_name, v.name AS voided_by_name FROM payments p
     LEFT JOIN users r ON r.id = p.received_by LEFT JOIN users v ON v.id = p.voided_by
    WHERE p.sale_id = $1 ORDER BY p.paid_at, p.id`, [saleId]);

// Una promesa se cumple si, desde que se registró hasta la fecha prometida, se pagó al menos el monto.
export const promisesFor = (saleId) => many(
  `SELECT pr.*, u.name AS created_by_name,
          (SELECT COALESCE(sum(p.amount), 0) FROM payments p WHERE p.sale_id = pr.sale_id AND p.status = 'confirmado'
              AND p.paid_at BETWEEN (pr.created_at AT TIME ZONE 'America/Tijuana')::date AND pr.promised_date) AS paid_in_window,
          CASE WHEN (SELECT COALESCE(sum(p.amount), 0) FROM payments p WHERE p.sale_id = pr.sale_id AND p.status = 'confirmado'
                       AND p.paid_at BETWEEN (pr.created_at AT TIME ZONE 'America/Tijuana')::date AND pr.promised_date) >= pr.amount THEN 'cumplida'
               WHEN pr.promised_date < (now() AT TIME ZONE 'America/Tijuana')::date THEN 'incumplida'
               ELSE 'pendiente' END AS status
     FROM payment_promises pr LEFT JOIN users u ON u.id = pr.created_by
    WHERE pr.sale_id = $1 ORDER BY pr.promised_date DESC, pr.id DESC`, [saleId]);

export const salesForLead = (leadId) => many(`${SALE_SELECT} WHERE s.lead_id = $1 ORDER BY s.created_at DESC`, [leadId]);

/** Lotes apartados o vendidos (con cliente) que aún no tienen una venta vigente registrada. */
export const lotsPendingSale = () => many(
  `SELECT lo.id, lo.code, lo.status, lo.price, lo.currency, lo.lead_id, le.name AS client_name, d.name AS development_name
     FROM lots lo JOIN leads le ON le.id = lo.lead_id JOIN developments d ON d.id = lo.development_id
    WHERE lo.status IN ('apartado', 'vendido')
      AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.lot_id = lo.id AND s.status <> 'cancelada')
    ORDER BY d.sort_order, lo.code`);

class FinanceError extends Error {}

export async function createSale(user, input, req) {
  if (!can(user, 'finance.manage')) return { error: 'forbidden' };
  const errors = validatePlan(input);
  if (errors.length) return { error: errors.join(' ') };
  const schedule = buildSchedule({ ...input, downPaymentDate: input.downPaymentDate || input.saleDate });
  try {
    const saleId = await tx(async (db) => {
      const lot = (await db.query('SELECT * FROM lots WHERE id = $1 FOR UPDATE', [Number(input.lotId) || 0])).rows[0];
      if (!lot || !['apartado', 'vendido'].includes(lot.status) || !lot.lead_id) {
        throw new FinanceError('El lote debe estar apartado o vendido a un cliente.');
      }
      const lead = (await db.query('SELECT id, stage, assigned_to FROM leads WHERE id = $1 FOR UPDATE', [lot.lead_id])).rows[0];
      const { rows: [sale] } = await db.query(
        `INSERT INTO sales (lot_id, lead_id, development_id, advisor_id, sale_date, currency, list_price, agreed_price, down_payment,
                            installments_count, annual_rate, first_due_date, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
        [lot.id, lead.id, lot.development_id, lead.assigned_to, input.saleDate, lot.currency, lot.price,
          input.agreedPrice, input.downPayment || 0, Number(input.installments), input.annualRate || 0,
          Number(input.installments) > 0 ? input.firstDueDate : null, String(input.notes ?? '').slice(0, 2000), user.id],
      );
      let before = 0; // acumulado en centavos de las parcialidades anteriores
      for (const row of schedule) {
        await db.query('INSERT INTO installments (sale_id, number, due_date, amount, principal, interest, before_amount) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [sale.id, row.number, row.due_date, row.amount, row.principal, row.interest, (before / 100).toFixed(2)]);
        before += Math.round(Number(row.amount) * 100);
      }
      // Formalizar la venta marca el lote como vendido.
      if (lot.status === 'apartado') {
        await db.query(`UPDATE lots SET status = 'vendido', reserved_until = NULL, updated_at = now() WHERE id = $1`, [lot.id]);
        await db.query(`INSERT INTO lot_events (lot_id, from_status, to_status, lead_id, user_id, note) VALUES ($1, 'apartado', 'vendido', $2, $3, $4)`,
          [lot.id, lead.id, user.id, `Venta #${sale.id} registrada en finanzas`]);
      }
      if (Object.keys(STAGES).indexOf(lead.stage) < Object.keys(STAGES).indexOf('venta')) {
        await db.query(`UPDATE leads SET stage = 'venta', updated_at = now() WHERE id = $1`, [lead.id]);
        await db.query(`INSERT INTO lead_activities (lead_id, user_id, type, body) VALUES ($1, $2, 'etapa', $3)`, [lead.id, user.id, `${STAGES[lead.stage]} → ${STAGES.venta}`]);
      }
      await db.query(`INSERT INTO lead_activities (lead_id, user_id, type, body) VALUES ($1, $2, 'sistema', $3)`,
        [lead.id, user.id, `Venta #${sale.id} registrada: lote ${lot.code}, ${input.installments} mensualidades.`]);
      await audit({ db, req, action: 'sale.create', entity: 'sale', entityId: sale.id,
        details: { lot: lot.code, agreed_price: input.agreedPrice, down_payment: input.downPayment, installments: input.installments, annual_rate: input.annualRate } });
      return sale.id;
    });
    return { id: saleId };
  } catch (err) {
    if (err instanceof FinanceError) return { error: err.message };
    if (err.code === '23505') return { error: 'Ese lote ya tiene una venta vigente.' };
    throw err;
  }
}

async function refreshStatus(db, saleId) {
  // Liquidada cuando el saldo llega a cero; vuelve a vigente si una anulación reabre el saldo.
  await db.query(
    `UPDATE sales s SET status = CASE WHEN v.balance <= 0 THEN 'liquidada' ELSE 'activa' END
       FROM v_sales v WHERE v.id = s.id AND s.id = $1 AND s.status <> 'cancelada'`, [saleId]);
}

export async function registerPayment(user, saleId, input, req) {
  if (!can(user, 'finance.manage')) return { error: 'forbidden' };
  const amount = Number(String(input.amount ?? '').replace(/[$,\s]/g, ''));
  if (!(amount > 0) || amount > 1e10) return { error: 'Monto no válido.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidAt ?? '') || input.paidAt > todayTijuana()) return { error: 'Fecha de pago no válida (no puede ser futura).' };
  if (!PAYMENT_METHODS[input.method]) return { error: 'Forma de pago no válida.' };
  const concept = PAYMENT_CONCEPTS[input.concept] ? input.concept : 'mensualidad';
  try {
    const id = await tx(async (db) => {
      // Se bloquea la venta antes de leer su saldo para serializar pagos simultáneos.
      const locked = (await db.query('SELECT id FROM sales WHERE id = $1 FOR UPDATE', [Number(saleId) || 0])).rows[0];
      if (!locked) throw new FinanceError('not_found');
      const sale = (await db.query('SELECT * FROM v_sales WHERE id = $1', [locked.id])).rows[0];
      if (sale.status === 'cancelada') throw new FinanceError('La venta está cancelada.');
      const { rows: [p] } = await db.query(
        `INSERT INTO payments (sale_id, amount, paid_at, method, concept, reference, received_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [sale.id, amount.toFixed(2), input.paidAt, input.method, concept, String(input.reference ?? '').trim().slice(0, 120), user.id],
      );
      await refreshStatus(db, sale.id);
      await db.query(`INSERT INTO lead_activities (lead_id, user_id, type, body) VALUES ($1, $2, 'sistema', $3)`,
        [sale.lead_id, user.id, `Pago recibido (${PAYMENT_CONCEPTS[concept]}): ${amount.toFixed(2)} ${sale.currency}, folio ${p.id}.`]);
      await audit({ db, req, action: 'payment.create', entity: 'sale', entityId: sale.id, details: { payment: p.id, amount, paid_at: input.paidAt, method: input.method } });
      return p.id;
    });
    notifyRoles(['admin', 'gerencia', 'finanzas'], 'finance:changed', { saleId: Number(saleId) });
    return { id };
  } catch (err) {
    if (err instanceof FinanceError) return { error: err.message };
    throw err;
  }
}

export async function voidPayment(user, paymentId, reason, req) {
  if (!can(user, 'finance.void')) return { error: 'forbidden' };
  if (!String(reason ?? '').trim()) return { error: 'Indica el motivo de la anulación.' };
  const p = await tx(async (db) => {
    const row = (await db.query(`SELECT * FROM payments WHERE id = $1 FOR UPDATE`, [Number(paymentId) || 0])).rows[0];
    if (!row) return null;
    if (row.status === 'anulado') return { already: true, ...row };
    await db.query(`UPDATE payments SET status = 'anulado', voided_at = now(), voided_by = $2, void_reason = $3 WHERE id = $1`,
      [row.id, user.id, String(reason).trim().slice(0, 300)]);
    await refreshStatus(db, row.sale_id);
    await audit({ db, req, action: 'payment.void', entity: 'sale', entityId: row.sale_id, details: { payment: row.id, amount: row.amount, reason } });
    return row;
  });
  if (!p) return { error: 'not_found' };
  if (p.already) return { error: 'El pago ya estaba anulado.' };
  notifyRoles(['admin', 'gerencia', 'finanzas'], 'finance:changed', { saleId: p.sale_id });
  return { saleId: p.sale_id };
}

export async function addPromise(user, saleId, input, req) {
  if (!can(user, 'finance.manage')) return { error: 'forbidden' };
  const amount = Number(String(input.amount ?? '').replace(/[$,\s]/g, ''));
  if (!(amount > 0)) return { error: 'Monto no válido.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date ?? '') || input.date < todayTijuana()) return { error: 'La fecha prometida debe ser hoy o posterior.' };
  const sale = await one('SELECT id FROM sales WHERE id = $1', [Number(saleId) || 0]);
  if (!sale) return { error: 'not_found' };
  const pr = await one(`INSERT INTO payment_promises (sale_id, promised_date, amount, note, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [sale.id, input.date, amount.toFixed(2), String(input.note ?? '').slice(0, 300), user.id]);
  await audit({ req, action: 'promise.create', entity: 'sale', entityId: sale.id, details: { promise: pr.id, amount, date: input.date } });
  return { id: pr.id };
}

export async function cancelSale(user, saleId, reason, req) {
  if (!can(user, 'finance.cancel_sale')) return { error: 'forbidden' };
  if (!String(reason ?? '').trim()) return { error: 'Indica el motivo de la cancelación.' };
  return tx(async (db) => {
    const sale = (await db.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [Number(saleId) || 0])).rows[0];
    if (!sale) return { error: 'not_found' };
    if (sale.status === 'cancelada') return { error: 'La venta ya está cancelada.' };
    await db.query(`UPDATE sales SET status = 'cancelada', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3 WHERE id = $1`,
      [sale.id, user.id, String(reason).trim().slice(0, 300)]);
    const lot = (await db.query('SELECT * FROM lots WHERE id = $1 FOR UPDATE', [sale.lot_id])).rows[0];
    if (lot.status === 'vendido' && lot.lead_id === sale.lead_id) {
      await db.query(`UPDATE lots SET status = 'disponible', lead_id = NULL, reserved_by = NULL, reserved_until = NULL, updated_at = now() WHERE id = $1`, [lot.id]);
      await db.query(`INSERT INTO lot_events (lot_id, from_status, to_status, lead_id, user_id, note) VALUES ($1, 'vendido', 'disponible', $2, $3, $4)`,
        [lot.id, sale.lead_id, user.id, `Venta #${sale.id} cancelada: ${reason}`]);
    }
    await db.query(`INSERT INTO lead_activities (lead_id, user_id, type, body) VALUES ($1, $2, 'sistema', $3)`,
      [sale.lead_id, user.id, `Venta #${sale.id} cancelada. Motivo: ${reason}`]);
    await audit({ db, req, action: 'sale.cancel', entity: 'sale', entityId: sale.id, details: { reason, lot: lot.code } });
    return { ok: true };
  });
}

// ---------- Indicadores y alertas ----------
export async function financeSummary(user) {
  const params = [];
  const w = scope(user, params);
  const [byCurrency, upcoming, overdue, delinquent, brokenPromises, projection, monthly] = await Promise.all([
    many(`SELECT s.currency,
                 count(*) FILTER (WHERE s.status = 'activa')::int AS active,
                 COALESCE(sum(s.balance) FILTER (WHERE s.status = 'activa'), 0) AS receivable,
                 COALESCE(sum(s.overdue_amount) FILTER (WHERE s.status = 'activa'), 0) AS overdue,
                 count(*) FILTER (WHERE s.status = 'activa' AND ${DELINQUENT_SQL.replace(/(overdue_count|max_days_late)/g, 's.$1')})::int AS delinquent
            FROM v_sales s WHERE ${w} GROUP BY s.currency ORDER BY s.currency`, params),
    many(`SELECT v.*, s.currency, s.lead_id, le.name AS client_name, lo.code AS lot_code
            FROM v_installments v JOIN v_sales s ON s.id = v.sale_id JOIN leads le ON le.id = s.lead_id JOIN lots lo ON lo.id = s.lot_id
           WHERE ${w} AND s.status = 'activa' AND v.pending_amount > 0
             AND v.due_date BETWEEN (now() AT TIME ZONE 'America/Tijuana')::date AND (now() AT TIME ZONE 'America/Tijuana')::date + 7
           ORDER BY v.due_date LIMIT 50`, params),
    many(`SELECT s.*, le.name AS client_name, lo.code AS lot_code FROM v_sales s JOIN leads le ON le.id = s.lead_id JOIN lots lo ON lo.id = s.lot_id
           WHERE ${w} AND s.status = 'activa' AND s.overdue_amount > 0 ORDER BY s.max_days_late DESC LIMIT 50`, params),
    one(`SELECT count(*)::int AS n FROM v_sales s WHERE ${w} AND s.status = 'activa' AND ${DELINQUENT_SQL.replace(/(overdue_count|max_days_late)/g, 's.$1')}`, params),
    many(`SELECT pr.*, s.currency, le.name AS client_name FROM payment_promises pr JOIN sales s ON s.id = pr.sale_id JOIN leads le ON le.id = s.lead_id
           WHERE ${w} AND s.status = 'activa' AND pr.promised_date < (now() AT TIME ZONE 'America/Tijuana')::date
             AND pr.promised_date >= (now() AT TIME ZONE 'America/Tijuana')::date - 60
             AND (SELECT COALESCE(sum(p.amount), 0) FROM payments p WHERE p.sale_id = pr.sale_id AND p.status = 'confirmado'
                   AND p.paid_at BETWEEN (pr.created_at AT TIME ZONE 'America/Tijuana')::date AND pr.promised_date) < pr.amount
           ORDER BY pr.promised_date DESC LIMIT 50`, params),
    many(`SELECT s.currency,
                 COALESCE(sum(v.pending_amount) FILTER (WHERE v.due_date <= (now() AT TIME ZONE 'America/Tijuana')::date + 30), 0) AS d30,
                 COALESCE(sum(v.pending_amount) FILTER (WHERE v.due_date <= (now() AT TIME ZONE 'America/Tijuana')::date + 60), 0) AS d60,
                 COALESCE(sum(v.pending_amount) FILTER (WHERE v.due_date <= (now() AT TIME ZONE 'America/Tijuana')::date + 90), 0) AS d90
            FROM v_installments v JOIN sales s ON s.id = v.sale_id
           WHERE ${w} AND s.status = 'activa' AND v.pending_amount > 0 GROUP BY s.currency ORDER BY s.currency`, params),
    many(`SELECT to_char(date_trunc('month', p.paid_at), 'YYYY-MM') AS month, s.currency, sum(p.amount) AS total, count(*)::int AS n
            FROM payments p JOIN sales s ON s.id = p.sale_id
           WHERE ${w} AND p.status = 'confirmado' AND p.paid_at >= date_trunc('month', (now() AT TIME ZONE 'America/Tijuana')::date) - interval '11 months'
           GROUP BY 1, 2 ORDER BY 1, 2`, params),
  ]);
  const thisMonth = todayTijuana().slice(0, 7);
  for (const c of byCurrency) c.collected_month = monthly.find((m) => m.month === thisMonth && m.currency === c.currency)?.total ?? 0;
  return { byCurrency, upcoming, overdue, delinquent: delinquent.n, brokenPromises, projection, monthly };
}

// Antigüedad de saldos vencidos por cliente (para reporte).
export function agingReport(user) {
  const params = [];
  const w = scope(user, params);
  return many(
    `SELECT s.id, s.currency, le.name AS client_name, lo.code AS lot_code, d.name AS development_name, s.balance,
            COALESCE(sum(v.pending_amount) FILTER (WHERE v.days_late BETWEEN 1 AND 30), 0) AS b1_30,
            COALESCE(sum(v.pending_amount) FILTER (WHERE v.days_late BETWEEN 31 AND 60), 0) AS b31_60,
            COALESCE(sum(v.pending_amount) FILTER (WHERE v.days_late BETWEEN 61 AND 90), 0) AS b61_90,
            COALESCE(sum(v.pending_amount) FILTER (WHERE v.days_late > 90), 0) AS b90
       FROM v_sales s JOIN leads le ON le.id = s.lead_id JOIN lots lo ON lo.id = s.lot_id JOIN developments d ON d.id = s.development_id
       LEFT JOIN v_installments v ON v.sale_id = s.id AND v.pending_amount > 0 AND v.days_late > 0
      WHERE ${w} AND s.status = 'activa'
      GROUP BY s.id, s.currency, le.name, lo.code, d.name, s.balance
      ORDER BY (COALESCE(sum(v.pending_amount), 0)) DESC`, params);
}

export function incomeReport(user, from, to) {
  const params = [from, to];
  const w = scope(user, params);
  return many(
    `SELECT p.id AS folio, p.paid_at, p.amount, s.currency, p.method, p.concept, p.reference, le.name AS client_name,
            lo.code AS lot_code, d.name AS development_name, r.name AS received_by_name
       FROM payments p JOIN sales s ON s.id = p.sale_id JOIN leads le ON le.id = s.lead_id JOIN lots lo ON lo.id = s.lot_id
       JOIN developments d ON d.id = s.development_id LEFT JOIN users r ON r.id = p.received_by
      WHERE ${w} AND p.status = 'confirmado' AND p.paid_at BETWEEN $1 AND $2
      ORDER BY p.paid_at, p.id`, params);
}
