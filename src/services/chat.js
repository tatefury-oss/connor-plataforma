// Fase 8 · Chat interno: mensajes directos y grupos de trabajo.
// Solo los miembros de un canal leen sus mensajes. Las referencias a prospectos, lotes, ventas o
// desarrollos se resuelven con los permisos de quien lee: si no tiene acceso, solo ve "restringido".
import { many, one, query, tx } from '../db.js';
import { can, canSeeFinance } from '../security/rbac.js';
import { getById as getDevelopment } from './developments.js';
import { getSale } from './finance.js';
import { getLot } from './inventory.js';
import { getLead } from './leads.js';
import { emitToUsers } from './realtime.js';

export const REF_TYPES = { lead: 'Prospecto', lot: 'Lote', sale: 'Venta', development: 'Desarrollo' };
const MAX_GROUP_MEMBERS = 50;
const MAX_MESSAGES_PER_MINUTE = 30;

class ChatError extends Error {}

/** Canales del usuario con conteo de no leídos y nombre visible. */
export function channelsFor(user) {
  return many(
    `SELECT c.id, c.kind, c.last_message_at,
            CASE WHEN c.kind = 'direct' THEN (SELECT u.name FROM chat_members m2 JOIN users u ON u.id = m2.user_id
                                               WHERE m2.channel_id = c.id AND m2.user_id <> $1 LIMIT 1)
                 ELSE c.name END AS title,
            (SELECT count(*)::int FROM chat_messages x WHERE x.channel_id = c.id AND x.id > m.last_read_id AND x.user_id IS DISTINCT FROM $1 AND x.deleted_at IS NULL) AS unread,
            (SELECT count(*)::int FROM chat_members m3 WHERE m3.channel_id = c.id) AS members
       FROM chat_channels c JOIN chat_members m ON m.channel_id = c.id AND m.user_id = $1
      ORDER BY c.last_message_at DESC`, [user.id]);
}

export async function unreadTotal(user) {
  return (await one(
    `SELECT count(*)::int AS n FROM chat_messages x JOIN chat_members m ON m.channel_id = x.channel_id AND m.user_id = $1
      WHERE x.id > m.last_read_id AND x.user_id IS DISTINCT FROM $1 AND x.deleted_at IS NULL`, [user.id])).n;
}

export const membership = (user, channelId) => one(
  `SELECT c.*, m.role AS my_role, m.last_read_id FROM chat_channels c JOIN chat_members m ON m.channel_id = c.id AND m.user_id = $2 WHERE c.id = $1`,
  [Number(channelId) || 0, user.id]);

export const membersOf = (channelId) => many(
  `SELECT u.id, u.name, u.role, u.active, m.role AS member_role FROM chat_members m JOIN users u ON u.id = m.user_id
    WHERE m.channel_id = $1 ORDER BY m.role = 'owner' DESC, u.name`, [channelId]);

export const directory = (user) => many(`SELECT id, name, role FROM users WHERE active AND id <> $1 ORDER BY name`, [user.id]);

export async function openDirect(user, otherId) {
  const other = await one('SELECT id, name FROM users WHERE id = $1 AND active', [Number(otherId) || 0]);
  if (!other || other.id === user.id) return { error: 'Usuario no válido.' };
  const key = [user.id, other.id].sort((a, b) => a - b).join(':');
  return tx(async (db) => {
    const existing = (await db.query('SELECT id FROM chat_channels WHERE direct_key = $1', [key])).rows[0];
    if (existing) return { id: existing.id };
    const { rows: [c] } = await db.query(
      `INSERT INTO chat_channels (kind, direct_key, created_by) VALUES ('direct', $1, $2) ON CONFLICT (direct_key) DO UPDATE SET direct_key = EXCLUDED.direct_key RETURNING id`,
      [key, user.id]);
    await db.query(`INSERT INTO chat_members (channel_id, user_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING`, [c.id, user.id, other.id]);
    return { id: c.id };
  });
}

async function systemMessage(db, channelId, text) {
  const { rows: [m] } = await db.query(`INSERT INTO chat_messages (channel_id, body, system) VALUES ($1, $2, true) RETURNING id`, [channelId, text]);
  await db.query('UPDATE chat_channels SET last_message_at = now() WHERE id = $1', [channelId]);
  return m.id;
}

export async function createGroup(user, name, memberIds) {
  const title = String(name ?? '').trim().slice(0, 80);
  if (title.length < 2) return { error: 'Escribe el nombre del grupo.' };
  const ids = [...new Set((Array.isArray(memberIds) ? memberIds : [memberIds]).map(Number).filter((n) => n && n !== user.id))];
  if (!ids.length) return { error: 'Agrega al menos a una persona.' };
  if (ids.length + 1 > MAX_GROUP_MEMBERS) return { error: `Máximo ${MAX_GROUP_MEMBERS} integrantes.` };
  const valid = (await many('SELECT id FROM users WHERE active AND id = ANY($1)', [ids])).map((r) => r.id);
  if (valid.length !== ids.length) return { error: 'Algún integrante no es válido o está inactivo.' };
  const id = await tx(async (db) => {
    const { rows: [c] } = await db.query(`INSERT INTO chat_channels (kind, name, created_by) VALUES ('group', $1, $2) RETURNING id`, [title, user.id]);
    await db.query(`INSERT INTO chat_members (channel_id, user_id, role) VALUES ($1, $2, 'owner')`, [c.id, user.id]);
    for (const m of valid) await db.query(`INSERT INTO chat_members (channel_id, user_id) VALUES ($1, $2)`, [c.id, m]);
    await systemMessage(db, c.id, `${user.name} creó el grupo "${title}".`);
    return c.id;
  });
  emitToUsers([user.id, ...valid], 'chat:channels', { channelId: id });
  return { id };
}

export async function addMembers(user, channelId, memberIds) {
  const ch = await membership(user, channelId);
  if (!ch) return { error: 'not_found' };
  if (ch.kind !== 'group' || ch.my_role !== 'owner') return { error: 'Solo quien administra el grupo puede agregar integrantes.' };
  const ids = [...new Set((Array.isArray(memberIds) ? memberIds : [memberIds]).map(Number).filter(Boolean))];
  const users = await many('SELECT id, name FROM users WHERE active AND id = ANY($1)', [ids]);
  const { n } = await one('SELECT count(*)::int AS n FROM chat_members WHERE channel_id = $1', [ch.id]);
  if (n + users.length > MAX_GROUP_MEMBERS) return { error: `Máximo ${MAX_GROUP_MEMBERS} integrantes.` };
  const added = await tx(async (db) => {
    const out = [];
    for (const u of users) {
      const r = await db.query('INSERT INTO chat_members (channel_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [ch.id, u.id]);
      if (r.rowCount) out.push(u);
    }
    if (out.length) await systemMessage(db, ch.id, `${user.name} agregó a ${out.map((u) => u.name).join(', ')}.`);
    return out;
  });
  emitToUsers((await membersOf(ch.id)).map((m) => m.id), 'chat:channels', { channelId: ch.id });
  return { added: added.length };
}

export async function removeMember(user, channelId, memberId) {
  const ch = await membership(user, channelId);
  if (!ch) return { error: 'not_found' };
  const target = Number(memberId) || 0;
  const leaving = target === user.id;
  if (ch.kind !== 'group') return { error: 'No se puede salir de un mensaje directo.' };
  if (!leaving && ch.my_role !== 'owner') return { error: 'Solo quien administra el grupo puede quitar integrantes.' };
  const who = await one('SELECT u.name, m.role FROM chat_members m JOIN users u ON u.id = m.user_id WHERE m.channel_id = $1 AND m.user_id = $2', [ch.id, target]);
  if (!who) return { error: 'No es integrante del grupo.' };
  await tx(async (db) => {
    await db.query('DELETE FROM chat_members WHERE channel_id = $1 AND user_id = $2', [ch.id, target]);
    // Si sale quien administra, el integrante más antiguo toma su lugar.
    if (who.role === 'owner') {
      await db.query(`UPDATE chat_members SET role = 'owner' WHERE (channel_id, user_id) =
        (SELECT channel_id, user_id FROM chat_members WHERE channel_id = $1 ORDER BY joined_at LIMIT 1)`, [ch.id]);
    }
    await systemMessage(db, ch.id, leaving ? `${who.name} salió del grupo.` : `${user.name} quitó a ${who.name}.`);
  });
  emitToUsers([target, ...(await membersOf(ch.id)).map((m) => m.id)], 'chat:channels', { channelId: ch.id });
  return { ok: true };
}

export async function renameGroup(user, channelId, name) {
  const ch = await membership(user, channelId);
  if (!ch) return { error: 'not_found' };
  const title = String(name ?? '').trim().slice(0, 80);
  if (ch.kind !== 'group' || ch.my_role !== 'owner' || title.length < 2) return { error: 'No se pudo cambiar el nombre.' };
  await tx(async (db) => {
    await db.query('UPDATE chat_channels SET name = $2 WHERE id = $1', [ch.id, title]);
    await systemMessage(db, ch.id, `${user.name} cambió el nombre del grupo a "${title}".`);
  });
  emitToUsers((await membersOf(ch.id)).map((m) => m.id), 'chat:channels', { channelId: ch.id });
  return { ok: true };
}

/** Verifica que quien comparte la referencia tenga acceso a ella. */
async function resolveRef(user, type, id) {
  const n = Number(id) || 0;
  switch (type) {
    case 'lead': { const l = await getLead(user, n); return l && { label: l.name, url: `/admin/prospectos/${l.id}` }; }
    case 'lot': {
      if (!can(user, 'inventory.view')) return null;
      const l = await getLot(n); return l && { label: `Lote ${l.code} · ${l.development_name}`, url: `/admin/lotes/${l.id}` };
    }
    case 'sale': { if (!canSeeFinance(user)) return null; const s = await getSale(user, n); return s && { label: `Venta #${s.id} · ${s.client_name}`, url: `/admin/finanzas/ventas/${s.id}` }; }
    case 'development': {
      if (!can(user, 'inventory.view') && !can(user, 'developments.manage')) return null;
      const d = await getDevelopment(n); return d && { label: d.name, url: can(user, 'inventory.view') ? `/admin/proyectos/${d.id}` : `/admin/desarrollos/${d.id}` };
    }
    default: return null;
  }
}

export function parseRef(value) {
  const m = /^(lead|lot|sale|development):(\d+)$/.exec(String(value ?? '').trim());
  return m ? { type: m[1], id: Number(m[2]) } : null;
}

export async function sendMessage(user, channelId, { body, ref }) {
  const ch = await membership(user, channelId);
  if (!ch) return { error: 'not_found' };
  const text = String(body ?? '').trim().slice(0, 4000);
  const reference = parseRef(ref);
  if (!text && !reference) return { error: 'Escribe un mensaje.' };
  if (reference && !(await resolveRef(user, reference.type, reference.id))) return { error: 'No tienes acceso a esa referencia o no existe.' };
  const { n } = await one(`SELECT count(*)::int AS n FROM chat_messages WHERE user_id = $1 AND created_at > now() - interval '1 minute'`, [user.id]);
  if (n >= MAX_MESSAGES_PER_MINUTE) return { error: 'Estás enviando mensajes muy rápido. Espera un momento.' };
  const msg = await tx(async (db) => {
    const { rows: [m] } = await db.query(
      `INSERT INTO chat_messages (channel_id, user_id, body, ref_type, ref_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
      [ch.id, user.id, text, reference?.type ?? null, reference?.id ?? null]);
    await db.query('UPDATE chat_channels SET last_message_at = now() WHERE id = $1', [ch.id]);
    await db.query('UPDATE chat_members SET last_read_id = $3 WHERE channel_id = $1 AND user_id = $2', [ch.id, user.id, m.id]);
    return m;
  });
  const members = (await membersOf(ch.id)).map((m) => m.id);
  // Solo se envía el aviso; cada cliente pide el contenido con sus propios permisos.
  emitToUsers(members, 'chat:message', { channelId: ch.id, messageId: msg.id, from: user.name, fromId: user.id,
    preview: ch.kind === 'direct' ? text.slice(0, 80) : `${ch.name}: ${text.slice(0, 70)}` });
  return { id: msg.id };
}

export async function deleteMessage(user, channelId, messageId) {
  const r = await query(
    `UPDATE chat_messages SET deleted_at = now(), body = '', ref_type = NULL, ref_id = NULL
      WHERE id = $1 AND channel_id = $2 AND user_id = $3 AND deleted_at IS NULL AND NOT system`,
    [Number(messageId) || 0, Number(channelId) || 0, user.id]);
  if (!r.rowCount) return { error: 'not_found' };
  emitToUsers((await membersOf(Number(channelId))).map((m) => m.id), 'chat:deleted', { channelId: Number(channelId), messageId: Number(messageId) });
  return { ok: true };
}

/** Mensajes de un canal para un lector, con las referencias resueltas según sus permisos. */
export async function messagesFor(user, channelId, { after = 0, limit = 100 } = {}) {
  const ch = await membership(user, channelId);
  if (!ch) return null;
  const rows = await many(
    `SELECT * FROM (SELECT x.*, u.name AS author FROM chat_messages x LEFT JOIN users u ON u.id = x.user_id
                     WHERE x.channel_id = $1 AND x.id > $2 ORDER BY x.id DESC LIMIT $3) t ORDER BY id`,
    [ch.id, Number(after) || 0, Math.min(limit, 200)]);
  for (const m of rows) {
    if (m.ref_type) m.ref = (await resolveRef(user, m.ref_type, m.ref_id)) ?? { label: `${REF_TYPES[m.ref_type]} restringido`, url: null };
  }
  return { channel: ch, messages: rows };
}

export async function markRead(user, channelId, upTo) {
  const r = await query(
    `UPDATE chat_members SET last_read_id = GREATEST(last_read_id, LEAST($3, (SELECT COALESCE(max(id), 0) FROM chat_messages WHERE channel_id = $1)))
      WHERE channel_id = $1 AND user_id = $2`, [Number(channelId) || 0, user.id, Number(upTo) || 0]);
  // Sincroniza el contador en los demás dispositivos del mismo usuario.
  if (r.rowCount) emitToUsers([user.id], 'chat:read', { channelId: Number(channelId) });
  return r.rowCount > 0;
}

// ---------- Notificaciones ----------
export const notificationsFor = (user, limit = 50) => many(
  'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2', [user.id, limit]);

export async function unreadNotifications(user) {
  return (await one('SELECT count(*)::int AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [user.id])).n;
}

export async function readNotification(user, id) {
  return one('UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2 RETURNING url', [Number(id) || 0, user.id]);
}

export async function readAllNotifications(user) {
  await query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [user.id]);
  emitToUsers([user.id], 'notification:read', {});
}
