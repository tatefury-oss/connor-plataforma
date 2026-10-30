// Puente entre los servicios y Socket.IO; el servidor registra la instancia al arrancar.
// Los eventos importantes además se guardan como notificaciones, para verlas después en cualquier dispositivo.
import { query } from '../db.js';

let io = null;

export function setIo(instance) { io = instance; }

const PERSISTENT = {
  'lead:assigned': (p) => ({ title: 'Prospecto asignado a ti', body: p.name, url: `/admin/prospectos/${p.id}` }),
  'lead:unassigned': (p) => ({ title: 'Prospecto sin asignar', body: `${p.name}: no había asesores disponibles.`, url: `/admin/prospectos/${p.id}` }),
  'lead:escalated': (p) => ({ title: 'Prospecto escalado a administración', body: p.name, url: `/admin/prospectos/${p.id}` }),
  'lead:handoff': (p) => ({ title: 'El asistente de WhatsApp transfirió una conversación', body: `${p.name}${p.motivo ? `: ${p.motivo}` : ''}`, url: `/admin/prospectos/${p.id}` }),
  'lead:visit': (p) => ({ title: 'Solicitud de visita por WhatsApp', body: `${p.name}${p.fecha ? ` · ${p.fecha}` : ''}`, url: `/admin/prospectos/${p.id}` }),
  'lot:expired': (p) => ({ title: 'Venció un apartado', body: `El lote ${p.code} volvió a estar disponible.`, url: `/admin/lotes/${p.id}` }),
};

const pending = new Set();
function track(promise) {
  const p = promise.catch((err) => console.error('[notificaciones]', err.message)).finally(() => pending.delete(p));
  pending.add(p);
}
// Espera a que terminen de guardarse las notificaciones en curso (pruebas y apagado del servidor).
export const flushNotifications = () => Promise.all([...pending]);

async function persist(userIds, event, payload) {
  const build = PERSISTENT[event];
  if (!build || !userIds.length) return;
  const n = build(payload);
  const { rows } = await query(
    `INSERT INTO notifications (user_id, type, title, body, url)
     SELECT u, $2, $3, $4, $5 FROM unnest($1::bigint[]) AS u
     RETURNING id, user_id`,
    [userIds, event, n.title, n.body.slice(0, 500), n.url ?? null],
  );
  for (const r of rows) io?.to(`user:${r.user_id}`).emit('notification:new', { id: r.id, ...n });
}

export function notifyUser(userId, event, payload) {
  if (!userId) return;
  io?.to(`user:${userId}`).emit(event, payload);
  if (PERSISTENT[event]) track(persist([userId], event, payload));
}

export function notifyRoles(roles, event, payload) {
  io?.to(roles.map((r) => `role:${r}`)).emit(event, payload);
  if (PERSISTENT[event]) {
    track(query(`SELECT id FROM users WHERE active AND role = ANY($1)`, [roles])
      .then(({ rows }) => persist(rows.map((r) => r.id), event, payload)));
  }
}

// Eventos del chat: solo en tiempo real (los mensajes ya viven en su propia tabla).
export function emitToUsers(userIds, event, payload) {
  if (!io) return;
  for (const id of userIds) io.to(`user:${id}`).emit(event, payload);
}
