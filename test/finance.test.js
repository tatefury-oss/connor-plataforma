import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { one, query } from '../src/db.js';
import {
  addMonths, addPromise, buildSchedule, cancelSale, createSale, financeSummary, getSale, promisesFor, registerPayment,
  scheduleFor, todayTijuana, voidPayment,
} from '../src/services/finance.js';
import { changeLotStatus, importLots, parseLots } from '../src/services/inventory.js';
import { captureLead } from '../src/services/leads.js';
import { client, setup } from './helpers.js';

let ctx;
let users;
let dev;
let leadAna;
let leadBeto;
const as = (key, role) => ({ id: users[key], role, name: key });
const fin = () => as('fina', 'finanzas');
const admin = () => as('admin', 'admin');
const sum = (rows, k = 'amount') => rows.reduce((a, r) => a + Math.round(Number(r[k]) * 100), 0);

before(async () => {
  ctx = await setup();
  users = ctx.users;
  dev = await one(`SELECT id FROM developments WHERE slug = 'villas-del-pedregal'`);
  await query(`UPDATE users SET available = (id = $1) WHERE role = 'asesor'`, [users.ana]);
  leadAna = await captureLead({ name: 'Rosa Cliente', phone: '6647770001', source: 'web', developmentId: dev.id });
  await query(`UPDATE users SET available = (id = $1) WHERE role = 'asesor'`, [users.beto]);
  leadBeto = await captureLead({ name: 'Mario Cliente', phone: '6647770002', source: 'web', developmentId: dev.id });
  await query(`UPDATE users SET available = true WHERE role = 'asesor'`);
  await importLots(dev.id, parseLots(['A-01;A;01;200;10;20;240000', 'A-02;A;02;200;10;20;240000', 'A-03;A;03;250;10;25;300000'].join('\n')).rows, 'MXN', null);
});
after(async () => { await ctx.close(); });

const lot = (code) => one('SELECT id FROM lots WHERE development_id = $1 AND code = $2', [dev.id, code]).then((r) => r.id);
const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

describe('cálculos financieros', () => {
  test('suma meses respetando fin de mes', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2028-01-31', 1), '2028-02-29');
    assert.equal(addMonths('2026-11-15', 3), '2027-02-15');
  });

  test('plan sin interés: el total cuadra al centavo', () => {
    const rows = buildSchedule({ agreedPrice: 232200, downPayment: 2700, installments: 85, annualRate: 0, firstDueDate: '2026-12-05', downPaymentDate: '2026-11-05' });
    assert.equal(rows.length, 86);
    assert.equal(rows[0].number, 0);
    assert.equal(sum(rows), 23220000);
    assert.equal(rows[1].amount, '2700.00');
    assert.equal(rows.at(-1).due_date, addMonths('2026-12-05', 84));
  });

  test('plan con interés: amortización francesa que liquida el capital exacto', () => {
    const rows = buildSchedule({ agreedPrice: 100000, downPayment: 0, installments: 12, annualRate: 12, firstDueDate: '2026-12-01' });
    assert.equal(sum(rows, 'principal'), 10000000);
    const payments = rows.slice(0, -1).map((r) => r.amount);
    assert.ok(payments.every((a) => a === payments[0]), 'pago fijo');
    assert.equal(payments[0], '8884.88');
    assert.ok(Math.abs(Number(rows.at(-1).amount) - 8884.88) < 0.05);
    assert.equal(rows[0].interest, '1000.00');
  });

  test('montos que no se dividen exacto', () => {
    const rows = buildSchedule({ agreedPrice: 1000, downPayment: 0, installments: 3, firstDueDate: '2026-12-01' });
    assert.deepEqual(rows.map((r) => r.amount), ['333.33', '333.33', '333.34']);
  });
});

describe('ventas y pagos', () => {
  let saleId;

  test('registrar la venta marca el lote vendido y mueve al cliente a "Venta"', async () => {
    const lotId = await lot('A-01');
    assert.ok((await changeLotStatus(as('ana', 'asesor'), lotId, { status: 'apartado', leadId: leadAna.id }, null)).ok);
    const r = await createSale(fin(), {
      lotId, saleDate: daysAgo(100), agreedPrice: '230000', downPayment: '30000', downPaymentDate: daysAgo(100),
      installments: 10, annualRate: '0', firstDueDate: daysAgo(70),
    }, null);
    assert.ok(r.id, r.error);
    saleId = r.id;
    assert.equal((await one('SELECT status FROM lots WHERE id = $1', [lotId])).status, 'vendido');
    assert.equal((await one('SELECT stage FROM leads WHERE id = $1', [leadAna.id])).stage, 'venta');
    const dup = await createSale(fin(), { lotId, saleDate: daysAgo(1), agreedPrice: '1', downPayment: '1', downPaymentDate: daysAgo(1), installments: 0 }, null);
    assert.match(dup.error, /venta vigente|apartado o vendido/);
  });

  test('los pagos se aplican en orden y el atraso se detecta', async () => {
    // Vencidos: enganche (hace 100 días) y mensualidades de hace 70, 40 y 10 días.
    let s = await getSale(admin(), saleId);
    assert.equal(Number(s.total_due), 230000);
    assert.equal(s.overdue_count, 4);
    assert.ok((await registerPayment(fin(), saleId, { amount: '30000', paidAt: daysAgo(99), method: 'transferencia', concept: 'enganche' }, null)).id);
    assert.ok((await registerPayment(fin(), saleId, { amount: '25,000', paidAt: daysAgo(60), method: 'deposito' }, null)).id);
    s = await getSale(admin(), saleId);
    assert.equal(Number(s.total_paid), 55000);
    assert.equal(Number(s.balance), 175000);
    const sched = await scheduleFor(saleId);
    assert.equal(Number(sched[1].pending_amount), 0);
    assert.equal(Number(sched[2].paid_amount), 5000, 'el excedente abona a la siguiente parcialidad');
    assert.equal(s.overdue_count, 2);
    assert.equal(Number(s.overdue_amount), 35000);
    const summary = await financeSummary(admin());
    assert.equal(summary.delinquent, 1, 'dos parcialidades vencidas = moroso');
  });

  test('rechaza pagos inválidos', async () => {
    assert.match((await registerPayment(fin(), saleId, { amount: '-5', paidAt: daysAgo(1), method: 'efectivo' }, null)).error, /Monto/);
    assert.match((await registerPayment(fin(), saleId, { amount: '5', paidAt: '2999-01-01', method: 'efectivo' }, null)).error, /futura/);
    assert.equal((await registerPayment(as('gerente', 'gerencia'), saleId, { amount: '5', paidAt: daysAgo(1), method: 'efectivo' }, null)).error, 'forbidden');
  });

  test('un pago no se borra ni se edita; solo el admin lo anula con motivo', async () => {
    const p = await one('SELECT id FROM payments WHERE sale_id = $1 ORDER BY id DESC LIMIT 1', [saleId]);
    await assert.rejects(query('DELETE FROM payments WHERE id = $1', [p.id]), /no se eliminan/);
    await assert.rejects(query('UPDATE payments SET amount = 1 WHERE id = $1', [p.id]), /no se modifican/);
    await assert.rejects(query(`UPDATE payments SET status = 'anulado' WHERE id = $1`, [p.id]), /motivo/);
    assert.equal((await voidPayment(fin(), p.id, 'error', null)).error, 'forbidden');
    assert.match((await voidPayment(admin(), p.id, '  ', null)).error, /motivo/);
    assert.ok((await voidPayment(admin(), p.id, 'Depósito rebotado', null)).saleId);
    assert.equal(Number((await getSale(admin(), saleId)).total_paid), 30000);
    await assert.rejects(query(`UPDATE payments SET void_reason = 'x' WHERE id = $1`, [p.id]), /anulado/);
    const a = await one(`SELECT details FROM audit_log WHERE action = 'payment.void' ORDER BY id DESC LIMIT 1`);
    assert.equal(a.details.reason, 'Depósito rebotado');
  });

  test('promesas de pago: cumplida o incumplida según los pagos', async () => {
    assert.ok((await addPromise(fin(), saleId, { date: todayTijuana(), amount: '1000' }, null)).id);
    await query(`INSERT INTO payment_promises (sale_id, promised_date, amount, created_at) VALUES ($1, $2, 5000, now() - interval '20 days')`, [saleId, daysAgo(5)]);
    let list = await promisesFor(saleId);
    assert.equal(list.find((p) => p.promised_date === daysAgo(5)).status, 'incumplida');
    assert.equal(list.find((p) => p.promised_date === todayTijuana()).status, 'pendiente');
    await registerPayment(fin(), saleId, { amount: '1000', paidAt: todayTijuana(), method: 'efectivo' }, null);
    list = await promisesFor(saleId);
    assert.equal(list.find((p) => p.promised_date === todayTijuana()).status, 'cumplida');
    assert.equal((await financeSummary(admin())).brokenPromises.length, 1);
  });

  test('al cubrir el total la venta queda liquidada', async () => {
    const lotId = await lot('A-03');
    assert.ok((await changeLotStatus(as('gerente', 'gerencia'), lotId, { status: 'vendido', leadId: leadBeto.id }, null)).ok);
    const r = await createSale(fin(), { lotId, saleDate: todayTijuana(), agreedPrice: '300000', downPayment: '300000', downPaymentDate: todayTijuana(), installments: 0 }, null);
    assert.ok(r.id, r.error);
    await registerPayment(fin(), r.id, { amount: '300000', paidAt: todayTijuana(), method: 'transferencia', concept: 'liquidacion' }, null);
    assert.equal((await getSale(admin(), r.id)).status, 'liquidada');
  });

  test('cancelar la venta libera el lote y conserva los pagos', async () => {
    const s = await one(`SELECT id, lot_id FROM sales WHERE lead_id = $1`, [leadBeto.id]);
    assert.equal((await cancelSale(fin(), s.id, 'x', null)).error, 'forbidden');
    assert.ok((await cancelSale(admin(), s.id, 'Cliente desistió', null)).ok);
    assert.equal((await one('SELECT status FROM lots WHERE id = $1', [s.lot_id])).status, 'disponible');
    assert.equal((await one(`SELECT count(*)::int AS n FROM payments WHERE sale_id = $1`, [s.id])).n, 1);
    await assert.rejects(query('DELETE FROM sales WHERE id = $1', [s.id]), /no se puede eliminar/);
  });
});

describe('permisos y descargas', () => {
  test('cada asesor ve solo la cartera de sus clientes', async () => {
    const ana = client(ctx.base);
    await ana.login('ana@test.local');
    const list = await ana.req('/admin/finanzas/ventas');
    assert.equal(list.status, 200);
    assert.ok(list.text_.includes('Rosa Cliente'));
    assert.ok(!list.text_.includes('Mario Cliente'));
    const other = await one('SELECT id FROM sales WHERE lead_id = $1', [leadBeto.id]);
    assert.equal((await ana.req(`/admin/finanzas/ventas/${other.id}`)).status, 404);
    assert.equal((await ana.req('/admin/finanzas/ventas/nueva')).status, 403);
  });

  test('finanzas ve la cartera pero no el CRM', async () => {
    const f = client(ctx.base);
    await f.login('fina@test.local');
    assert.equal((await f.req('/admin')).headers.get('location'), '/admin/finanzas');
    assert.equal((await f.req('/admin/finanzas')).status, 200);
    assert.equal((await f.req('/admin/prospectos')).status, 403);
    const s = await one('SELECT id FROM sales WHERE lead_id = $1', [leadAna.id]);
    const page = await f.req(`/admin/finanzas/ventas/${s.id}`);
    assert.ok(!page.text_.includes('Ficha del cliente'));
  });

  test('estado de cuenta imprimible y CSV protegido contra fórmulas', async () => {
    await query(`UPDATE leads SET name = '=HYPERLINK("x")' WHERE id = $1`, [leadAna.id]);
    const g = client(ctx.base);
    await g.login('gerente@test.local');
    const s = await one('SELECT id FROM sales WHERE lead_id = $1', [leadAna.id]);
    const html = await g.req(`/admin/finanzas/ventas/${s.id}/estado-de-cuenta`);
    assert.equal(html.status, 200);
    assert.match(html.text_, /Estado de cuenta/);
    const csv = await g.req(`/admin/finanzas/ventas/${s.id}/estado-de-cuenta.csv`);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.ok(csv.text_.includes(`"'=HYPERLINK(""x"")"`));
    const income = await g.req(`/admin/finanzas/reportes/ingresos.csv?desde=${daysAgo(365)}&hasta=${todayTijuana()}`);
    assert.ok(income.text_.includes('Folio'));
    assert.equal((await g.req('/admin/finanzas/reportes/cartera.csv')).status, 200);
  });
});
