import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { one, query } from '../src/db.js';
import { commercialSummary, trends } from '../src/services/analytics.js';
import { ask, setAssistantClient, toolsFor } from '../src/services/assistant.js';
import { captureLead } from '../src/services/leads.js';
import { renderMarkdown } from '../src/views/markdown.js';
import { client, setup } from './helpers.js';

let ctx;
let users;
let replies;
let calls;
let leadAna;
let leadBeto;
const as = (key, role) => ({ id: users[key], role, name: key });
const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const tool = (name, input, id = 'tu_1') => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });
// Resultado de herramienta enviado en la última llamada al modelo.
const lastToolResult = () => calls.at(-1).messages.at(-1).content[0];

before(async () => {
  ctx = await setup();
  users = ctx.users;
  await query(`UPDATE users SET available = (id = $1) WHERE role = 'asesor'`, [users.ana]);
  leadAna = await captureLead({ name: 'Lucía de Ana', phone: '6648880001', source: 'web' });
  await query(`UPDATE users SET available = (id = $1) WHERE role = 'asesor'`, [users.beto]);
  leadBeto = await captureLead({ name: 'Jorge de Beto', phone: '6648880002', source: 'whatsapp' });
  await query(`UPDATE users SET available = true WHERE role = 'asesor'`);
  setAssistantClient({ beta: { messages: { create: async (params) => {
    calls.push(structuredClone(params));
    const next = replies.shift();
    if (!next) throw new Error('sin respuesta simulada');
    return { usage: { input_tokens: 50, output_tokens: 10 }, ...next };
  } } } });
});
after(async () => { await ctx.close(); });
beforeEach(() => { replies = []; calls = []; });

describe('herramientas según el rol', () => {
  test('cada rol recibe solo las herramientas que su permiso permite', () => {
    const names = (u) => toolsFor(u).map((t) => t.def.name);
    assert.ok(!names(as('fina', 'finanzas')).includes('buscar_prospectos'));
    assert.ok(names(as('fina', 'finanzas')).includes('consultar_cartera'));
    assert.ok(!names(as('fina', 'finanzas')).includes('consultar_proyectos'));
    assert.ok(names(as('ana', 'asesor')).includes('buscar_prospectos'));
    assert.equal(names(as('admin', 'admin')).length, 9);
  });

  test('un asesor solo obtiene sus propios prospectos', async () => {
    replies.push(tool('buscar_prospectos', { texto: '', etapa: '', fuente: '', limite: 50 }), text('Tienes 1 prospecto.'));
    const r = await ask(as('ana', 'asesor'), { text: '¿Qué prospectos tengo?' }, null);
    assert.equal(r.answer, 'Tienes 1 prospecto.');
    const result = JSON.parse(lastToolResult().content);
    assert.deepEqual(result.resultados.map((x) => x.nombre), ['Lucía de Ana']);
    assert.equal(calls[0].model, 'claude-opus-5-5');
    assert.ok(calls[0].tools.every((t) => t.strict === true));
  });

  test('no puede leer la ficha de un prospecto ajeno', async () => {
    replies.push(tool('ver_prospecto', { id: leadBeto.id }), text('No tengo acceso.'));
    await ask(as('ana', 'asesor'), { text: `Resume el prospecto ${leadBeto.id}` }, null);
    const res = lastToolResult();
    assert.equal(res.is_error, true);
    assert.ok(!res.content.includes('Jorge'));
  });

  test('una herramienta no autorizada para el rol se rechaza aunque el modelo la pida', async () => {
    replies.push(tool('buscar_prospectos', { texto: '', etapa: '', fuente: '', limite: 5 }), text('No disponible.'));
    await ask(as('fina', 'finanzas'), { text: 'Busca prospectos' }, null);
    const res = lastToolResult();
    assert.equal(res.is_error, true);
    assert.match(res.content, /no disponible/i);
    assert.ok(!calls[0].tools.some((t) => t.name === 'buscar_prospectos'));
  });

  test('crea recordatorios solo en el futuro y en prospectos propios', async () => {
    replies.push(tool('crear_recordatorio', { prospecto_id: leadAna.id, fecha_hora: '2999-01-10T10:00', nota: 'Enviar plano' }), text('Listo.'));
    await ask(as('ana', 'asesor'), { text: 'Recuérdame llamar a Lucía' }, null);
    assert.ok((await one('SELECT next_contact_at FROM leads WHERE id = $1', [leadAna.id])).next_contact_at);
    replies.push(tool('crear_recordatorio', { prospecto_id: leadBeto.id, fecha_hora: '2999-01-10T10:00', nota: 'x' }), text('No pude.'));
    await ask(as('ana', 'asesor'), { text: 'Recuérdame llamar a Jorge' }, null);
    assert.equal(lastToolResult().is_error, true);
    assert.equal((await one('SELECT next_contact_at FROM leads WHERE id = $1', [leadBeto.id])).next_contact_at, null);
    replies.push(tool('crear_recordatorio', { prospecto_id: leadAna.id, fecha_hora: '2020-01-10T10:00', nota: 'x' }), text('Fecha pasada.'));
    await ask(as('ana', 'asesor'), { text: 'Recordatorio ayer' }, null);
    assert.match(lastToolResult().content, /ya pasó/);
  });
});

describe('conversaciones', () => {
  test('el historial se reenvía sin alterarse y solo se agrega al final', async () => {
    replies.push(tool('prospectos_sin_seguimiento', { limite: 10 }), text('Hay pendientes.'));
    const first = await ask(as('gerente', 'gerencia'), { text: '¿Quién no tiene seguimiento?' }, null);
    replies.push(text('Sí.'));
    await ask(as('gerente', 'gerencia'), { conversationId: first.conversationId, text: '¿Seguro?' }, null);
    const firstTurn = [...calls[1].messages, { role: 'assistant', content: [{ type: 'text', text: 'Hay pendientes.' }] }];
    const replayed = calls[2].messages.slice(0, firstTurn.length);
    assert.deepEqual(replayed, firstTurn);
    assert.deepEqual(calls[2].messages.at(-1), { role: 'user', content: [{ type: 'text', text: '¿Seguro?' }] });
  });

  test('las conversaciones son privadas de cada usuario', async () => {
    replies.push(text('Hola.'));
    const r = await ask(as('ana', 'asesor'), { text: 'Hola' }, null);
    assert.equal((await ask(as('beto', 'asesor'), { conversationId: r.conversationId, text: 'Hola' }, null)).error, 'not_found');
    const beto = client(ctx.base);
    await beto.login('beto@test.local');
    assert.equal((await beto.req(`/admin/asistente/${r.conversationId}`)).status, 404);
  });

  test('si el modelo declina no se guarda el turno', async () => {
    replies.push({ stop_reason: 'refusal', stop_details: { category: null }, content: [] });
    const r = await ask(as('admin', 'admin'), { text: 'algo' }, null);
    assert.match(r.error, /no pudo responder/);
    const { n } = await one('SELECT count(*)::int AS n FROM assistant_messages WHERE conversation_id = $1', [r.conversationId]);
    assert.equal(n, 0);
  });

  test('las respuestas se muestran con markdown seguro', () => {
    const out = String(renderMarkdown('**Hola** <script>alert(1)</script>\n- uno\n- dos'));
    assert.ok(out.includes('<strong>Hola</strong>'));
    assert.ok(!out.includes('<script>'));
    assert.ok(out.includes('<ul><li>uno</li><li>dos</li></ul>'));
  });
});

describe('analítica', () => {
  test('los indicadores respetan el alcance del usuario', async () => {
    const mine = await commercialSummary(as('ana', 'asesor'));
    const all = await commercialSummary(as('gerente', 'gerencia'));
    assert.equal(mine.totales.prospectos, 1);
    assert.equal(all.totales.prospectos, 2);
    assert.equal(mine.por_asesor.length, 0);
    const t = await trends(as('ana', 'asesor'), 3);
    assert.equal(t.prospectos_por_mes.length, 3);
    assert.equal(t.prospectos_por_mes.at(-1).prospectos, 1);
    assert.equal((await trends(as('fina', 'finanzas'), 3)).prospectos_por_mes.at(-1).prospectos, 0);
  });

  test('la página de analítica es de gerencia y administración', async () => {
    const g = client(ctx.base);
    await g.login('gerente@test.local');
    const page = await g.req('/admin/analitica');
    assert.equal(page.status, 200);
    assert.match(page.text_, /Prospectos por mes/);
    const a = client(ctx.base);
    await a.login('ana@test.local');
    assert.equal((await a.req('/admin/analitica')).status, 403);
    assert.equal((await a.req('/admin/asistente')).status, 200);
  });
});
