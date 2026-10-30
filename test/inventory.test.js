import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { one, query } from '../src/db.js';
import { changeLotStatus, importLots, parseLots, releaseExpiredReservations } from '../src/services/inventory.js';
import { captureLead } from '../src/services/leads.js';
import { client, setup } from './helpers.js';

let ctx;
let dev;
let users;
let leadAna;
let leadBeto;
const as = (key, role) => ({ id: users[key], role, name: key });

before(async () => {
  ctx = await setup();
  users = ctx.users;
  dev = await one(`SELECT id FROM developments WHERE slug = 'valle-del-borrego'`);
  // Asigna un prospecto a cada asesor.
  await query(`UPDATE users SET available = (id = $1) WHERE role = 'asesor'`, [users.ana]);
  leadAna = await captureLead({ name: 'Cliente de Ana', phone: '6645550001', source: 'web', developmentId: dev.id });
  await query(`UPDATE users SET available = (id = $1) WHERE role = 'asesor'`, [users.beto]);
  leadBeto = await captureLead({ name: 'Cliente de Beto', phone: '6645550002', source: 'web', developmentId: dev.id });
  await query(`UPDATE users SET available = true WHERE role = 'asesor'`);
});
after(async () => { await ctx.close(); });

const lotId = (code) => one('SELECT id FROM lots WHERE development_id = $1 AND code = $2', [dev.id, code]).then((r) => r.id);

describe('importación de lotes', () => {
  test('lee Excel/CSV, ignora encabezado y reporta errores', () => {
    const { rows, errors } = parseLots('Clave\tManzana\tLote\tm2\tFrente\tFondo\tPrecio\nM1-01\tM1\t01\t250\t10\t25\t$232,200\nM1-02;M1;02;250;10;25;232200\n;M1;03\nM1-04;M1;04;abc;10;25;1');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].price, 232200);
    assert.equal(errors.length, 2);
  });

  test('crea y actualiza sin tocar el estatus', async () => {
    const { rows } = parseLots(['M1-01;M1;01;250;10;25;232200', 'M1-02;M1;02;250;10;25;232200', 'M1-03;M1;03;250;10;25;232200', 'M1-04;M1;04;250;10;25;232200'].join('\n'));
    assert.deepEqual(await importLots(dev.id, rows, 'MXN', null), { created: 4, updated: 0 });
    await query(`UPDATE lots SET status = 'bloqueado' WHERE code = 'M1-04' AND development_id = $1`, [dev.id]);
    const again = parseLots('M1-04;M1;04;260;10;26;240000').rows;
    assert.deepEqual(await importLots(dev.id, again, 'MXN', null), { created: 0, updated: 1 });
    const l = await one(`SELECT status, area_m2, price FROM lots WHERE id = $1`, [await lotId('M1-04')]);
    assert.equal(l.status, 'bloqueado');
    assert.equal(Number(l.price), 240000);
    assert.equal((await one('SELECT total_lots FROM developments WHERE id = $1', [dev.id])).total_lots, 4);
  });
});

describe('apartados y ventas', () => {
  test('dos asesores no pueden apartar el mismo lote al mismo tiempo', async () => {
    const id = await lotId('M1-01');
    const [a, b] = await Promise.all([
      changeLotStatus(as('ana', 'asesor'), id, { status: 'apartado', leadId: leadAna.id }, null),
      changeLotStatus(as('beto', 'asesor'), id, { status: 'apartado', leadId: leadBeto.id }, null),
    ]);
    assert.equal([a, b].filter((r) => r.ok).length, 1);
    assert.match([a, b].find((r) => r.error).error, /ya está apartado|disponibles/);
  });

  test('un asesor no puede apartar para un prospecto ajeno ni vender', async () => {
    const id = await lotId('M1-02');
    const r = await changeLotStatus(as('ana', 'asesor'), id, { status: 'apartado', leadId: leadBeto.id }, null);
    assert.match(r.error, /fuera de tu cartera/);
    const s = await changeLotStatus(as('ana', 'asesor'), id, { status: 'vendido', leadId: leadAna.id }, null);
    assert.equal(s.error, 'forbidden');
  });

  test('solo quien apartó (o gerencia) puede liberar', async () => {
    const id = await lotId('M1-02');
    assert.ok((await changeLotStatus(as('beto', 'asesor'), id, { status: 'apartado', leadId: leadBeto.id }, null)).ok);
    assert.equal((await changeLotStatus(as('ana', 'asesor'), id, { status: 'disponible' }, null)).error, 'forbidden');
    assert.ok((await changeLotStatus(as('beto', 'asesor'), id, { status: 'disponible' }, null)).ok);
  });

  test('la venta mueve al prospecto a "Venta" y solo admin la cancela con motivo', async () => {
    const id = await lotId('M1-03');
    assert.ok((await changeLotStatus(as('gerente', 'gerencia'), id, { status: 'vendido', leadId: leadAna.id }, null)).ok);
    assert.equal((await one('SELECT stage FROM leads WHERE id = $1', [leadAna.id])).stage, 'venta');
    assert.equal((await changeLotStatus(as('gerente', 'gerencia'), id, { status: 'disponible', note: 'x' }, null)).error, 'forbidden');
    assert.match((await changeLotStatus(as('admin', 'admin'), id, { status: 'disponible' }, null)).error, /motivo/);
    assert.ok((await changeLotStatus(as('admin', 'admin'), id, { status: 'disponible', note: 'Cliente desistió' }, null)).ok);
    const events = (await query('SELECT to_status FROM lot_events WHERE lot_id = $1 ORDER BY id', [id])).rows.map((r) => r.to_status);
    assert.deepEqual(events, ['vendido', 'disponible']);
    const { n } = await one(`SELECT count(*)::int AS n FROM audit_log WHERE entity = 'lot' AND entity_id = $1`, [String(id)]);
    assert.equal(n, 2);
  });

  test('la base de datos impide un lote vendido sin cliente', async () => {
    await assert.rejects(query(`UPDATE lots SET status = 'vendido', lead_id = NULL WHERE id = $1`, [await lotId('M1-03')]), /check/i);
  });

  test('libera automáticamente los apartados vencidos', async () => {
    const id = await lotId('M1-03');
    assert.ok((await changeLotStatus(as('ana', 'asesor'), id, { status: 'apartado', leadId: leadAna.id, reservedUntil: '2020-01-01' }, null)).ok);
    const released = await releaseExpiredReservations();
    assert.ok(released.some((l) => l.id === id));
    assert.equal((await one('SELECT status FROM lots WHERE id = $1', [id])).status, 'disponible');
  });
});

describe('panel y sitio público', () => {
  test('la ficha pública muestra solo lotes disponibles, sin datos de clientes', async () => {
    const html = await (await fetch(`${ctx.base}/desarrollos/valle-del-borrego`)).text();
    assert.match(html, /lotes disponibles/);
    assert.ok(html.includes('M1-02'));
    assert.ok(!html.includes('M1-01'), 'el lote apartado no aparece');
    assert.ok(!html.includes('M1-04'), 'el lote bloqueado no aparece');
    assert.ok(!html.includes('Cliente de Ana'));
  });

  test('asesor ve inventario y aparta desde la ficha del prospecto; no ve documentos ni actividades', async () => {
    const ana = client(ctx.base);
    await ana.login('ana@test.local');
    const page = await ana.req(`/admin/proyectos/${dev.id}`);
    assert.equal(page.status, 200);
    assert.ok(!page.text_.includes('Cliente de Beto'), 'no ve el nombre del cliente de otro asesor');
    assert.ok(!page.text_.includes('Documentación'));
    const csrf = await ana.csrf();
    const r = await ana.req('/admin/lotes/apartar', { method: 'POST', form: { _csrf: csrf, lead_id: String(leadAna.id), lot_id: String(await lotId('M1-02')) } });
    assert.equal(r.status, 303);
    assert.equal((await one('SELECT lead_id FROM lots WHERE id = $1', [await lotId('M1-02')])).lead_id, leadAna.id);
    assert.equal((await ana.req('/admin/documentos/1')).status, 403);
    assert.equal((await ana.req(`/admin/proyectos/${dev.id}/actividades`, { method: 'POST', form: { _csrf: csrf, title: 'x' } })).status, 403);
  });

  test('finanzas no accede al inventario', async () => {
    const fina = client(ctx.base);
    await fina.login('fina@test.local');
    assert.equal((await fina.req('/admin/proyectos')).status, 403);
  });

  test('gerencia registra actividades y documentos privados que no se sirven públicamente', async () => {
    const g = client(ctx.base);
    await g.login('gerente@test.local');
    const csrf = await g.csrf();
    await g.req(`/admin/proyectos/${dev.id}/actividades`, { method: 'POST', form: { _csrf: csrf, title: 'Introducir red eléctrica M1', due_date: '2026-12-01' } });
    assert.ok(await one(`SELECT 1 FROM project_tasks WHERE development_id = $1 AND title = 'Introducir red eléctrica M1'`, [dev.id]));

    const form = new FormData();
    form.set('_csrf', csrf);
    form.set('title', 'Plano de lotificación');
    form.set('file', new Blob(['%PDF-1.4\n%prueba\n'], { type: 'application/pdf' }), 'plano.pdf');
    const up = await g.req(`/admin/proyectos/${dev.id}/documentos`, { method: 'POST', body: form });
    assert.equal(up.status, 303);
    const doc = await one('SELECT * FROM project_documents WHERE development_id = $1', [dev.id]);
    assert.equal((await fetch(`${ctx.base}/uploads/${doc.stored_name}`)).status, 404);
    const dl = await g.req(`/admin/documentos/${doc.id}`);
    assert.equal(dl.status, 200);
    assert.match(dl.headers.get('content-disposition'), /attachment/);

    const fake = new FormData();
    fake.set('_csrf', csrf);
    fake.set('title', 'Falso');
    fake.set('file', new Blob(['<script>alert(1)</script>'], { type: 'application/pdf' }), 'falso.pdf');
    await g.req(`/admin/proyectos/${dev.id}/documentos`, { method: 'POST', body: fake });
    assert.equal((await one(`SELECT count(*)::int AS n FROM project_documents WHERE title = 'Falso'`)).n, 0);
  });
});
