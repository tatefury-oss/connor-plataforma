import { Router } from 'express';
import { z } from 'zod';
import { whatsappSendEnabled } from '../../config.js';
import { many } from '../../db.js';
import { can, canSeeFinance, canSeeLeads, requirePermission } from '../../security/rbac.js';
import { audit } from '../../services/audit.js';
import {
  ACTIVITY_TYPES, SOURCES, STAGES, activeAdvisors, activitiesFor, addActivity, assignmentsFor, captureLead,
  escalateLead, getLead, listLeads, normalizePhone, reassignLead, updateLead,
} from '../../services/leads.js';
import { botConfigured, botRunsFor, setBotPaused } from '../../services/bot.js';
import { SALE_STATUS, salesForLead } from '../../services/finance.js';
import { LOT_STATUS, lotsForLead, money } from '../../services/inventory.js';
import { messagesFor, sendText } from '../../services/whatsapp.js';
import { fmtDate, fmtDateTime, fromLocalInput, html, toLocalInput } from '../../views/html.js';
import { adminPage, csrfField, pager } from '../../views/admin/layout.js';

const router = Router();
const PER_PAGE = 30;

const viewLeads = (req, res, next) => (canSeeLeads(req.user) ? next() : res.status(403).send('No tienes permiso para ver prospectos.'));
router.use('/admin/prospectos', viewLeads);
router.use('/admin/embudo', viewLeads);

const tagsFrom = (s) => [...new Set(String(s ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 15).map((t) => t.slice(0, 30));
const options = (map, selected, empty) => html`${empty ? html`<option value="">${empty}</option>` : ''}${Object.entries(map).map(([k, v]) => html`<option value="${k}" ${String(selected) === k ? 'selected' : ''}>${v}</option>`)}`;
const devOptions = (devs, selected, empty = 'Sin especificar') => html`<option value="">${empty}</option>${devs.map((d) => html`<option value="${d.id}" ${String(selected) === String(d.id) ? 'selected' : ''}>${d.name}</option>`)}`;
const stageBadge = (s) => html`<span class="stage s-${s}">${STAGES[s]}</span>`;
const back = (res, id, qs) => res.redirect(303, `/admin/prospectos/${id}${qs ? `?${qs}` : ''}`);
const errorQs = (msg) => `error=${encodeURIComponent(msg)}`;

// ---------- Listado ----------
router.get('/admin/prospectos', async (req, res) => {
  const f = req.query;
  const page = Math.max(1, Number(f.p) || 1);
  const [{ rows, total }, devs, advisors] = await Promise.all([
    listLeads(req.user, f, { limit: PER_PAGE, offset: (page - 1) * PER_PAGE }),
    many('SELECT id, name FROM developments ORDER BY sort_order, number'),
    can(req.user, 'leads.view_all') ? activeAdvisors() : [],
  ]);
  const query = Object.fromEntries(Object.entries(f).filter(([k, v]) => k !== 'p' && v));
  const body = html`
    <div class="toolbar">
      ${can(req.user, 'leads.create') ? html`<a class="btn" href="/admin/prospectos/nuevo">+ Registrar prospecto</a>` : ''}
      ${can(req.user, 'leads.export') ? html`<a class="btn ghost" href="/admin/prospectos.csv?${new URLSearchParams(query)}">Exportar CSV</a>` : ''}
    </div>
    <form class="filters" method="get">
      <label>Buscar<input name="q" value="${f.q ?? ''}" placeholder="Nombre, teléfono o correo"></label>
      <label>Etapa<select name="stage">${options(STAGES, f.stage, 'Todas')}</select></label>
      <label>Desarrollo<select name="development">${devOptions(devs, f.development, 'Todos')}</select></label>
      <label>Fuente<select name="source">${options(SOURCES, f.source, 'Todas')}</select></label>
      ${can(req.user, 'leads.view_all') ? html`<label>Asesor<select name="advisor"><option value="">Todos</option><option value="none" ${f.advisor === 'none' ? 'selected' : ''}>Sin asignar</option>${advisors.map((a) => html`<option value="${a.id}" ${String(f.advisor) === String(a.id) ? 'selected' : ''}>${a.name}</option>`)}</select></label>` : ''}
      <label>Seguimiento<select name="followup"><option value="">Todos</option><option value="overdue" ${f.followup === 'overdue' ? 'selected' : ''}>Vencidos</option><option value="none" ${f.followup === 'none' ? 'selected' : ''}>Sin fecha programada</option></select></label>
      <label>Etiqueta<input name="tag" value="${f.tag ?? ''}"></label>
      <button class="btn small" type="submit">Filtrar</button>
      <a class="btn ghost small" href="/admin/prospectos">Limpiar</a>
    </form>
    <section class="card flush">
      <table class="list" data-live-list>
        <thead><tr><th>Prospecto</th><th>Teléfono</th><th>Desarrollo</th><th>Fuente</th><th>Etapa</th><th>Asesor</th><th>Próximo contacto</th><th>Alta</th></tr></thead>
        <tbody>
          ${rows.map((l) => html`<tr class="${l.next_contact_at && new Date(l.next_contact_at) < new Date() && !['cliente', 'perdido'].includes(l.stage) ? 'late' : ''}">
            <td><a href="/admin/prospectos/${l.id}"><strong>${l.name}</strong></a>${l.escalated_at ? html` <span class="tag warn">Escalado</span>` : ''}${l.tags.map((t) => html` <span class="tag">${t}</span>`)}</td>
            <td>${l.phone ?? ''}</td><td>${l.development_name ?? '—'}</td><td>${SOURCES[l.source]}</td><td>${stageBadge(l.stage)}</td>
            <td>${l.advisor_name ?? html`<span class="tag warn">Sin asignar</span>`}</td>
            <td>${l.next_contact_at ? fmtDateTime(l.next_contact_at) : '—'}</td><td>${fmtDate(l.created_at)}</td></tr>`)}
        </tbody>
      </table>
      ${rows.length ? '' : html`<p class="muted pad">No hay prospectos con estos filtros.</p>`}
    </section>
    ${pager('/admin/prospectos', query, total, page, PER_PAGE)}`;
  res.send(String(adminPage({ req, title: 'Prospectos', active: '/admin/prospectos', body })));
});

router.get('/admin/prospectos.csv', requirePermission('leads.export'), async (req, res) => {
  const { rows } = await listLeads(req.user, req.query, { limit: 10000, offset: 0 });
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // evita inyección de fórmulas en Excel
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = [['ID', 'Nombre', 'Teléfono', 'Correo', 'Fuente', 'Desarrollo', 'Etapa', 'Asesor', 'Presupuesto', 'Etiquetas', 'Próximo contacto', 'Alta']]
    .concat(rows.map((l) => [l.id, l.name, l.phone, l.email, SOURCES[l.source], l.development_name, STAGES[l.stage], l.advisor_name, l.budget, l.tags.join(' '), l.next_contact_at?.toISOString(), l.created_at.toISOString()]));
  await audit({ req, action: 'lead.export', entity: 'lead', details: { count: rows.length, filters: req.query } });
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="prospectos-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send('﻿' + lines.map((r) => r.map(cell).join(',')).join('\r\n'));
});

// ---------- Embudo ----------
router.get('/admin/embudo', async (req, res) => {
  const { rows } = await listLeads(req.user, { development: req.query.development }, { limit: 1000, offset: 0 });
  const devs = await many('SELECT id, name FROM developments ORDER BY sort_order, number');
  const cols = Object.keys(STAGES).filter((s) => s !== 'perdido');
  const body = html`
    <form class="filters" method="get"><label>Desarrollo<select name="development" data-autosubmit>${devOptions(devs, req.query.development, 'Todos')}</select></label><noscript><button class="btn small">Filtrar</button></noscript></form>
    <div class="board">
      ${cols.map((stage) => {
        const items = rows.filter((l) => l.stage === stage);
        return html`<section class="col"><h2>${STAGES[stage]} <span>${items.length}</span></h2>
          ${items.map((l) => html`<a class="lead-card" href="/admin/prospectos/${l.id}"><strong>${l.name}</strong><span>${l.development_name ?? 'Sin desarrollo'}</span><small>${l.advisor_name ?? 'Sin asignar'}${l.next_contact_at ? ` · ${fmtDate(l.next_contact_at)}` : ''}</small></a>`)}
        </section>`;
      })}
    </div>`;
  res.send(String(adminPage({ req, title: 'Embudo comercial', active: '/admin/embudo', body })));
});

// ---------- Alta manual ----------
const manualSchema = z.object({
  name: z.string().trim().min(2).max(120),
  country: z.enum(['52', '1']).default('52'),
  phone: z.string().trim().max(20).default(''),
  email: z.union([z.literal(''), z.email().max(160)]).default(''),
  source: z.enum(Object.keys(SOURCES)),
  development_id: z.string().regex(/^\d*$/).default(''),
  budget: z.string().trim().max(60).default(''),
  tags: z.string().max(400).default(''),
  message: z.string().trim().max(4000).default(''),
  assign_to: z.string().regex(/^\d*$/).default(''),
});

router.get('/admin/prospectos/nuevo', requirePermission('leads.create'), async (req, res) => {
  const [devs, advisors] = await Promise.all([
    many('SELECT id, name FROM developments ORDER BY sort_order, number'),
    can(req.user, 'leads.reassign') ? activeAdvisors() : [],
  ]);
  const body = html`<form class="card form" method="post" action="/admin/prospectos">
    ${csrfField(req)}
    <div class="fields">
      <label class="wide">Nombre *<input name="name" required maxlength="120"></label>
      <label>País<select name="country"><option value="52">México (+52)</option><option value="1">EE. UU. (+1)</option></select></label>
      <label>Teléfono<input name="phone" type="tel" maxlength="20"></label>
      <label>Correo<input name="email" type="email" maxlength="160"></label>
      <label>Fuente *<select name="source" required>${options(SOURCES, 'telefono')}</select></label>
      <label>Desarrollo de interés<select name="development_id">${devOptions(devs)}</select></label>
      <label>Presupuesto<input name="budget" maxlength="60"></label>
      <label>Etiquetas<input name="tags" placeholder="inversionista, contado"></label>
      ${advisors.length ? html`<label>Asignar a<select name="assign_to"><option value="">Automático (Round Robin)</option>${advisors.map((a) => html`<option value="${a.id}">${a.name}</option>`)}</select></label>` : ''}
      <label class="wide">Nota inicial<textarea name="message" rows="3"></textarea></label>
    </div>
    <p class="muted">Si el teléfono ya existe se agregará el contacto al prospecto existente (no se duplica).</p>
    <button class="btn" type="submit">Guardar prospecto</button>
  </form>`;
  res.send(String(adminPage({ req, title: 'Registrar prospecto', active: '/admin/prospectos', body })));
});

router.post('/admin/prospectos', requirePermission('leads.create'), async (req, res) => {
  const parsed = manualSchema.safeParse(req.body);
  if (!parsed.success) return res.redirect(303, `/admin/prospectos/nuevo?${errorQs('Revisa los datos: nombre y fuente son obligatorios; el correo debe ser válido.')}`);
  const d = parsed.data;
  if (d.phone && !normalizePhone(d.phone, d.country)) return res.redirect(303, `/admin/prospectos/nuevo?${errorQs('Teléfono no válido.')}`);
  const lead = await captureLead({
    name: d.name, phone: d.phone, country: d.country, email: d.email, source: d.source,
    developmentId: Number(d.development_id) || null, budget: d.budget, tags: tagsFrom(d.tags), message: d.message,
    assignTo: can(req.user, 'leads.reassign') ? Number(d.assign_to) || null : null,
  }, { req, actor: req.user });
  // Un asesor podría coincidir con el teléfono de un prospecto ajeno: no se le revela.
  const visible = await getLead(req.user, lead.id);
  if (!visible) return res.redirect(303, `/admin/prospectos?${errorQs('Ese teléfono ya pertenece a un prospecto atendido por otro asesor. Se notificó el nuevo contacto.')}`);
  back(res, lead.id, lead.existing ? errorQs('El teléfono ya existía: se agregó el contacto al prospecto existente.') : 'msg=creado');
});

// ---------- Ficha ----------
router.get('/admin/prospectos/:id', async (req, res, next) => {
  const lead = await getLead(req.user, req.params.id);
  if (!lead) return next();
  const [activities, assignments, devs, advisors, wa, botRuns, leadLots, freeLots, sales] = await Promise.all([
    activitiesFor(lead.id), assignmentsFor(lead.id),
    many('SELECT id, name FROM developments ORDER BY sort_order, number'),
    can(req.user, 'leads.reassign') ? activeAdvisors() : [],
    messagesFor(lead.id),
    botRunsFor(lead.id),
    lotsForLead(lead.id),
    lead.development_id && can(req.user, 'inventory.reserve')
      ? many(`SELECT id, code, area_m2, price, currency FROM lots WHERE development_id = $1 AND status = 'disponible' ORDER BY block, length(number), number, code LIMIT 500`, [lead.development_id])
      : [],
    canSeeFinance(req.user) ? salesForLead(lead.id) : [],
  ]);
  const country = lead.phone_normalized?.startsWith('1') ? '1' : '52';
  const body = html`
    <div class="lead-head">
      <div><h2>${lead.name}</h2><p>${stageBadge(lead.stage)} · ${SOURCES[lead.source]} · Alta ${fmtDateTime(lead.created_at)}${lead.escalated_at ? html` · <span class="tag warn">Escalado ${fmtDateTime(lead.escalated_at)}</span>` : ''}</p></div>
      <div class="actions">
        <a class="btn ghost" href="/admin/chat?ref=lead:${lead.id}">Compartir en chat</a>
        ${lead.phone_normalized ? html`<a class="btn ghost" href="tel:+${lead.phone_normalized}">Llamar</a><a class="btn ghost" href="https://wa.me/${lead.phone_normalized}" target="_blank" rel="noopener">Abrir WhatsApp</a>` : ''}
        ${lead.email ? html`<a class="btn ghost" href="mailto:${lead.email}">Correo</a>` : ''}
      </div>
    </div>
    <div class="grid2">
      <form class="card form" method="post" action="/admin/prospectos/${lead.id}">
        ${csrfField(req)}
        <h2>Datos y etapa</h2>
        <div class="fields">
          <label class="wide">Nombre<input name="name" value="${lead.name}" required maxlength="120"></label>
          <label>País<select name="country"><option value="52" ${country === '52' ? 'selected' : ''}>México (+52)</option><option value="1" ${country === '1' ? 'selected' : ''}>EE. UU. (+1)</option></select></label>
          <label>Teléfono<input name="phone" value="${lead.phone ?? ''}" maxlength="20"></label>
          <label>Correo<input name="email" type="email" value="${lead.email ?? ''}" maxlength="160"></label>
          <label>Etapa<select name="stage">${options(STAGES, lead.stage)}</select></label>
          <label>Desarrollo<select name="development_id">${devOptions(devs, lead.development_id)}</select></label>
          <label>Presupuesto<input name="budget" value="${lead.budget ?? ''}" maxlength="60"></label>
          <label>Próximo contacto<input type="datetime-local" name="next_contact_at" value="${toLocalInput(lead.next_contact_at)}"></label>
          <label>Etiquetas<input name="tags" value="${lead.tags.join(', ')}"></label>
        </div>
        <button class="btn" type="submit">Guardar cambios</button>
      </form>

      <div class="stack">
        <section class="card"><h2>Asignación</h2>
          <p>Asesor responsable: <strong>${lead.advisor_name ?? 'Sin asignar'}</strong>${lead.assigned_at ? html` desde ${fmtDateTime(lead.assigned_at)}` : ''}</p>
          <p class="muted">Primera respuesta: ${lead.first_response_at ? fmtDateTime(lead.first_response_at) : 'pendiente'}</p>
          ${advisors.length ? html`<form class="inline" method="post" action="/admin/prospectos/${lead.id}/reasignar">${csrfField(req)}
            <select name="to" required><option value="">Reasignar a…</option>${advisors.filter((a) => a.id !== lead.assigned_to).map((a) => html`<option value="${a.id}">${a.name}${a.available ? '' : ' (no disponible)'}</option>`)}</select>
            <input name="note" placeholder="Motivo (obligatorio)" required maxlength="300">
            <button class="btn small" type="submit">Reasignar</button></form>` : ''}
          ${req.user.role === 'asesor' && !lead.escalated_at ? html`<form class="inline" method="post" action="/admin/prospectos/${lead.id}/escalar">${csrfField(req)}
            <input name="note" placeholder="¿Por qué se escala?" required maxlength="300"><button class="btn small ghost" type="submit">Escalar a administración</button></form>` : ''}
          <details><summary>Historial de asignaciones (${assignments.length})</summary><ul class="timeline small">
            ${assignments.map((a) => html`<li><time>${fmtDateTime(a.created_at)}</time> ${{ round_robin: 'Round Robin', manual: 'Captura manual', reasignacion: 'Reasignación', escalamiento: 'Escalamiento', sin_asesores: 'Sin asesores disponibles' }[a.reason]}: ${a.from_name ?? '—'} → ${a.to_name ?? '—'}${a.by_name ? ` (por ${a.by_name})` : ''}${a.note ? ` · ${a.note}` : ''}</li>`)}
          </ul></details>
        </section>

        <section class="card"><h2>WhatsApp</h2>
          <div class="bot-status">
            ${!botConfigured()
              ? html`<span class="muted">Asistente virtual sin configurar en el servidor.</span>`
              : lead.bot_paused_at
                ? html`<span><strong>Asistente en pausa</strong> desde ${fmtDateTime(lead.bot_paused_at)}${lead.bot_pause_reason ? html` · ${lead.bot_pause_reason}` : ''}</span>`
                : html`<span><strong>Asistente activo</strong>: responde automáticamente los mensajes de este cliente.</span>`}
            ${botConfigured() ? html`<form method="post" action="/admin/prospectos/${lead.id}/bot">${csrfField(req)}<input type="hidden" name="paused" value="${lead.bot_paused_at ? '0' : '1'}"><button class="btn small ghost" type="submit">${lead.bot_paused_at ? 'Reactivar asistente' : 'Pausar asistente'}</button></form>` : ''}
          </div>
          ${botRuns.length ? html`<details><summary>Actividad del asistente (${botRuns.length})</summary><ul class="timeline small">${botRuns.map((r) => html`<li><time>${fmtDateTime(r.created_at)}</time> ${r.status}${r.detail ? ` · ${r.detail}` : ''}</li>`)}</ul></details>` : ''}
          <div class="chat">${wa.length ? wa.map((m) => html`<div class="msg ${m.direction}"><p>${m.body}</p><small>${fmtDateTime(m.created_at)}${m.direction === 'out' ? ` · ${m.sent_by_bot ? 'Asistente virtual' : m.sent_by_name ?? ''} · ${m.status ?? ''}` : ''}</small></div>`) : html`<p class="muted">Sin mensajes registrados por la API.</p>`}</div>
          ${whatsappSendEnabled()
            ? html`<form class="inline" method="post" action="/admin/prospectos/${lead.id}/whatsapp">${csrfField(req)}<input name="body" required maxlength="1000" placeholder="Escribe una respuesta…"><button class="btn small" type="submit">Enviar</button></form>
              <p class="muted">Meta solo permite texto libre dentro de las 24 h posteriores al último mensaje del cliente.</p>`
            : html`<p class="muted">El envío desde el panel requiere configurar WhatsApp Business API en el servidor (ver README). Mientras tanto usa “Abrir WhatsApp”.</p>`}
        </section>
      </div>
    </div>

    <section class="card">
      <h2>Lotes</h2>
      ${leadLots.length ? html`<table><thead><tr><th>Lote</th><th>Desarrollo</th><th class="num">m²</th><th class="num">Precio</th><th>Estatus</th></tr></thead><tbody>
        ${leadLots.map((l) => html`<tr><td><a href="/admin/lotes/${l.id}">${l.code}</a></td><td>${l.development_name}</td><td class="num">${l.area_m2 ?? '—'}</td><td class="num">${money(l.price, l.currency)}</td><td>${LOT_STATUS[l.status]}${l.reserved_until ? ` · vence ${fmtDate(l.reserved_until)}` : ''}</td></tr>`)}
      </tbody></table>` : html`<p class="muted">Sin lotes apartados ni vendidos.</p>`}
      ${freeLots.length ? html`<form class="inline" method="post" action="/admin/lotes/apartar">${csrfField(req)}<input type="hidden" name="lead_id" value="${lead.id}">
        <select name="lot_id" required><option value="">Apartar lote disponible de ${lead.development_name}…</option>${freeLots.map((l) => html`<option value="${l.id}">${l.code} · ${l.area_m2 ?? '—'} m² · ${money(l.price, l.currency)}</option>`)}</select>
        <input type="date" name="reserved_until" title="Vencimiento del apartado"><button class="btn small" type="submit">Apartar</button></form>`
        : lead.development_id ? '' : html`<p class="muted">Asigna un desarrollo al prospecto para apartar un lote.</p>`}
      ${sales.length ? html`<h2>Ventas y cartera</h2><table><thead><tr><th>Venta</th><th>Lote</th><th class="num">Saldo</th><th class="num">Vencido</th><th>Estado</th></tr></thead><tbody>
        ${sales.map((s) => html`<tr class="${Number(s.overdue_amount) > 0 && s.status === 'activa' ? 'late' : ''}"><td><a href="/admin/finanzas/ventas/${s.id}">#${s.id}</a></td><td>${s.lot_code}</td><td class="num">${money(Math.max(0, Number(s.balance)), s.currency)}</td><td class="num">${Number(s.overdue_amount) > 0 ? money(s.overdue_amount, s.currency) : '—'}</td><td>${SALE_STATUS[s.status]}</td></tr>`)}
      </tbody></table>` : ''}
    </section>

    <section class="card">
      <h2>Seguimiento</h2>
      <form class="form" method="post" action="/admin/prospectos/${lead.id}/actividad">
        ${csrfField(req)}
        <div class="fields">
          <label>Tipo<select name="type">${options(Object.fromEntries(['nota', 'llamada', 'whatsapp', 'email', 'cita'].map((k) => [k, ACTIVITY_TYPES[k]])), 'llamada')}</select></label>
          <label>Programar próximo contacto<input type="datetime-local" name="next_contact_at"></label>
          <label class="wide">Detalle<textarea name="body" rows="2" required maxlength="4000" placeholder="Resultado de la llamada, acuerdos, próximos pasos…"></textarea></label>
        </div>
        <button class="btn small" type="submit">Registrar actividad</button>
      </form>
      <ul class="timeline">
        ${activities.map((a) => html`<li class="t-${a.type}"><time>${fmtDateTime(a.created_at)}</time><strong>${ACTIVITY_TYPES[a.type]}</strong>${a.user_name ? html` · ${a.user_name}` : ''}<p>${a.body}</p></li>`)}
      </ul>
    </section>`;
  res.send(String(adminPage({ req, title: 'Ficha de prospecto', active: '/admin/prospectos', body })));
});

const updateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  country: z.enum(['52', '1']).default('52'),
  phone: z.string().trim().max(20).default(''),
  email: z.union([z.literal(''), z.email().max(160)]).default(''),
  stage: z.enum(Object.keys(STAGES)),
  development_id: z.string().regex(/^\d*$/).default(''),
  budget: z.string().trim().max(60).default(''),
  next_contact_at: z.string().max(20).default(''),
  tags: z.string().max(400).default(''),
});

router.post('/admin/prospectos/:id', async (req, res, next) => {
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) return back(res, req.params.id, errorQs('Datos no válidos.'));
  const d = parsed.data;
  if (d.phone && !normalizePhone(d.phone, d.country)) return back(res, req.params.id, errorQs('Teléfono no válido.'));
  try {
    const lead = await updateLead(req.user, req.params.id, {
      name: d.name, phone: d.phone, country: d.country, email: d.email || null, stage: d.stage,
      development_id: Number(d.development_id) || null, budget: d.budget || null,
      next_contact_at: fromLocalInput(d.next_contact_at), tags: tagsFrom(d.tags),
    }, req);
    if (!lead) return next();
  } catch (err) {
    if (err.code === '23505') return back(res, req.params.id, errorQs('Ese teléfono ya está registrado en otro prospecto.'));
    throw err;
  }
  back(res, req.params.id, 'msg=ok');
});

router.post('/admin/prospectos/:id/actividad', async (req, res, next) => {
  const type = ['nota', 'llamada', 'whatsapp', 'email', 'cita'].includes(req.body.type) ? req.body.type : null;
  const body = String(req.body.body ?? '').trim().slice(0, 4000);
  if (!type || !body) return back(res, req.params.id, errorQs('Escribe el detalle de la actividad.'));
  const next_ = req.body.next_contact_at ? fromLocalInput(req.body.next_contact_at) : undefined;
  const lead = await addActivity(req.user, req.params.id, { type, body, nextContactAt: next_ }, req);
  if (!lead) return next();
  back(res, req.params.id, 'msg=ok');
});

router.post('/admin/prospectos/:id/reasignar', requirePermission('leads.reassign'), async (req, res, next) => {
  const note = String(req.body.note ?? '').trim().slice(0, 300);
  if (!note) return back(res, req.params.id, errorQs('Indica el motivo de la reasignación.'));
  const r = await reassignLead(req.user, req.params.id, req.body.to, note, req);
  if (r.error === 'not_found') return next();
  if (r.error) return back(res, req.params.id, errorQs('Asesor no válido.'));
  back(res, req.params.id, 'msg=ok');
});

router.post('/admin/prospectos/:id/escalar', async (req, res, next) => {
  const note = String(req.body.note ?? '').trim().slice(0, 300);
  const lead = await escalateLead(req.user, req.params.id, note, req);
  if (!lead) return next();
  back(res, req.params.id, 'msg=ok');
});

router.post('/admin/prospectos/:id/bot', async (req, res, next) => {
  const lead = await getLead(req.user, req.params.id);
  if (!lead) return next();
  const paused = req.body.paused === '1';
  await setBotPaused(lead.id, paused, paused ? `Pausado por ${req.user.name}` : null);
  await addActivity(req.user, lead.id, { type: 'sistema', body: paused ? 'Asistente virtual pausado manualmente.' : 'Asistente virtual reactivado.' }, req);
  back(res, lead.id, 'msg=ok');
});

router.post('/admin/prospectos/:id/whatsapp', async (req, res, next) => {
  const lead = await getLead(req.user, req.params.id);
  if (!lead) return next();
  const body = String(req.body.body ?? '').trim().slice(0, 1000);
  if (!body) return back(res, lead.id, errorQs('Escribe un mensaje.'));
  const r = await sendText({ lead, body, user: req.user, req });
  if (r.ok) await addActivity(req.user, lead.id, { type: 'whatsapp', body: `Mensaje enviado: ${body}` }, req);
  back(res, lead.id, r.ok ? 'msg=enviado' : errorQs(r.error));
});

export default router;
