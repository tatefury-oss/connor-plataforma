import { Router } from 'express';
import { many } from '../../db.js';
import { can, canSeeFinance, requirePermission } from '../../security/rbac.js';
import { audit } from '../../services/audit.js';
import {
  PAYMENT_CONCEPTS, PAYMENT_METHODS, SALE_STATUS, addPromise, agingReport, buildSchedule, cancelSale, createSale, financeSummary,
  getSale, incomeReport, listSales, lotsPendingSale, paymentsFor, promisesFor, registerPayment, scheduleFor, todayTijuana,
  validatePlan, voidPayment,
} from '../../services/finance.js';
import { money } from '../../services/inventory.js';
import { getSettings } from '../../services/settings.js';
import { csvResponse } from '../../views/csv.js';
import { fmtDate, fmtDateTime, html } from '../../views/html.js';
import { adminPage, csrfField } from '../../views/admin/layout.js';

const router = Router();
router.use('/admin/finanzas', (req, res, next) => (canSeeFinance(req.user) ? next() : res.status(403).send('No tienes permiso para ver finanzas.')));

const err = (res, url, msg) => res.redirect(303, `${url}?error=${encodeURIComponent(msg)}`);
const kpi = (l, v, h = '') => html`<div class="kpi"><span>${l}</span><strong>${v}</strong>${h ? html`<small>${h}</small>` : ''}</div>`;
const iStatus = (i) => {
  if (Number(i.pending_amount) <= 0) return html`<span class="lot l-disponible">Pagada</span>`;
  if (i.days_late > 0) return html`<span class="lot l-apartado">Vencida · ${i.days_late} d</span>`;
  if (Number(i.paid_amount) > 0) return html`<span class="lot l-vendido">Parcial</span>`;
  return html`<span class="lot l-bloqueado">Pendiente</span>`;
};
const saleBadge = (s) => (s.status === 'activa' && (s.overdue_count >= 2 || s.max_days_late > 30)
  ? html`<span class="tag warn">Moroso</span>`
  : s.status === 'activa' && Number(s.overdue_amount) > 0 ? html`<span class="tag warn">Vencido</span>` : html`<span class="tag">${SALE_STATUS[s.status]}</span>`);
const monthName = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('es-MX', { month: 'short', year: '2-digit', timeZone: 'UTC' });

// ---------- Tablero de cartera ----------
router.get('/admin/finanzas', async (req, res) => {
  const f = await financeSummary(req.user);
  const maxMonth = Math.max(1, ...f.monthly.map((m) => Number(m.total)));
  const body = html`
    <div class="toolbar">
      ${can(req.user, 'finance.manage') ? html`<a class="btn" href="/admin/finanzas/ventas/nueva">+ Registrar venta</a>` : ''}
      <a class="btn ghost" href="/admin/finanzas/ventas">Ventas y cartera</a>
      <a class="btn ghost" href="/admin/finanzas/reportes">Reportes</a>
    </div>
    ${f.byCurrency.length ? f.byCurrency.map((c) => html`
      <h2 class="section-title">Cartera en ${c.currency}</h2>
      <section class="kpis">
        ${kpi('Ventas vigentes', c.active)}
        ${kpi('Cuentas por cobrar', money(c.receivable, c.currency))}
        ${kpi('Cartera vencida', money(c.overdue, c.currency), Number(c.receivable) ? `${((Number(c.overdue) / Number(c.receivable)) * 100).toFixed(1)}% de la cartera` : '')}
        ${kpi('Clientes morosos', c.delinquent, '2+ pagos vencidos o más de 30 días')}
        ${kpi('Cobrado este mes', money(c.collected_month, c.currency))}
        ${(() => { const p = f.projection.find((x) => x.currency === c.currency); return p ? kpi('Por cobrar próximos 30 / 60 / 90 días', money(p.d30, c.currency), `${money(p.d60, c.currency)} · ${money(p.d90, c.currency)} (incluye vencido)`) : ''; })()}
      </section>`) : html`<section class="card"><p class="muted">Aún no hay ventas registradas.${can(req.user, 'finance.manage') ? ' Registra la primera desde un lote apartado o vendido.' : ''}</p></section>`}

    <div class="grid2">
      <section class="card"><h2>Pagos vencidos</h2>
        ${f.overdue.length ? html`<table><thead><tr><th>Cliente</th><th>Lote</th><th class="num">Vencido</th><th class="num">Atraso</th></tr></thead><tbody>
          ${f.overdue.map((s) => html`<tr><td><a href="/admin/finanzas/ventas/${s.id}">${s.client_name}</a> ${saleBadge(s)}</td><td>${s.lot_code}</td><td class="num">${money(s.overdue_amount, s.currency)}</td><td class="num">${s.max_days_late} días</td></tr>`)}
        </tbody></table>` : html`<p class="muted">Sin pagos vencidos.</p>`}
      </section>
      <section class="card"><h2>Vencen en los próximos 7 días</h2>
        ${f.upcoming.length ? html`<table><thead><tr><th>Fecha</th><th>Cliente</th><th>Parcialidad</th><th class="num">Pendiente</th></tr></thead><tbody>
          ${f.upcoming.map((i) => html`<tr><td>${fmtDate(i.due_date)}</td><td><a href="/admin/finanzas/ventas/${i.sale_id}">${i.client_name}</a></td><td>${i.number === 0 ? 'Enganche' : `#${i.number}`} · ${i.lot_code}</td><td class="num">${money(i.pending_amount, i.currency)}</td></tr>`)}
        </tbody></table>` : html`<p class="muted">Nada vence esta semana.</p>`}
      </section>
    </div>
    <div class="grid2">
      <section class="card"><h2>Promesas de pago incumplidas</h2>
        ${f.brokenPromises.length ? html`<table><thead><tr><th>Cliente</th><th>Prometió</th><th class="num">Monto</th></tr></thead><tbody>
          ${f.brokenPromises.map((p) => html`<tr><td><a href="/admin/finanzas/ventas/${p.sale_id}">${p.client_name}</a></td><td>${fmtDate(p.promised_date)}</td><td class="num">${money(p.amount, p.currency)}</td></tr>`)}
        </tbody></table>` : html`<p class="muted">Sin promesas incumplidas en los últimos 60 días.</p>`}
      </section>
      <section class="card"><h2>Ingresos por mes</h2>
        ${f.monthly.length ? html`<div class="bars">${f.monthly.map((m) => html`<div class="bar"><span>${monthName(m.month)} · ${m.currency}</span><i style="width: ${(Number(m.total) / maxMonth) * 100}%"></i><b title="${m.n} pagos">${money(m.total, m.currency).replace(` ${m.currency}`, '')}</b></div>`)}</div>`
          : html`<p class="muted">Sin pagos en los últimos 12 meses.</p>`}
      </section>
    </div>`;
  res.send(String(adminPage({ req, title: 'Finanzas y cartera', active: '/admin/finanzas', body })));
});

// ---------- Ventas ----------
router.get('/admin/finanzas/ventas', async (req, res) => {
  const [rows, devs] = await Promise.all([listSales(req.user, req.query), many('SELECT id, name FROM developments ORDER BY sort_order, number')]);
  const f = req.query;
  const body = html`
    <form class="filters" method="get">
      <label>Buscar<input name="q" value="${f.q ?? ''}" placeholder="Cliente o lote"></label>
      <label>Cartera<select name="cartera"><option value="">Toda</option><option value="vencida" ${f.cartera === 'vencida' ? 'selected' : ''}>Con pagos vencidos</option><option value="morosos" ${f.cartera === 'morosos' ? 'selected' : ''}>Morosos</option></select></label>
      <label>Estatus<select name="status"><option value="">Todos</option>${Object.entries(SALE_STATUS).map(([k, v]) => html`<option value="${k}" ${f.status === k ? 'selected' : ''}>${v}</option>`)}</select></label>
      <label>Desarrollo<select name="development"><option value="">Todos</option>${devs.map((d) => html`<option value="${d.id}" ${String(f.development) === String(d.id) ? 'selected' : ''}>${d.name}</option>`)}</select></label>
      <button class="btn small" type="submit">Filtrar</button>
    </form>
    <section class="card flush"><table class="list" data-live-list>
      <thead><tr><th>Venta</th><th>Cliente</th><th>Lote</th><th class="num">Precio</th><th class="num">Pagado</th><th class="num">Saldo</th><th class="num">Vencido</th><th>Próximo pago</th><th>Estado</th></tr></thead>
      <tbody>${rows.map((s) => html`<tr class="${Number(s.overdue_amount) > 0 && s.status === 'activa' ? 'late' : ''}">
        <td><a href="/admin/finanzas/ventas/${s.id}"><strong>#${s.id}</strong></a><br><small class="muted">${fmtDate(s.sale_date)}</small></td>
        <td>${s.client_name}<br><small class="muted">${s.advisor_name ?? ''}</small></td><td>${s.lot_code}<br><small class="muted">${s.development_name}</small></td>
        <td class="num">${money(s.agreed_price, s.currency)}</td><td class="num">${money(s.total_paid, s.currency)}</td><td class="num">${money(s.balance, s.currency)}</td>
        <td class="num">${Number(s.overdue_amount) > 0 ? money(s.overdue_amount, s.currency) : '—'}</td>
        <td>${s.next_due_date && s.status === 'activa' ? html`${fmtDate(s.next_due_date)}<br><small class="muted">${money(s.next_due_amount, s.currency)}</small>` : '—'}</td>
        <td>${saleBadge(s)}</td></tr>`)}</tbody>
    </table>${rows.length ? '' : html`<p class="muted pad">No hay ventas con estos filtros.</p>`}</section>`;
  res.send(String(adminPage({ req, title: 'Ventas y cartera', active: '/admin/finanzas', body })));
});

function planFromBody(b) {
  const n = (v) => String(v ?? '').replace(/[$,\s]/g, '');
  return {
    lotId: b.lot_id, saleDate: b.sale_date, agreedPrice: n(b.agreed_price), downPayment: n(b.down_payment) || '0',
    downPaymentDate: b.down_payment_date || b.sale_date, installments: Number(b.installments || 0), annualRate: n(b.annual_rate) || '0',
    firstDueDate: b.first_due_date, notes: b.notes,
  };
}

async function saleForm(req, res, { values = {}, preview = null, error = null } = {}) {
  const lots = await lotsPendingSale();
  const v = (k) => values[k] ?? '';
  const today = todayTijuana();
  const lot = lots.find((l) => String(l.id) === String(values.lot_id ?? req.query.lote));
  const cur = lot?.currency ?? 'MXN';
  const body = html`
    ${error ? html`<div class="alert err" role="alert">${error}</div>` : ''}
    <form class="card form" method="post" action="/admin/finanzas/ventas">
      ${csrfField(req)}
      <h2>Venta y plan de pagos</h2>
      ${lots.length ? '' : html`<p class="muted">No hay lotes apartados o vendidos pendientes de registrar. Primero aparta o vende un lote desde Proyectos e inventario.</p>`}
      <div class="fields">
        <label class="wide">Lote y cliente *<select name="lot_id" required><option value="">Selecciona…</option>${lots.map((l) => html`<option value="${l.id}" ${lot?.id === l.id ? 'selected' : ''}>${l.development_name} · ${l.code} · ${l.client_name} (${l.status}) · lista ${money(l.price, l.currency)}</option>`)}</select></label>
        <label>Fecha de venta *<input type="date" name="sale_date" required value="${v('sale_date') || today}"></label>
        <label>Precio pactado *<input name="agreed_price" inputmode="decimal" required value="${v('agreed_price') || (lot?.price ?? '')}"></label>
        <label>Enganche<input name="down_payment" inputmode="decimal" value="${v('down_payment')}"></label>
        <label>Fecha del enganche<input type="date" name="down_payment_date" value="${v('down_payment_date') || today}"></label>
        <label>Mensualidades *<input name="installments" type="number" min="0" max="360" required value="${v('installments')}"></label>
        <label>Primera mensualidad<input type="date" name="first_due_date" value="${v('first_due_date')}"></label>
        <label>Interés anual (%)<input name="annual_rate" inputmode="decimal" value="${v('annual_rate') || '0'}"></label>
        <label class="wide">Notas<textarea name="notes" rows="2">${v('notes')}</textarea></label>
      </div>
      <div class="toolbar"><button class="btn ghost" type="submit" name="action" value="preview">Calcular plan</button>${preview ? html`<button class="btn" type="submit" name="action" value="save">Registrar venta</button>` : ''}</div>
      ${preview ? html`<p class="muted">Revisa el calendario antes de registrar: una vez guardado no se modifica.</p>
        <table><thead><tr><th>#</th><th>Vence</th><th class="num">Capital</th><th class="num">Interés</th><th class="num">Pago</th></tr></thead><tbody>
        ${preview.map((r) => html`<tr><td>${r.number === 0 ? 'Enganche' : r.number}</td><td>${fmtDate(r.due_date)}</td><td class="num">${money(r.principal, cur)}</td><td class="num">${money(r.interest, cur)}</td><td class="num">${money(r.amount, cur)}</td></tr>`)}
        <tr><td colspan="4"><strong>Total</strong></td><td class="num"><strong>${money(preview.reduce((a, r) => a + Number(r.amount), 0), cur)}</strong></td></tr></tbody></table>` : ''}
    </form>`;
  res.send(String(adminPage({ req, title: 'Registrar venta', active: '/admin/finanzas', body })));
}

router.get('/admin/finanzas/ventas/nueva', requirePermission('finance.manage'), (req, res) => saleForm(req, res));

router.post('/admin/finanzas/ventas', requirePermission('finance.manage'), async (req, res) => {
  const plan = planFromBody(req.body);
  const errors = validatePlan(plan);
  if (errors.length) return saleForm(req, res.status(422), { values: req.body, error: errors.join(' ') });
  if (req.body.action !== 'save') return saleForm(req, res, { values: req.body, preview: buildSchedule(plan) });
  const r = await createSale(req.user, plan, req);
  if (r.error) return saleForm(req, res.status(422), { values: req.body, error: r.error });
  res.redirect(303, `/admin/finanzas/ventas/${r.id}?msg=creado`);
});

router.get('/admin/finanzas/ventas/:id', async (req, res, next) => {
  const s = await getSale(req.user, req.params.id);
  if (!s) return next();
  const [schedule, payments, promises] = await Promise.all([scheduleFor(s.id), paymentsFor(s.id), promisesFor(s.id)]);
  const manage = can(req.user, 'finance.manage') && s.status !== 'cancelada';
  const seeLead = can(req.user, 'leads.view_all') || s.lead_owner === req.user.id;
  const body = html`
    <div class="lead-head">
      <div><h2>Venta #${s.id} · ${s.client_name}</h2><p>${saleBadge(s)} · ${s.development_name} · lote ${s.lot_code} · ${fmtDate(s.sale_date)}${s.advisor_name ? ` · asesor ${s.advisor_name}` : ''}</p>
      ${s.status === 'cancelada' ? html`<p class="alert err">Cancelada el ${fmtDateTime(s.cancelled_at)}: ${s.cancel_reason}</p>` : ''}</div>
      <div class="actions">
        <a class="btn ghost" href="/admin/chat?ref=sale:${s.id}">Compartir en chat</a>
        <a class="btn ghost" href="/admin/finanzas/ventas/${s.id}/estado-de-cuenta" target="_blank">Estado de cuenta</a>
        <a class="btn ghost" href="/admin/finanzas/ventas/${s.id}/estado-de-cuenta.csv">CSV</a>
        ${seeLead ? html`<a class="btn ghost" href="/admin/prospectos/${s.lead_id}">Ficha del cliente</a>` : ''}
      </div>
    </div>
    <section class="kpis">
      ${kpi('Precio pactado', money(s.agreed_price, s.currency), s.list_price && Number(s.list_price) !== Number(s.agreed_price) ? `Lista ${money(s.list_price, s.currency)}` : '')}
      ${kpi('Total del plan', money(s.total_due, s.currency), Number(s.annual_rate) > 0 ? `Interés anual ${Number(s.annual_rate)}%` : 'Sin intereses')}
      ${kpi('Pagado', money(s.total_paid, s.currency))}
      ${kpi('Saldo', money(Math.max(0, Number(s.balance)), s.currency), Number(s.balance) < 0 ? `Saldo a favor ${money(-Number(s.balance), s.currency)}` : '')}
      ${kpi('Vencido', money(s.overdue_amount, s.currency), s.overdue_count ? `${s.overdue_count} parcialidades · ${s.max_days_late} días` : '')}
    </section>
    <div class="grid2">
      <section class="card"><h2>Calendario de pagos</h2>
        <table><thead><tr><th>#</th><th>Vence</th><th class="num">Pago</th><th class="num">Pagado</th><th class="num">Pendiente</th><th>Estado</th></tr></thead><tbody>
          ${schedule.map((i) => html`<tr class="${i.days_late > 0 && Number(i.pending_amount) > 0 ? 'late' : ''}"><td>${i.number === 0 ? 'Enganche' : i.number}</td><td>${fmtDate(i.due_date)}</td><td class="num">${money(i.amount, s.currency)}</td><td class="num">${money(i.paid_amount, s.currency)}</td><td class="num">${money(i.pending_amount, s.currency)}</td><td>${iStatus(i)}</td></tr>`)}
        </tbody></table>
      </section>
      <div class="stack">
        ${manage ? html`<form class="card form" method="post" action="/admin/finanzas/ventas/${s.id}/pagos">${csrfField(req)}
          <h2>Registrar pago</h2>
          <div class="fields">
            <label>Monto *<input name="amount" inputmode="decimal" required value="${s.next_due_amount ?? ''}"></label>
            <label>Fecha *<input type="date" name="paid_at" required value="${todayTijuana()}" max="${todayTijuana()}"></label>
            <label>Forma de pago<select name="method">${Object.entries(PAYMENT_METHODS).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
            <label>Concepto<select name="concept">${Object.entries(PAYMENT_CONCEPTS).map(([k, v]) => html`<option value="${k}">${v}</option>`)}</select></label>
            <label class="wide">Referencia / folio bancario<input name="reference" maxlength="120"></label>
          </div>
          <p class="muted">El pago se aplica a las parcialidades más antiguas primero.</p>
          <button class="btn" type="submit">Registrar pago</button></form>` : ''}
        <section class="card"><h2>Promesas de pago</h2>
          ${manage ? html`<form class="inline" method="post" action="/admin/finanzas/ventas/${s.id}/promesas">${csrfField(req)}<input type="date" name="date" required min="${todayTijuana()}"><input name="amount" inputmode="decimal" required placeholder="Monto"><input name="note" maxlength="300" placeholder="Nota"><button class="btn small" type="submit">Registrar</button></form>` : ''}
          ${promises.length ? html`<ul class="timeline small">${promises.map((p) => html`<li><time>${fmtDate(p.promised_date)}</time> ${money(p.amount, s.currency)} · <strong>${p.status}</strong>${p.note ? ` · ${p.note}` : ''} <small class="muted">(${p.created_by_name ?? ''})</small></li>`)}</ul>` : html`<p class="muted">Sin promesas registradas.</p>`}
        </section>
      </div>
    </div>
    <section class="card"><h2>Pagos recibidos</h2>
      <table><thead><tr><th>Folio</th><th>Fecha</th><th>Concepto</th><th>Forma</th><th>Referencia</th><th class="num">Monto</th><th>Recibió</th><th>Estado</th></tr></thead><tbody>
        ${payments.map((p) => html`<tr class="${p.status === 'anulado' ? 'voided' : ''}"><td>${p.id}</td><td>${fmtDate(p.paid_at)}</td><td>${PAYMENT_CONCEPTS[p.concept]}</td><td>${PAYMENT_METHODS[p.method]}</td><td>${p.reference}</td><td class="num">${money(p.amount, s.currency)}</td><td>${p.received_by_name ?? ''}</td>
          <td>${p.status === 'anulado' ? html`Anulado por ${p.voided_by_name}: ${p.void_reason}` : can(req.user, 'finance.void') && s.status !== 'cancelada'
            ? html`<form class="mini" method="post" action="/admin/finanzas/pagos/${p.id}/anular" data-confirm="¿Anular este pago? Quedará registrado.">${csrfField(req)}<input name="reason" required maxlength="300" placeholder="Motivo"><button class="btn small ghost" type="submit">Anular</button></form>` : 'Confirmado'}</td></tr>`)}
      </tbody></table>${payments.length ? '' : html`<p class="muted">Sin pagos registrados.</p>`}
      <p class="muted">Los pagos no se borran ni se editan: si hubo un error se anulan con motivo y se registra el correcto.</p>
    </section>
    ${can(req.user, 'finance.cancel_sale') && s.status !== 'cancelada' ? html`<section class="card"><h2>Cancelar venta</h2>
      <form class="inline" method="post" action="/admin/finanzas/ventas/${s.id}/cancelar" data-confirm="¿Cancelar la venta? El lote volverá a estar disponible.">${csrfField(req)}<input name="reason" required maxlength="300" placeholder="Motivo de la cancelación"><button class="btn small ghost" type="submit">Cancelar venta</button></form>
      <p class="muted">Los pagos recibidos se conservan en el historial; cualquier devolución se gestiona por separado.</p></section>` : ''}`;
  res.send(String(adminPage({ req, title: `Venta #${s.id}`, active: '/admin/finanzas', body })));
});

const backTo = (id) => `/admin/finanzas/ventas/${id}`;
const handle = (res, next, id, r) => {
  if (r.error === 'forbidden') return res.status(403).send('No tienes permiso para esta operación.');
  if (r.error === 'not_found') return next();
  if (r.error) return err(res, backTo(id), r.error);
  res.redirect(303, `${backTo(id)}?msg=ok`);
};

router.post('/admin/finanzas/ventas/:id/pagos', requirePermission('finance.manage'), async (req, res, next) => {
  const r = await registerPayment(req.user, req.params.id, { amount: req.body.amount, paidAt: req.body.paid_at, method: req.body.method, concept: req.body.concept, reference: req.body.reference }, req);
  handle(res, next, req.params.id, r);
});

router.post('/admin/finanzas/ventas/:id/promesas', requirePermission('finance.manage'), async (req, res, next) => {
  handle(res, next, req.params.id, await addPromise(req.user, req.params.id, { date: req.body.date, amount: req.body.amount, note: req.body.note }, req));
});

router.post('/admin/finanzas/ventas/:id/cancelar', requirePermission('finance.cancel_sale'), async (req, res, next) => {
  handle(res, next, req.params.id, await cancelSale(req.user, req.params.id, req.body.reason, req));
});

router.post('/admin/finanzas/pagos/:id/anular', requirePermission('finance.void'), async (req, res, next) => {
  const r = await voidPayment(req.user, req.params.id, req.body.reason, req);
  if (r.error === 'not_found') return next();
  if (r.error === 'forbidden') return res.status(403).send('No tienes permiso para esta operación.');
  const ref = String(req.get('referer') ?? '').match(/\/admin\/finanzas\/ventas\/(\d+)/)?.[1];
  if (r.error) return ref ? err(res, backTo(ref), r.error) : res.status(422).send(r.error);
  res.redirect(303, `${backTo(r.saleId)}?msg=ok`);
});

// ---------- Estado de cuenta ----------
router.get('/admin/finanzas/ventas/:id/estado-de-cuenta', async (req, res, next) => {
  const s = await getSale(req.user, req.params.id);
  if (!s) return next();
  const [schedule, payments, settings] = await Promise.all([scheduleFor(s.id), paymentsFor(s.id), getSettings()]);
  await audit({ req, action: 'sale.statement', entity: 'sale', entityId: s.id });
  const valid = payments.filter((p) => p.status === 'confirmado');
  res.send(String(html`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Estado de cuenta · Venta #${s.id}</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@600;700;800&amp;family=Manrope:wght@400;500;600&amp;display=swap">
<link rel="stylesheet" href="/css/statement.css"><script src="/js/print.js" defer></script></head>
<body><main class="sheet">
  <header><div class="brand"><img src="/assets/325064d3b4316ae2578e7736d1db07c2.png" alt="" height="44"><div><b><span>CON</span>NOR</b><small>CONSTRUCTORA DEL NOROESTE</small></div></div>
    <div class="meta"><h1>Estado de cuenta</h1><p>Venta #${s.id} · Emitido ${fmtDateTime(new Date())}</p></div></header>
  <section class="cols">
    <div><h2>Cliente</h2><p><strong>${s.client_name}</strong><br>${s.client_phone ?? ''}${s.client_email ? html`<br>${s.client_email}` : ''}</p></div>
    <div><h2>Inmueble</h2><p><strong>${s.development_name}</strong><br>Lote ${s.lot_code}${s.area_m2 ? ` · ${Number(s.area_m2)} m²` : ''}<br>Fecha de venta ${fmtDate(s.sale_date)}</p></div>
    <div><h2>Resumen</h2><table class="sum">
      <tr><td>Precio pactado</td><td>${money(s.agreed_price, s.currency)}</td></tr>
      <tr><td>Total del plan</td><td>${money(s.total_due, s.currency)}</td></tr>
      <tr><td>Pagado</td><td>${money(s.total_paid, s.currency)}</td></tr>
      <tr><td><strong>Saldo</strong></td><td><strong>${money(Math.max(0, Number(s.balance)), s.currency)}</strong></td></tr>
      <tr><td>Vencido</td><td>${money(s.overdue_amount, s.currency)}</td></tr></table></div>
  </section>
  ${s.status === 'cancelada' ? html`<p class="warn">VENTA CANCELADA el ${fmtDate(s.cancelled_at)}.</p>` : ''}
  <h2>Calendario de pagos</h2>
  <table><thead><tr><th>#</th><th>Vencimiento</th><th>Importe</th><th>Pagado</th><th>Pendiente</th><th>Estado</th></tr></thead><tbody>
    ${schedule.map((i) => html`<tr><td>${i.number === 0 ? 'Enganche' : i.number}</td><td>${fmtDate(i.due_date)}</td><td>${money(i.amount, s.currency)}</td><td>${money(i.paid_amount, s.currency)}</td><td>${money(i.pending_amount, s.currency)}</td>
      <td>${Number(i.pending_amount) <= 0 ? 'Pagada' : i.days_late > 0 ? `Vencida (${i.days_late} días)` : Number(i.paid_amount) > 0 ? 'Parcial' : 'Pendiente'}</td></tr>`)}
  </tbody></table>
  <h2>Pagos recibidos</h2>
  <table><thead><tr><th>Folio</th><th>Fecha</th><th>Concepto</th><th>Forma de pago</th><th>Referencia</th><th>Importe</th></tr></thead><tbody>
    ${valid.map((p) => html`<tr><td>${p.id}</td><td>${fmtDate(p.paid_at)}</td><td>${PAYMENT_CONCEPTS[p.concept]}</td><td>${PAYMENT_METHODS[p.method]}</td><td>${p.reference}</td><td>${money(p.amount, s.currency)}</td></tr>`)}
  </tbody></table>
  <footer><p>${settings.company_name} · ${settings.phone_display}${settings.email ? ` · ${settings.email}` : ''}${settings.office_address ? ` · ${settings.office_address}` : ''}</p>
  <p>Documento informativo. Los pagos se aplican a las parcialidades más antiguas. Para aclaraciones comuníquese con su asesor.</p></footer>
  <button class="print" type="button" data-print>Imprimir o guardar PDF</button>
</main></body></html>`));
});

router.get('/admin/finanzas/ventas/:id/estado-de-cuenta.csv', async (req, res, next) => {
  const s = await getSale(req.user, req.params.id);
  if (!s) return next();
  const [schedule, payments] = await Promise.all([scheduleFor(s.id), paymentsFor(s.id)]);
  await audit({ req, action: 'sale.statement_csv', entity: 'sale', entityId: s.id });
  const rows = [['Venta', s.id], ['Cliente', s.client_name], ['Desarrollo', s.development_name], ['Lote', s.lot_code], ['Moneda', s.currency],
    ['Precio pactado', s.agreed_price], ['Pagado', s.total_paid], ['Saldo', s.balance], ['Vencido', s.overdue_amount], [],
    ['Parcialidad', 'Vencimiento', 'Importe', 'Pagado', 'Pendiente', 'Días de atraso'],
    ...schedule.map((i) => [i.number === 0 ? 'Enganche' : i.number, i.due_date, i.amount, i.paid_amount, i.pending_amount, i.days_late]), [],
    ['Folio', 'Fecha', 'Concepto', 'Forma de pago', 'Referencia', 'Importe', 'Estado'],
    ...payments.map((p) => [p.id, p.paid_at, PAYMENT_CONCEPTS[p.concept], PAYMENT_METHODS[p.method], p.reference, p.amount, p.status])];
  csvResponse(res, `estado-de-cuenta-venta-${s.id}.csv`, rows);
});

// ---------- Reportes ----------
router.get('/admin/finanzas/reportes', async (req, res) => {
  const t = todayTijuana();
  const body = html`<div class="grid2">
    <form class="card form" method="get" action="/admin/finanzas/reportes/ingresos.csv">
      <h2>Ingresos (pagos recibidos)</h2>
      <div class="fields"><label>Desde<input type="date" name="desde" required value="${t.slice(0, 8)}01"></label><label>Hasta<input type="date" name="hasta" required value="${t}"></label></div>
      <button class="btn" type="submit">Descargar CSV</button>
    </form>
    <section class="card"><h2>Antigüedad de cartera</h2><p class="muted">Saldo vencido por cliente en rangos de 1-30, 31-60, 61-90 y más de 90 días.</p><a class="btn" href="/admin/finanzas/reportes/cartera.csv">Descargar CSV</a></section>
  </div>`;
  res.send(String(adminPage({ req, title: 'Reportes financieros', active: '/admin/finanzas', body })));
});

router.get('/admin/finanzas/reportes/ingresos.csv', async (req, res) => {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const from = iso.test(req.query.desde ?? '') ? req.query.desde : todayTijuana().slice(0, 8) + '01';
  const to = iso.test(req.query.hasta ?? '') ? req.query.hasta : todayTijuana();
  const rows = await incomeReport(req.user, from, to);
  await audit({ req, action: 'report.income', entity: 'finance', details: { from, to, count: rows.length } });
  csvResponse(res, `ingresos-${from}-a-${to}.csv`, [['Folio', 'Fecha', 'Cliente', 'Desarrollo', 'Lote', 'Concepto', 'Forma de pago', 'Referencia', 'Importe', 'Moneda', 'Recibió'],
    ...rows.map((r) => [r.folio, r.paid_at, r.client_name, r.development_name, r.lot_code, PAYMENT_CONCEPTS[r.concept], PAYMENT_METHODS[r.method], r.reference, r.amount, r.currency, r.received_by_name])]);
});

router.get('/admin/finanzas/reportes/cartera.csv', async (req, res) => {
  const rows = await agingReport(req.user);
  await audit({ req, action: 'report.aging', entity: 'finance', details: { count: rows.length } });
  csvResponse(res, `antiguedad-cartera-${todayTijuana()}.csv`, [['Venta', 'Cliente', 'Desarrollo', 'Lote', 'Moneda', 'Saldo total', '1-30 días', '31-60 días', '61-90 días', 'Más de 90 días'],
    ...rows.map((r) => [r.id, r.client_name, r.development_name, r.lot_code, r.currency, r.balance, r.b1_30, r.b31_60, r.b61_90, r.b90])]);
});

export default router;
