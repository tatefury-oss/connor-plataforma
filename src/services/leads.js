// CRM Lite: captura, deduplicación, Round Robin, seguimiento y alcance por rol.
import { many, one, tx } from '../db.js';
import { can } from '../security/rbac.js';
import { audit } from './audit.js';
import { notifyRoles, notifyUser } from './realtime.js';

export const STAGES = {
  nuevo: 'Nuevo prospecto',
  contactado: 'Contactado',
  interesado: 'Interesado',
  cita: 'Cita',
  negociacion: 'Negociación',
  venta: 'Venta',
  cliente: 'Cliente',
  perdido: 'Perdido',
};

export const SOURCES = {
  web: 'Sitio web',
  whatsapp: 'WhatsApp',
  telefono: 'Llamada',
  referido: 'Referido',
  redes: 'Redes sociales',
  visita: 'Visita en sitio',
  otro: 'Otro',
};

export const ACTIVITY_TYPES = {
  nota: 'Nota interna',
  llamada: 'Llamada',
  whatsapp: 'WhatsApp',
  email: 'Correo',
  cita: 'Cita',
  formulario: 'Formulario web',
  etapa: 'Cambio de etapa',
  asignacion: 'Asignación',
  sistema: 'Sistema',
};

// Tipos que cuentan como "primer contacto" para medir tiempo de respuesta.
const CONTACT_TYPES = new Set(['llamada', 'whatsapp', 'email', 'cita']);

/**
 * Normaliza a dígitos con código de país (E.164 sin '+').
 * country: '52' (México) o '1' (EE. UU.). WhatsApp ya entrega el número completo.
 */
export function normalizePhone(phone, country = '52') {
  let d = String(phone ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 10) d = country + d;
  // Formato antiguo de celulares mexicanos en WhatsApp: 521 + 10 dígitos.
  if (d.length === 13 && d.startsWith('521')) d = '52' + d.slice(3);
  if (d.length < 11 || d.length > 15) return null;
  return d;
}

export function formatPhone(normalized) {
  if (!normalized) return '';
  if (normalized.startsWith('52') && normalized.length === 12) {
    const n = normalized.slice(2);
    return `+52 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  if (normalized.startsWith('1') && normalized.length === 11) {
    const n = normalized.slice(1);
    return `+1 (${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}`;
  }
  return `+${normalized}`;
}

/** Elige al siguiente asesor activo y disponible. Debe llamarse dentro de una transacción. */
export async function nextAdvisor(db) {
  const state = (await db.query('SELECT last_user_id FROM routing_state WHERE id = 1 FOR UPDATE')).rows[0];
  const { rows: advisors } = await db.query(
    `SELECT id, name FROM users WHERE role = 'asesor' AND active AND available ORDER BY id`,
  );
  if (!advisors.length) return null;
  const last = Number(state?.last_user_id ?? 0);
  const next = advisors.find((a) => Number(a.id) > last) ?? advisors[0];
  await db.query('UPDATE routing_state SET last_user_id = $1 WHERE id = 1', [next.id]);
  return next;
}

async function assign(db, { leadId, fromUser, toUser, reason, assignedBy = null, note = null }) {
  await db.query(
    `UPDATE leads SET assigned_to = $2, assigned_at = CASE WHEN $2::bigint IS NULL THEN NULL ELSE now() END,
            escalated_at = NULL, updated_at = now() WHERE id = $1`,
    [leadId, toUser],
  );
  await db.query(
    `INSERT INTO lead_assignments (lead_id, from_user, to_user, reason, assigned_by, note) VALUES ($1, $2, $3, $4, $5, $6)`,
    [leadId, fromUser, toUser, reason, assignedBy, note],
  );
}

async function addActivityRow(db, leadId, userId, type, body) {
  await db.query('INSERT INTO lead_activities (lead_id, user_id, type, body) VALUES ($1, $2, $3, $4)', [leadId, userId, type, body]);
}

/**
 * Registra un prospecto desde cualquier canal (web, WhatsApp, captura manual).
 * Si el teléfono ya existe, se reconoce como prospecto/cliente existente y se conserva su asesor.
 */
export async function captureLead(input, { req = null, actor = null } = {}) {
  const phoneNormalized = normalizePhone(input.phone, input.country);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const lead = await tx((db) => captureInTx(db, input, phoneNormalized, { req, actor }));
      notifyCaptured(lead, input.source);
      return lead;
    } catch (err) {
      // Dos solicitudes simultáneas con el mismo teléfono: reintentar y caer en "existente".
      if (err.code === '23505' && attempt < 2) continue;
      throw err;
    }
  }
}

async function captureInTx(db, input, phoneNormalized, { req, actor }) {
  const summary = [input.message, input.visitDate ? `Fecha preferida de visita: ${input.visitDate}` : null]
    .filter(Boolean).join('\n');
  const activityType = input.wantsVisit ? 'cita' : input.source === 'whatsapp' ? 'whatsapp' : 'formulario';

  let existing = null;
  if (phoneNormalized) {
    existing = (await db.query('SELECT * FROM leads WHERE phone_normalized = $1 FOR UPDATE', [phoneNormalized])).rows[0];
  }

  if (existing) {
    await db.query(
      `UPDATE leads SET email = COALESCE(email, $2), development_id = COALESCE($3, development_id),
              budget = COALESCE(budget, $4), updated_at = now(),
              stage = CASE WHEN stage = 'perdido' THEN 'nuevo' ELSE stage END
        WHERE id = $1`,
      [existing.id, input.email || null, input.developmentId || null, input.budget || null],
    );
    await addActivityRow(db, existing.id, actor?.id ?? null, activityType,
      `Nuevo contacto por ${SOURCES[input.source] ?? input.source} (prospecto existente).${summary ? `\n${summary}` : ''}`);

    // Si su asesor ya no está activo, se redistribuye.
    let assignedTo = existing.assigned_to;
    if (assignedTo) {
      const owner = (await db.query('SELECT active FROM users WHERE id = $1', [assignedTo])).rows[0];
      if (!owner?.active) assignedTo = null;
    }
    if (!assignedTo) {
      const advisor = await nextAdvisor(db);
      await assign(db, { leadId: existing.id, fromUser: existing.assigned_to, toUser: advisor?.id ?? null,
        reason: advisor ? 'round_robin' : 'sin_asesores' });
      assignedTo = advisor?.id ?? null;
    }
    await audit({ db, req, userId: actor?.id, action: 'lead.recontact', entity: 'lead', entityId: existing.id, details: { source: input.source } });
    return { id: existing.id, name: existing.name, assigned_to: assignedTo, existing: true };
  }

  const { rows: [lead] } = await db.query(
    `INSERT INTO leads (name, phone, phone_normalized, email, source, development_id, budget, tags, privacy_consent_at, next_contact_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, CASE WHEN $9 THEN now() END, $10)
     RETURNING id, name`,
    [input.name, phoneNormalized ? formatPhone(phoneNormalized) : null, phoneNormalized, input.email || null,
      input.source, input.developmentId || null, input.budget || null, input.tags ?? [], Boolean(input.consent),
      input.nextContactAt || null],
  );
  if (summary) await addActivityRow(db, lead.id, actor?.id ?? null, activityType, summary);

  let advisor;
  let reason;
  if (actor && actor.role === 'asesor') {
    advisor = actor; reason = 'manual';
  } else if (actor && input.assignTo) {
    advisor = (await db.query(`SELECT id, name FROM users WHERE id = $1 AND role = 'asesor' AND active`, [input.assignTo])).rows[0];
    reason = 'manual';
  }
  if (!advisor) {
    advisor = await nextAdvisor(db);
    reason = advisor ? 'round_robin' : 'sin_asesores';
  }
  await assign(db, { leadId: lead.id, fromUser: null, toUser: advisor?.id ?? null, reason, assignedBy: actor?.id ?? null });
  await addActivityRow(db, lead.id, null, 'asignacion',
    advisor ? `Asignado a ${advisor.name} (${reason === 'round_robin' ? 'Round Robin' : 'captura manual'}).` : 'Sin asesores disponibles: requiere asignación de un administrador.');
  await audit({ db, req, userId: actor?.id, action: 'lead.create', entity: 'lead', entityId: lead.id, details: { source: input.source, assigned_to: advisor?.id ?? null, reason } });

  return { ...lead, assigned_to: advisor?.id ?? null, existing: false };
}

// Se notifica después del COMMIT para que el receptor ya pueda leer el registro.
function notifyCaptured(lead, source) {
  const payload = { id: lead.id, name: lead.name, source, existing: lead.existing };
  if (lead.assigned_to) notifyUser(lead.assigned_to, 'lead:assigned', payload);
  notifyRoles(['admin', 'gerencia'], lead.assigned_to ? 'lead:new' : 'lead:unassigned', payload);
}

// ---------- Consultas con alcance por rol ----------

function scope(user, params) {
  if (can(user, 'leads.view_all')) return 'TRUE';
  if (can(user, 'leads.view_own')) { params.push(user.id); return `l.assigned_to = $${params.length}`; }
  return 'FALSE';
}

export async function listLeads(user, f = {}, { limit = 50, offset = 0 } = {}) {
  const params = [];
  const where = [scope(user, params)];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.stage && STAGES[f.stage]) add('l.stage = ?', f.stage);
  if (f.source && SOURCES[f.source]) add('l.source = ?', f.source);
  if (f.development) add('l.development_id = ?', Number(f.development) || 0);
  if (f.advisor && can(user, 'leads.view_all')) {
    if (f.advisor === 'none') where.push('l.assigned_to IS NULL');
    else add('l.assigned_to = ?', Number(f.advisor) || 0);
  }
  if (f.tag) add('? = ANY(l.tags)', String(f.tag).toLowerCase());
  if (f.followup === 'overdue') where.push(`l.next_contact_at < now() AND l.stage NOT IN ('cliente','perdido')`);
  if (f.followup === 'none') where.push(`l.next_contact_at IS NULL AND l.stage NOT IN ('cliente','perdido')`);
  if (f.escalated) where.push('l.escalated_at IS NOT NULL');
  if (f.q) {
    const q = `%${String(f.q).trim().replace(/[\\%_]/g, (c) => '\\' + c)}%`;
    params.push(q);
    const p = `$${params.length}`;
    const digits = String(f.q).replace(/\D/g, '');
    let phoneClause = '';
    if (digits.length >= 4) { params.push(`%${digits}%`); phoneClause = ` OR l.phone_normalized LIKE $${params.length}`; }
    where.push(`(l.name ILIKE ${p} OR l.email ILIKE ${p}${phoneClause})`);
  }
  const whereSql = where.join(' AND ');
  const total = (await one(`SELECT count(*)::int AS n FROM leads l WHERE ${whereSql}`, params)).n;
  params.push(limit, offset);
  const rows = await many(
    `SELECT l.*, d.name AS development_name, u.name AS advisor_name
       FROM leads l
       LEFT JOIN developments d ON d.id = l.development_id
       LEFT JOIN users u ON u.id = l.assigned_to
      WHERE ${whereSql}
      ORDER BY l.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { rows, total };
}

export async function getLead(user, id) {
  const params = [Number(id) || 0];
  const s = scope(user, params);
  return one(
    `SELECT l.*, d.name AS development_name, u.name AS advisor_name
       FROM leads l
       LEFT JOIN developments d ON d.id = l.development_id
       LEFT JOIN users u ON u.id = l.assigned_to
      WHERE l.id = $1 AND ${s}`,
    params,
  );
}

export function activitiesFor(leadId) {
  return many(
    `SELECT a.*, u.name AS user_name FROM lead_activities a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.lead_id = $1 ORDER BY a.created_at DESC, a.id DESC`,
    [leadId],
  );
}

export function assignmentsFor(leadId) {
  return many(
    `SELECT a.*, f.name AS from_name, t.name AS to_name, b.name AS by_name
       FROM lead_assignments a
       LEFT JOIN users f ON f.id = a.from_user
       LEFT JOIN users t ON t.id = a.to_user
       LEFT JOIN users b ON b.id = a.assigned_by
      WHERE a.lead_id = $1 ORDER BY a.created_at, a.id`,
    [leadId],
  );
}

export async function updateLead(user, id, fields, req) {
  const lead = await getLead(user, id);
  if (!lead) return null;
  return tx(async (db) => {
    const changes = {};
    const sets = [];
    const params = [lead.id];
    const set = (col, value) => {
      const before = lead[col] instanceof Date ? lead[col].toISOString() : lead[col];
      const after = value instanceof Date ? value.toISOString() : value;
      if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) return;
      params.push(value);
      sets.push(`${col} = $${params.length}`);
      changes[col] = { from: before ?? null, to: after ?? null };
    };
    for (const col of ['name', 'email', 'budget', 'stage', 'development_id', 'next_contact_at', 'tags']) {
      if (col in fields) set(col, fields[col]);
    }
    if ('phone' in fields) {
      const n = normalizePhone(fields.phone, fields.country);
      set('phone_normalized', n);
      set('phone', n ? formatPhone(n) : null);
    }
    if (!sets.length) return lead;
    if (changes.stage && lead.assigned_to === user.id && !lead.first_response_at) sets.push('first_response_at = now()');
    await db.query(`UPDATE leads SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, params);
    if (changes.stage) {
      await addActivityRow(db, lead.id, user.id, 'etapa', `${STAGES[changes.stage.from]} → ${STAGES[changes.stage.to]}`);
    }
    await audit({ db, req, action: 'lead.update', entity: 'lead', entityId: lead.id, details: changes });
    return { ...lead, ...fields };
  });
}

export async function addActivity(user, id, { type, body, nextContactAt }, req) {
  const lead = await getLead(user, id);
  if (!lead) return null;
  await tx(async (db) => {
    await addActivityRow(db, lead.id, user.id, type, body);
    if (CONTACT_TYPES.has(type) && lead.assigned_to === user.id && !lead.first_response_at) {
      await db.query('UPDATE leads SET first_response_at = now() WHERE id = $1', [lead.id]);
    }
    if (CONTACT_TYPES.has(type) && lead.stage === 'nuevo') {
      await db.query(`UPDATE leads SET stage = 'contactado' WHERE id = $1`, [lead.id]);
      await addActivityRow(db, lead.id, user.id, 'etapa', `${STAGES.nuevo} → ${STAGES.contactado}`);
    }
    if (nextContactAt !== undefined) {
      await db.query('UPDATE leads SET next_contact_at = $2, updated_at = now() WHERE id = $1', [lead.id, nextContactAt]);
    }
    await audit({ db, req, action: 'lead.activity', entity: 'lead', entityId: lead.id, details: { type } });
  });
  return lead;
}

export async function reassignLead(user, id, toUserId, note, req) {
  if (!can(user, 'leads.reassign')) return { error: 'forbidden' };
  const lead = await getLead(user, id);
  if (!lead) return { error: 'not_found' };
  const target = await one(`SELECT id, name FROM users WHERE id = $1 AND role = 'asesor' AND active`, [Number(toUserId) || 0]);
  if (!target) return { error: 'invalid_target' };
  if (target.id === lead.assigned_to) return { lead };
  await tx(async (db) => {
    await assign(db, { leadId: lead.id, fromUser: lead.assigned_to, toUser: target.id, reason: 'reasignacion', assignedBy: user.id, note });
    await addActivityRow(db, lead.id, user.id, 'asignacion',
      `Reasignado de ${lead.advisor_name ?? 'sin asesor'} a ${target.name}.${note ? ` Motivo: ${note}` : ''}`);
    await audit({ db, req, action: 'lead.reassign', entity: 'lead', entityId: lead.id, details: { from: lead.assigned_to, to: target.id, note } });
  });
  notifyUser(target.id, 'lead:assigned', { id: lead.id, name: lead.name, source: 'reasignacion' });
  return { lead };
}

export async function escalateLead(user, id, note, req) {
  const lead = await getLead(user, id);
  if (!lead) return null;
  await tx(async (db) => {
    await db.query('UPDATE leads SET escalated_at = now() WHERE id = $1', [lead.id]);
    await db.query(
      `INSERT INTO lead_assignments (lead_id, from_user, to_user, reason, assigned_by, note) VALUES ($1, $2, $2, 'escalamiento', $3, $4)`,
      [lead.id, lead.assigned_to, user.id, note],
    );
    await addActivityRow(db, lead.id, user.id, 'sistema', `Escalado a administración.${note ? ` Motivo: ${note}` : ''}`);
    await audit({ db, req, action: 'lead.escalate', entity: 'lead', entityId: lead.id, details: { note } });
  });
  notifyRoles(['admin', 'gerencia'], 'lead:escalated', { id: lead.id, name: lead.name });
  return lead;
}

export function activeAdvisors() {
  return many(`SELECT id, name, available FROM users WHERE role = 'asesor' AND active ORDER BY name`);
}
