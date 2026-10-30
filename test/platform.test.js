import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { one, query } from '../src/db.js';
import { captureLead, normalizePhone } from '../src/services/leads.js';
import { client, setup } from './helpers.js';

let ctx;
before(async () => { ctx = await setup(); });
after(async () => { await ctx.close(); });

const postLead = (base, fields) => fetch(`${base}/contacto`, {
  method: 'POST',
  headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ country: '52', intent: 'info', consent: '1', ...fields }),
});

describe('teléfonos', () => {
  test('normaliza México, EE. UU. y formato 521 de WhatsApp', () => {
    assert.equal(normalizePhone('(665) 653-9053'), '526656539053');
    assert.equal(normalizePhone('619 555 0100', '1'), '16195550100');
    assert.equal(normalizePhone('5216656539053'), '526656539053');
    assert.equal(normalizePhone('123'), null);
  });
});

describe('sitio público', () => {
  test('muestra los seis desarrollos y el teléfono configurado', async () => {
    const html = await (await fetch(ctx.base)).text();
    for (const name of ['Vista Bonita', 'Hacienda Flor de Mayo', 'Los Pinos', 'Villas del Pedregal', 'Valle del Borrego']) assert.match(html, new RegExp(name));
    assert.match(html, /tel:\+526656539053/);
    assert.match(html, /<span[^>]*>6<\/span><span[^>]*>Desarrollos en comercialización/);
  });

  test('ficha individual y 404', async () => {
    assert.equal((await fetch(`${ctx.base}/desarrollos/los-pinos`)).status, 200);
    assert.equal((await fetch(`${ctx.base}/desarrollos/no-existe`)).status, 404);
  });

  test('valida el formulario y exige consentimiento', async () => {
    const res = await postLead(ctx.base, { name: 'X', phone: '12', consent: '' });
    assert.equal(res.status, 422);
    const { errors } = await res.json();
    assert.ok(errors.name && errors.consent);
  });

  test('escapa contenido editable (XSS)', async () => {
    await query(`UPDATE settings SET value = '<script>alert(1)</script>' WHERE key = 'hero_title'`);
    const html = await (await fetch(ctx.base)).text();
    assert.ok(!html.includes('<script>alert(1)'));
    assert.ok(html.includes('&lt;script&gt;alert(1)'));
  });

  test('envía cabeceras de seguridad', async () => {
    const res = await fetch(ctx.base);
    assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-powered-by'), null);
  });
});

describe('Round Robin y deduplicación', () => {
  test('reparte en orden entre asesores disponibles y no duplica teléfonos', async () => {
    const a = await (await postLead(ctx.base, { name: 'Uno', phone: '6640000001' })).json();
    assert.ok(a.ok);
    const l1 = await one(`SELECT assigned_to FROM leads WHERE phone_normalized = '526640000001'`);
    await postLead(ctx.base, { name: 'Dos', phone: '6640000002' });
    const l2 = await one(`SELECT assigned_to FROM leads WHERE phone_normalized = '526640000002'`);
    assert.notEqual(l1.assigned_to, l2.assigned_to);
    assert.deepEqual(new Set([l1.assigned_to, l2.assigned_to]), new Set([ctx.users.ana, ctx.users.beto]));

    await postLead(ctx.base, { name: 'Uno otra vez', phone: '664-000-0001' });
    const { n } = await one(`SELECT count(*)::int AS n FROM leads WHERE phone_normalized = '526640000001'`);
    assert.equal(n, 1);
    const again = await one(`SELECT assigned_to FROM leads WHERE phone_normalized = '526640000001'`);
    assert.equal(again.assigned_to, l1.assigned_to, 'el prospecto existente conserva a su asesor');
  });

  test('omite asesores no disponibles y escala si no hay ninguno', async () => {
    await query('UPDATE users SET available = false WHERE id = $1', [ctx.users.beto]);
    for (const p of ['6640000003', '6640000004']) await postLead(ctx.base, { name: 'Disp', phone: p });
    const rows = (await query(`SELECT assigned_to FROM leads WHERE phone_normalized IN ('526640000003','526640000004')`)).rows;
    assert.ok(rows.every((r) => r.assigned_to === ctx.users.ana));

    await query(`UPDATE users SET available = false WHERE role = 'asesor'`);
    const lead = await captureLead({ name: 'Sin asesor', phone: '6640000005', source: 'web' });
    assert.equal(lead.assigned_to, null);
    const h = await one(`SELECT reason FROM lead_assignments WHERE lead_id = $1`, [lead.id]);
    assert.equal(h.reason, 'sin_asesores');
    await query(`UPDATE users SET available = true WHERE role = 'asesor'`);
  });

  test('capturas simultáneas del mismo teléfono generan un solo registro', async () => {
    await Promise.all(Array.from({ length: 5 }, () => captureLead({ name: 'Concurrente', phone: '6640000099', source: 'web' })));
    const { n } = await one(`SELECT count(*)::int AS n FROM leads WHERE phone_normalized = '526640000099'`);
    assert.equal(n, 1);
  });
});

describe('autenticación y permisos', () => {
  test('el panel exige sesión', async () => {
    const res = await fetch(`${ctx.base}/admin/prospectos`, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.match(res.headers.get('location'), /^\/admin\/login/);
  });

  test('un asesor solo ve sus prospectos; finanzas no ve prospectos', async () => {
    const own = await one('SELECT id FROM leads WHERE assigned_to = $1 LIMIT 1', [ctx.users.ana]);
    const other = await one('SELECT id FROM leads WHERE assigned_to = $1 LIMIT 1', [ctx.users.beto]);
    const ana = client(ctx.base);
    assert.equal((await ana.login('ana@test.local')).status, 303);
    assert.equal((await ana.req(`/admin/prospectos/${own.id}`)).status, 200);
    assert.equal((await ana.req(`/admin/prospectos/${other.id}`)).status, 404);
    const list = await ana.req('/admin/prospectos');
    const ids = [...list.text_.matchAll(/href="\/admin\/prospectos\/(\d+)"/g)].map((m) => Number(m[1]));
    const mine = (await query('SELECT id FROM leads WHERE assigned_to = $1', [ctx.users.ana])).rows.map((r) => r.id);
    assert.ok(ids.length && ids.every((id) => mine.includes(id)));
    assert.equal((await ana.req('/admin/usuarios')).status, 403);
    assert.equal((await ana.req('/admin/configuracion')).status, 403);
    assert.equal((await ana.req('/admin/prospectos.csv')).status, 403);

    const fina = client(ctx.base);
    await fina.login('fina@test.local');
    assert.equal((await fina.req('/admin/prospectos')).status, 403);
    assert.equal((await fina.req(`/admin/prospectos/${own.id}`)).status, 403);
  });

  test('rechaza modificaciones sin token CSRF', async () => {
    const admin = client(ctx.base);
    await admin.login('admin@test.local');
    const res = await admin.req('/admin/configuracion', { method: 'POST', form: { phone_display: 'hackeado' } });
    assert.equal(res.status, 403);
    const csrf = await admin.csrf();
    const ok = await admin.req('/admin/configuracion', { method: 'POST', form: { _csrf: csrf, phone_display: '665 653 9053' } });
    assert.equal(ok.status, 303);
  });

  test('gerencia reasigna con motivo y queda en el historial', async () => {
    const lead = await one('SELECT id, assigned_to FROM leads WHERE assigned_to = $1 LIMIT 1', [ctx.users.ana]);
    const g = client(ctx.base);
    await g.login('gerente@test.local');
    const csrf = await g.csrf();
    await g.req(`/admin/prospectos/${lead.id}/reasignar`, { method: 'POST', form: { _csrf: csrf, to: String(ctx.users.beto), note: 'Vacaciones' } });
    const after_ = await one('SELECT assigned_to FROM leads WHERE id = $1', [lead.id]);
    assert.equal(after_.assigned_to, ctx.users.beto);
    const h = await one(`SELECT * FROM lead_assignments WHERE lead_id = $1 AND reason = 'reasignacion'`, [lead.id]);
    assert.equal(h.from_user, ctx.users.ana);
    assert.equal(h.note, 'Vacaciones');
  });

  test('el nombre de un prospecto malicioso se escapa en el panel', async () => {
    const lead = await captureLead({ name: '<img src=x onerror=alert(1)>', phone: '6640000077', source: 'web' });
    const admin = client(ctx.base);
    await admin.login('admin@test.local');
    const page = await admin.req(`/admin/prospectos/${lead.id}`);
    assert.ok(!page.text_.includes('<img src=x'));
  });

  test('bloquea la cuenta tras 5 intentos fallidos', async () => {
    const c = client(ctx.base);
    for (let i = 0; i < 5; i++) assert.equal((await c.login('beto@test.local', 'incorrecta-123456')).status, 401);
    assert.equal((await c.login('beto@test.local')).status, 429, 'ni con la contraseña correcta mientras está bloqueada');
    await query('UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE id = $1', [ctx.users.beto]);
  });
});

describe('auditoría', () => {
  test('la bitácora no se puede modificar ni borrar', async () => {
    await assert.rejects(query('UPDATE audit_log SET action = $1', ['x']), /inmutable/);
    await assert.rejects(query('DELETE FROM audit_log'), /inmutable/);
    const { n } = await one(`SELECT count(*)::int AS n FROM audit_log WHERE action = 'lead.reassign'`);
    assert.ok(n >= 1);
  });
});

describe('webhook de WhatsApp', () => {
  const payload = (id, from, text) => JSON.stringify({ entry: [{ changes: [{ value: {
    contacts: [{ wa_id: from, profile: { name: 'Cliente WA' } }],
    messages: [{ id, from, type: 'text', text: { body: text } }],
  } }] }] });
  const sign = (body) => `sha256=${createHmac('sha256', 'test-app-secret').update(body).digest('hex')}`;
  const send = (body, sig) => fetch(`${ctx.base}/webhooks/whatsapp`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-hub-signature-256': sig }, body });

  test('verificación de suscripción', async () => {
    const ok = await fetch(`${ctx.base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=123`);
    assert.equal(await ok.text(), '123');
    const bad = await fetch(`${ctx.base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=123`);
    assert.equal(bad.status, 403);
  });

  test('rechaza firmas inválidas', async () => {
    const body = payload('wamid.1', '5216641112233', 'hola');
    assert.equal((await send(body, 'sha256=00')).status, 401);
    assert.equal(await one(`SELECT 1 FROM wa_messages WHERE wa_message_id = 'wamid.1'`), null);
  });

  test('registra el prospecto y no duplica reintentos de Meta', async () => {
    const body = payload('wamid.2', '5216641112233', 'Me interesa Valle del Borrego');
    assert.equal((await send(body, sign(body))).status, 200);
    assert.equal((await send(body, sign(body))).status, 200);
    const lead = await one(`SELECT * FROM leads WHERE phone_normalized = '526641112233'`);
    assert.equal(lead.source, 'whatsapp');
    assert.equal(lead.name, 'Cliente WA');
    assert.ok(lead.assigned_to);
    const { n } = await one(`SELECT count(*)::int AS n FROM wa_messages WHERE lead_id = $1`, [lead.id]);
    assert.equal(n, 1);
  });
});

describe('filtros por fecha', () => {
  test('un prospecto de la noche (hora de Tijuana) cuenta en su día local', async () => {
    const { commercialSummary } = await import('../src/services/analytics.js');
    // 23:30 del 15 de marzo en Tijuana = 06:30 UTC del 16 de marzo.
    await query(`INSERT INTO leads (name, source, created_at) VALUES ('Nocturno', 'web', '2026-03-16T06:30:00Z')`);
    const day = await commercialSummary({ id: ctx.users.admin, role: 'admin' }, '2026-03-15', '2026-03-15');
    assert.equal(day.totales.prospectos, 1);
    const next = await commercialSummary({ id: ctx.users.admin, role: 'admin' }, '2026-03-16', '2026-03-16');
    assert.equal(next.totales.prospectos, 0);
  });
});
