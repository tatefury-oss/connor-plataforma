import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { one, query } from '../src/db.js';
import { handleInbound, setBotClient, systemPrompt } from '../src/services/bot.js';
import { listPublished } from '../src/services/developments.js';
import { getSettings } from '../src/services/settings.js';
import { handleWebhook, sendText } from '../src/services/whatsapp.js';
import { setup } from './helpers.js';

let ctx;
let replies; // respuestas simuladas de Claude, en orden
let calls; // solicitudes recibidas por el cliente simulado
let sent; // mensajes enviados a la Graph API de Meta

const realFetch = globalThis.fetch;
before(async () => {
  ctx = await setup();
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://graph.facebook.com/')) {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ messages: [{ id: `wamid.out.${++outSeq}` }] }), { status: 200 });
    }
    return realFetch(url, init);
  };
  setBotClient({
    beta: {
      messages: {
        create: async (params) => {
          calls.push(structuredClone(params));
          const next = replies.shift();
          if (!next) throw new Error('sin respuesta simulada');
          if (next instanceof Error) throw next;
          return { usage: { input_tokens: 100, output_tokens: 20 }, ...next };
        },
      },
    },
  });
});
after(async () => { globalThis.fetch = realFetch; await ctx.close(); });
beforeEach(() => { replies = []; calls = []; sent = []; });

const text = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: t }] });
const tool = (name, input, id = 'tu_1') => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', id, name, input }] });

let seq = 0;
let outSeq = 0;
async function inbound(phone, body, name = 'Cliente WA') {
  seq++;
  await handleWebhook({ entry: [{ changes: [{ value: {
    contacts: [{ wa_id: phone, profile: { name } }],
    messages: [{ id: `wamid.in.${seq}`, from: phone, type: 'text', text: { body } }],
  } }] }] });
  return one('SELECT * FROM leads WHERE phone_normalized = $1', [phone.replace(/^521/, '52')]);
}

describe('asistente virtual de WhatsApp', () => {
  test('responde con el catálogo autorizado y deja el mensaje en el CRM', async () => {
    const lead = await inbound('5216640001001', '¿Cuánto cuesta Valle del Borrego?');
    replies.push(text('Valle del Borrego tiene lotes de 250 m² con enganche de $2,700 MXN.'));
    const r = await handleInbound({ leadId: lead.id });
    assert.equal(r.status, 'respondio');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, '526640001001');
    const out = await one(`SELECT * FROM wa_messages WHERE lead_id = $1 AND direction = 'out'`, [lead.id]);
    assert.ok(out.sent_by_bot);
    const req = calls[0];
    assert.equal(req.model, 'claude-opus-5-5');
    assert.equal(req.fallbacks, 'default');
    assert.match(req.system[0].text, /Valle del Borrego/);
    assert.equal(req.messages.at(-1).role, 'user');
  });

  test('registra presupuesto, desarrollo y solicitud de visita con herramientas', async () => {
    const lead = await inbound('5216640001002', 'Me llamo Laura, tengo 300 mil y quiero ir a ver Los Pinos el sábado');
    replies.push(
      tool('registrar_datos', { nombre: 'Laura Méndez', presupuesto: '$300,000 MXN', desarrollo: 'los-pinos', quiere_visita: true, fecha_visita: 'sábado' }),
      text('¡Perfecto, Laura! Un asesor te confirmará la visita del sábado.'),
    );
    assert.equal((await handleInbound({ leadId: lead.id })).status, 'respondio');
    const updated = await one('SELECT l.*, d.slug FROM leads l JOIN developments d ON d.id = l.development_id WHERE l.id = $1', [lead.id]);
    assert.equal(updated.name, 'Laura Méndez');
    assert.equal(updated.budget, '$300,000 MXN');
    assert.equal(updated.slug, 'los-pinos');
    const visit = await one(`SELECT body FROM lead_activities WHERE lead_id = $1 AND type = 'cita'`, [lead.id]);
    assert.match(visit.body, /sábado/);
    // La segunda llamada recibe el resultado de la herramienta.
    const toolResult = calls[1].messages.at(-1).content[0];
    assert.equal(toolResult.type, 'tool_result');
    assert.equal(toolResult.tool_use_id, 'tu_1');
  });

  test('transfiere a un asesor y deja de responder', async () => {
    const lead = await inbound('5216640001003', 'Quiero apartar un lote hoy');
    replies.push(tool('transferir_a_asesor', { motivo: 'Quiere apartar un lote' }), text('Te comunico con un asesor.'));
    assert.equal((await handleInbound({ leadId: lead.id })).status, 'transferido');
    const after_ = await one('SELECT bot_paused_at, bot_pause_reason FROM leads WHERE id = $1', [lead.id]);
    assert.ok(after_.bot_paused_at);
    assert.equal(after_.bot_pause_reason, 'Quiere apartar un lote');
    assert.equal(sent.length, 1);

    await inbound('5216640001003', '¿Hola?');
    assert.equal((await handleInbound({ leadId: lead.id })).status, 'omitido');
    assert.equal(calls.length, 2, 'no vuelve a llamar al modelo');
  });

  test('si el modelo declina o falla, pasa la conversación a un humano sin responder', async () => {
    const a = await inbound('5216640001004', 'mensaje');
    replies.push({ stop_reason: 'refusal', stop_details: { category: 'cyber' }, content: [] });
    assert.equal((await handleInbound({ leadId: a.id })).status, 'rechazado');
    const b = await inbound('5216640001005', 'mensaje');
    replies.push(new Error('timeout'));
    assert.equal((await handleInbound({ leadId: b.id })).status, 'error');
    assert.equal(sent.length, 0);
    for (const id of [a.id, b.id]) assert.ok((await one('SELECT bot_paused_at FROM leads WHERE id = $1', [id])).bot_paused_at);
    const { n } = await one(`SELECT count(*)::int AS n FROM bot_runs WHERE lead_id IN ($1, $2) AND status IN ('rechazado','error')`, [a.id, b.id]);
    assert.equal(n, 2);
  });

  test('cuando un asesor responde, el asistente se retira', async () => {
    const lead = await inbound('5216640001006', 'Hola');
    const full = await one('SELECT * FROM leads WHERE id = $1', [lead.id]);
    assert.ok((await sendText({ lead: full, body: 'Hola, soy tu asesora', user: { id: ctx.users.ana } })).ok);
    await inbound('5216640001006', 'Gracias');
    assert.equal((await handleInbound({ leadId: lead.id })).status, 'omitido');
    assert.equal(calls.length, 0);
  });

  test('respeta el interruptor del panel', async () => {
    await query(`UPDATE settings SET value = '0' WHERE key = 'bot_enabled'`);
    const lead = await inbound('5216640001007', 'Hola');
    assert.equal((await handleInbound({ leadId: lead.id })).status, 'omitido');
    await query(`UPDATE settings SET value = '1' WHERE key = 'bot_enabled'`);
  });

  test('el prompt solo incluye desarrollos publicados y ningún dato de otros clientes', async () => {
    await query(`UPDATE developments SET published = false WHERE slug = 'vista-bonita'`);
    const prompt = systemPrompt(await getSettings(), await listPublished());
    assert.ok(!prompt.includes('Vista Bonita'));
    assert.ok(prompt.includes('Los Pinos'));
    assert.ok(!prompt.includes('Laura'));
    await query(`UPDATE developments SET published = true WHERE slug = 'vista-bonita'`);
  });

  test('varios mensajes seguidos producen una sola respuesta', async () => {
    const lead = await inbound('5216640001008', 'Hola');
    await inbound('5216640001008', '¿Tienen terrenos en La Rumorosa?');
    replies.push(text('Sí, tenemos Villas del Pedregal y Valle del Borrego.'));
    await Promise.all([handleInbound({ leadId: lead.id }), handleInbound({ leadId: lead.id })]);
    assert.equal(calls.length, 1);
    assert.equal(sent.length, 1);
    assert.match(calls[0].messages[0].content, /Hola\n¿Tienen terrenos/);
  });
});
