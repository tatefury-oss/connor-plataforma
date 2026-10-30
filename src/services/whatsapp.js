// WhatsApp Business Platform (Cloud API de Meta).
// Recepción: webhook con verificación de firma X-Hub-Signature-256.
// Envío: solo si existen WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_NUMBER_ID en el servidor.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config, whatsappSendEnabled } from '../config.js';
import { many, one, query } from '../db.js';
import { audit } from './audit.js';
import { captureLead } from './leads.js';
import { notifyRoles, notifyUser } from './realtime.js';

// Lo registra el servidor (asistente virtual); se ejecuta tras responder 200 a Meta.
let inboundHandler = null;
export function setInboundHandler(fn) { inboundHandler = fn; }

export function verifySignature(rawBody, header) {
  if (!config.whatsapp.appSecret || !header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', config.whatsapp.appSecret).update(rawBody).digest('hex');
  const given = header.slice(7);
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

function messageText(m) {
  switch (m.type) {
    case 'text': return m.text?.body ?? '';
    case 'button': return m.button?.text ?? '';
    case 'interactive': return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '';
    default: return `[${m.type}]`;
  }
}

export async function handleWebhook(payload) {
  const results = [];
  for (const entry of payload?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      const names = Object.fromEntries((value.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));

      for (const m of value.messages ?? []) {
        const body = messageText(m).slice(0, 4000);
        // Meta reintenta entregas: el id único evita duplicados.
        const inserted = await one(
          `INSERT INTO wa_messages (wa_message_id, direction, phone, body, status)
           VALUES ($1, 'in', $2, $3, 'received') ON CONFLICT (wa_message_id) DO NOTHING RETURNING id`,
          [m.id, m.from, body],
        );
        if (!inserted) continue;
        const lead = await captureLead({
          name: (names[m.from] || 'Contacto de WhatsApp').slice(0, 120),
          phone: m.from,
          source: 'whatsapp',
          message: body,
        });
        await query('UPDATE wa_messages SET lead_id = $2 WHERE id = $1', [inserted.id, lead.id]);
        const event = { leadId: lead.id, name: lead.name, body };
        if (lead.assigned_to) notifyUser(lead.assigned_to, 'wa:message', event);
        notifyRoles(['admin', 'gerencia'], 'wa:message', event);
        results.push(lead.id);
        if (inboundHandler) {
          setImmediate(() => Promise.resolve(inboundHandler({ leadId: lead.id, body }))
            .catch((err) => console.error('[bot] error al procesar mensaje', err)));
        }
      }

      for (const s of value.statuses ?? []) {
        await query('UPDATE wa_messages SET status = $2 WHERE wa_message_id = $1', [s.id, s.status]);
      }
    }
  }
  return results;
}

export function messagesFor(leadId) {
  return many(
    `SELECT w.*, u.name AS sent_by_name FROM wa_messages w LEFT JOIN users u ON u.id = w.sent_by
      WHERE w.lead_id = $1 ORDER BY w.created_at, w.id`,
    [leadId],
  );
}

// Envío de texto libre por la Cloud API. Solo es válido dentro de las 24 h del último mensaje del cliente.
export async function deliver({ leadId, phone, body, userId = null, bot = false }) {
  if (!whatsappSendEnabled()) return { ok: false, error: 'WhatsApp Business API no está configurada en el servidor.' };
  const { graphVersion, phoneNumberId, accessToken } = config.whatsapp;
  const res = await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Fuera de la ventana de 24 h Meta exige una plantilla aprobada (error 131047).
    return { ok: false, error: data?.error?.message || `Error de WhatsApp (${res.status})` };
  }
  const waId = data.messages?.[0]?.id ?? null;
  await query(
    `INSERT INTO wa_messages (wa_message_id, lead_id, direction, phone, body, status, sent_by, sent_by_bot)
     VALUES ($1, $2, 'out', $3, $4, 'sent', $5, $6)`,
    [waId, leadId, phone, body, userId, bot],
  );
  return { ok: true, waId };
}

export async function sendText({ lead, body, user, req }) {
  if (!lead.phone_normalized) return { ok: false, error: 'El prospecto no tiene teléfono registrado.' };
  const r = await deliver({ leadId: lead.id, phone: lead.phone_normalized, body, userId: user.id });
  if (!r.ok) return r;
  // Si un asesor responde, el asistente se retira de la conversación.
  await query(`UPDATE leads SET bot_paused_at = COALESCE(bot_paused_at, now()), bot_pause_reason = COALESCE(bot_pause_reason, 'Respondió un asesor') WHERE id = $1`, [lead.id]);
  await audit({ req, action: 'whatsapp.send', entity: 'lead', entityId: lead.id, details: { wa_message_id: r.waId } });
  return { ok: true };
}
