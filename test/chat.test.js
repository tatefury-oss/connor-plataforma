import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { one, query } from '../src/db.js';
import {
  addMembers, channelsFor, createGroup, deleteMessage, markRead, messagesFor, openDirect, removeMember, sendMessage, unreadTotal,
} from '../src/services/chat.js';
import { captureLead, escalateLead } from '../src/services/leads.js';
import { flushNotifications } from '../src/services/realtime.js';
import { client, setup } from './helpers.js';

let ctx;
let users;
let leadAna;
const as = (key, role) => ({ id: users[key], role, name: key });
const ana = () => as('ana', 'asesor');
const beto = () => as('beto', 'asesor');
const gerente = () => as('gerente', 'gerencia');
const fina = () => as('fina', 'finanzas');

before(async () => {
  ctx = await setup();
  users = ctx.users;
  await query(`UPDATE users SET available = (id = $1) WHERE role = 'asesor'`, [users.ana]);
  leadAna = await captureLead({ name: 'Cliente Privado de Ana', phone: '6649990001', source: 'web' });
  await query(`UPDATE users SET available = true WHERE role = 'asesor'`);
});
after(async () => { await ctx.close(); });

describe('mensajes directos', () => {
  test('una sola conversación por pareja, en cualquier sentido', async () => {
    const a = await openDirect(ana(), users.beto);
    const b = await openDirect(beto(), users.ana);
    assert.equal(a.id, b.id);
    assert.equal((await openDirect(ana(), users.ana)).error, 'Usuario no válido.');
  });

  test('no leídos, lectura y privacidad', async () => {
    const { id } = await openDirect(ana(), users.beto);
    await sendMessage(ana(), id, { body: 'Hola Beto, ¿me cubres la visita del sábado?' });
    assert.equal(await unreadTotal(beto()), 1);
    assert.equal(await unreadTotal(ana()), 0, 'lo propio no cuenta como no leído');
    const data = await messagesFor(beto(), id);
    await markRead(beto(), id, data.messages.at(-1).id);
    assert.equal(await unreadTotal(beto()), 0);
    assert.equal(await messagesFor(gerente(), id), null, 'quien no es integrante no lo lee');
    assert.equal((await sendMessage(gerente(), id, { body: 'x' })).error, 'not_found');
  });

  test('solo el autor elimina su mensaje y queda la marca', async () => {
    const { id } = await openDirect(ana(), users.beto);
    const m = await sendMessage(ana(), id, { body: 'mensaje equivocado' });
    assert.equal((await deleteMessage(beto(), id, m.id)).error, 'not_found');
    assert.ok((await deleteMessage(ana(), id, m.id)).ok);
    const row = await one('SELECT body, deleted_at FROM chat_messages WHERE id = $1', [m.id]);
    assert.equal(row.body, '');
    assert.ok(row.deleted_at);
  });
});

describe('grupos de trabajo', () => {
  let groupId;

  test('crear, agregar, quitar y salir', async () => {
    const r = await createGroup(gerente(), 'Ventas La Rumorosa', [users.ana, users.beto]);
    groupId = r.id;
    assert.equal((await channelsFor(ana())).find((c) => c.id === groupId).title, 'Ventas La Rumorosa');
    assert.match((await addMembers(ana(), groupId, [users.fina])).error, /administra/);
    assert.equal((await addMembers(gerente(), groupId, [users.fina])).added, 1);
    assert.match((await removeMember(ana(), groupId, users.beto)).error, /administra/);
    assert.ok((await removeMember(beto(), groupId, users.beto)).ok, 'cualquiera puede salir');
    assert.equal(await messagesFor(beto(), groupId), null);
    const sys = await messagesFor(gerente(), groupId);
    assert.ok(sys.messages.some((m) => m.system && /salió/.test(m.body)));
  });

  test('si sale quien administra, otro integrante toma el lugar', async () => {
    assert.ok((await removeMember(gerente(), groupId, users.gerente)).ok);
    const owner = await one(`SELECT user_id FROM chat_members WHERE channel_id = $1 AND role = 'owner'`, [groupId]);
    assert.ok(owner);
  });

  test('referencias compartidas se muestran según los permisos de cada lector', async () => {
    const g = await createGroup(ana(), 'Equipo mixto', [users.beto, users.fina, users.gerente]);
    assert.ok((await sendMessage(ana(), g.id, { body: 'Revisen este cliente', ref: `lead:${leadAna.id}` })).id);
    const forGerente = (await messagesFor(gerente(), g.id)).messages.find((m) => m.ref_type);
    const forBeto = (await messagesFor(beto(), g.id)).messages.find((m) => m.ref_type);
    const forFina = (await messagesFor(fina(), g.id)).messages.find((m) => m.ref_type);
    assert.equal(forGerente.ref.label, 'Cliente Privado de Ana');
    assert.equal(forBeto.ref.url, null);
    assert.match(forBeto.ref.label, /restringido/);
    assert.ok(!JSON.stringify(forFina.ref).includes('Ana'));
    // No se puede compartir lo que uno mismo no puede ver.
    assert.match((await sendMessage(beto(), g.id, { body: 'x', ref: `lead:${leadAna.id}` })).error, /acceso/);
    assert.match((await sendMessage(fina(), g.id, { body: 'x', ref: 'lot:1' })).error, /acceso/);
  });

  test('el contenido de los mensajes se escapa en la página', async () => {
    const { id } = await openDirect(ana(), users.gerente);
    await sendMessage(ana(), id, { body: '<img src=x onerror=alert(1)>' });
    const g = client(ctx.base);
    await g.login('gerente@test.local');
    const page = await g.req(`/admin/chat/${id}`);
    assert.equal(page.status, 200);
    assert.ok(!page.text_.includes('<img src=x'));
    assert.equal((await g.req(`/admin/chat/${(await openDirect(ana(), users.beto)).id}`)).status, 404);
  });
});

describe('notificaciones persistentes', () => {
  test('los eventos importantes quedan guardados para cada destinatario', async () => {
    await escalateLead(ana(), leadAna.id, 'Pide descuento', null);
    await flushNotifications();
    const forAdmin = await one(`SELECT * FROM notifications WHERE user_id = $1 AND type = 'lead:escalated'`, [users.admin]);
    const forGerente = await one(`SELECT * FROM notifications WHERE user_id = $1 AND type = 'lead:escalated'`, [users.gerente]);
    assert.ok(forAdmin && forGerente);
    assert.equal(forAdmin.url, `/admin/prospectos/${leadAna.id}`);
    assert.ok(await one(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'lead:assigned'`, [users.ana]));
    assert.equal(await one(`SELECT 1 FROM notifications WHERE user_id = $1 AND type = 'lead:escalated'`, [users.beto]), null);
  });

  test('abrir una notificación la marca leída y solo redirige dentro del panel', async () => {
    const n = await one(`SELECT id FROM notifications WHERE user_id = $1 LIMIT 1`, [users.admin]);
    await query(`INSERT INTO notifications (user_id, type, title, url) VALUES ($1, 'x', 'externa', 'https://malicioso.example')`, [users.admin]);
    const evil = await one(`SELECT id FROM notifications WHERE url LIKE 'https%'`);
    const a = client(ctx.base);
    await a.login('admin@test.local');
    const r = await a.req(`/admin/notificaciones/${n.id}`);
    assert.equal(r.headers.get('location'), `/admin/prospectos/${leadAna.id}`);
    assert.ok((await one('SELECT read_at FROM notifications WHERE id = $1', [n.id])).read_at);
    assert.equal((await a.req(`/admin/notificaciones/${evil.id}`)).headers.get('location'), '/admin/notificaciones');
    const otherUser = await one(`SELECT id FROM notifications WHERE user_id = $1 LIMIT 1`, [users.gerente]);
    assert.equal((await a.req(`/admin/notificaciones/${otherUser.id}`)).status, 404);
    const counts = await (await a.req('/admin/chat/contadores', { headers: { accept: 'application/json' } })).text_;
    assert.ok('notifications' in JSON.parse(counts));
  });
});
