import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../../config.js';
import { many, one, query } from '../../db.js';
import { can, requirePermission } from '../../security/rbac.js';
import { audit } from '../../services/audit.js';
import { STATUS_LABELS, getById, pad2 } from '../../services/developments.js';
import {
  LOT_STATUS, changeLotStatus, getLot, importLots, inventorySummary, lotEvents, lotsFor, money, parseLots,
} from '../../services/inventory.js';
import { fmtDate, fmtDateTime, html } from '../../views/html.js';
import { adminPage, csrfField } from '../../views/admin/layout.js';

const router = Router();
router.use(['/admin/proyectos', '/admin/lotes'], requirePermission('inventory.view'));

// Los documentos privados viven fuera de la carpeta pública de cargas.
const DOC_DIR = path.join(config.uploadDir, '..', 'private-docs');
mkdirSync(DOC_DIR, { recursive: true });

const TASK_STATUS = { pendiente: 'Pendiente', en_proceso: 'En proceso', completada: 'Completada' };
const err = (res, url, msg) => res.redirect(303, `${url}${url.includes('?') ? '&' : '?'}error=${encodeURIComponent(msg)}`);
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const lotBadge = (s) => html`<span class="lot l-${s}">${LOT_STATUS[s]}</span>`;

// ---------- Tablero general de proyectos ----------
router.get('/admin/proyectos', async (req, res) => {
  const rows = await inventorySummary();
  const t = rows.reduce((a, r) => ({ total: a.total + r.total, disp: a.disp + r.disponible, ap: a.ap + r.apartado, vend: a.vend + r.vendido, tasks: a.tasks + r.open_tasks, late: a.late + r.late_tasks }),
    { total: 0, disp: 0, ap: 0, vend: 0, tasks: 0, late: 0 });
  const kpi = (l, v, h = '') => html`<div class="kpi"><span>${l}</span><strong>${v}</strong>${h ? html`<small>${h}</small>` : ''}</div>`;
  const body = html`
    <section class="kpis">
      ${kpi('Proyectos activos', rows.filter((r) => r.status !== 'agotado').length)}
      ${kpi('Lotes en inventario', t.total)}
      ${kpi('Disponibles', t.disp)}
      ${kpi('Apartados', t.ap)}
      ${kpi('Vendidos', t.vend, pct(t.vend, t.total) + ' del inventario')}
      ${kpi('Actividades pendientes', t.tasks, t.late ? `${t.late} vencidas` : '')}
    </section>
    <section class="card flush"><table class="list">
      <thead><tr><th>#</th><th>Proyecto</th><th>Responsable</th><th>Estatus</th><th class="num">Lotes</th><th class="num">Disp.</th><th class="num">Apart.</th><th class="num">Vend.</th><th>Avance de venta</th><th class="num">Valor disponible</th><th class="num">Pendientes</th></tr></thead>
      <tbody>${rows.map((r) => html`<tr>
        <td>${pad2(r.number)}</td><td><a href="/admin/proyectos/${r.id}"><strong>${r.name}</strong></a><br><small class="muted">${r.zone ?? 'Zona por confirmar'}</small></td>
        <td>${r.manager_name ?? '—'}</td><td>${STATUS_LABELS[r.status]}</td>
        <td class="num">${r.total}</td><td class="num">${r.disponible}</td><td class="num">${r.apartado}</td><td class="num">${r.vendido}</td>
        <td><div class="progress" title="${pct(r.vendido, r.total)} vendido"><i style="width: ${r.total ? (r.vendido / r.total) * 100 : 0}%"></i><b style="width: ${r.total ? (r.apartado / r.total) * 100 : 0}%"></b></div></td>
        <td class="num">${r.available_value ? money(r.available_value, r.currency) : '—'}</td>
        <td class="num">${r.open_tasks}${r.late_tasks ? html` <span class="tag warn">${r.late_tasks} vencidas</span>` : ''}</td></tr>`)}</tbody>
    </table></section>
    <p class="muted">Barra: azul = vendido, naranja = apartado. Los lotes se cargan desde la ficha de cada proyecto.</p>`;
  res.send(String(adminPage({ req, title: 'Proyectos e inventario', active: '/admin/proyectos', body })));
});

// ---------- Ficha de proyecto ----------
router.get('/admin/proyectos/:id', async (req, res, next) => {
  const d = await getById(Number(req.params.id) || 0);
  if (!d) return next();
  const u = req.user;
  const [lots, blocks, tasks, docs, staff, myLeads] = await Promise.all([
    lotsFor(d.id, req.query),
    many(`SELECT DISTINCT block FROM lots WHERE development_id = $1 AND block <> '' ORDER BY block`, [d.id]),
    can(u, 'projects.tasks') ? many(`SELECT t.*, a.name AS assignee_name FROM project_tasks t LEFT JOIN users a ON a.id = t.assignee_id
      WHERE t.development_id = $1 ORDER BY t.status = 'completada', t.due_date NULLS LAST, t.id`, [d.id]) : [],
    can(u, 'projects.documents') ? many(`SELECT p.*, x.name AS uploaded_by_name FROM project_documents p LEFT JOIN users x ON x.id = p.uploaded_by
      WHERE p.development_id = $1 ORDER BY p.created_at DESC`, [d.id]) : [],
    many(`SELECT id, name, role FROM users WHERE active AND role IN ('admin','gerencia','asesor') ORDER BY name`),
    // Prospectos que el usuario puede usar para apartar (asesor: los suyos).
    can(u, 'leads.view_all')
      ? many(`SELECT id, name, phone FROM leads WHERE stage NOT IN ('perdido') ORDER BY (development_id = $1) DESC NULLS LAST, updated_at DESC LIMIT 300`, [d.id])
      : many(`SELECT id, name, phone FROM leads WHERE assigned_to = $2 AND stage NOT IN ('perdido') ORDER BY (development_id = $1) DESC NULLS LAST, updated_at DESC`, [d.id, u.id]),
  ]);
  const counts = Object.fromEntries(Object.keys(LOT_STATUS).map((k) => [k, 0]));
  const all = req.query.status || req.query.block ? await lotsFor(d.id) : lots;
  for (const l of all) counts[l.status]++;
  const leadOptions = html`<option value="">Prospecto…</option>${myLeads.map((l) => html`<option value="${l.id}">${l.name}${l.phone ? ` · ${l.phone}` : ''}</option>`)}`;
  const showLead = (l) => l.lead_id && (can(u, 'leads.view_all') || l.lead_owner === u.id);

  const lotActions = (l) => {
    const forms = [];
    const f = (status, label, extra = '', cls = 'ghost') => html`<form class="mini" method="post" action="/admin/lotes/${l.id}/estado">${csrfField(req)}<input type="hidden" name="status" value="${status}">${extra}<button class="btn small ${cls}" type="submit">${label}</button></form>`;
    if (l.status === 'disponible' && can(u, 'inventory.reserve')) {
      forms.push(f('apartado', 'Apartar', html`<select name="lead_id" required>${leadOptions}</select><input type="date" name="reserved_until" title="Vence el apartado">`, ''));
    }
    if (['disponible', 'apartado'].includes(l.status) && can(u, 'inventory.sell')) {
      forms.push(f('vendido', 'Vender', l.status === 'disponible' ? html`<select name="lead_id" required>${leadOptions}</select>` : ''));
    }
    if (l.status === 'apartado' && (can(u, 'inventory.sell') || l.reserved_by === u.id)) forms.push(f('disponible', 'Liberar'));
    if (l.status === 'disponible' && can(u, 'inventory.manage')) forms.push(f('bloqueado', 'Bloquear'));
    if (l.status === 'bloqueado' && can(u, 'inventory.manage')) forms.push(f('disponible', 'Desbloquear'));
    return forms;
  };

  const body = html`
    <div class="lead-head">
      <div><h2>${pad2(d.number)} · ${d.name}</h2><p>${d.zone ?? 'Zona por confirmar'} · ${STATUS_LABELS[d.status]} · Responsable: <strong>${d.manager_id ? staff.find((s) => s.id === d.manager_id)?.name ?? '—' : 'sin asignar'}</strong></p></div>
      <div class="actions">${d.published ? html`<a class="btn ghost" href="/desarrollos/${d.slug}" target="_blank">Ver ficha pública ↗</a>` : ''}${can(u, 'developments.manage') ? html`<a class="btn ghost" href="/admin/desarrollos/${d.id}">Editar ficha comercial</a>` : ''}</div>
    </div>
    <section class="kpis">
      ${Object.entries(LOT_STATUS).map(([k, label]) => html`<a class="kpi" href="?status=${k}"><span>${label}</span><strong>${counts[k]}</strong></a>`)}
      <div class="kpi"><span>Vendido</span><strong>${pct(counts.vendido, all.length)}</strong><small>${all.length} lotes en total</small></div>
    </section>

    <section class="card flush">
      <form class="filters inset" method="get">
        <label>Estatus<select name="status" data-autosubmit><option value="">Todos</option>${Object.entries(LOT_STATUS).map(([k, v]) => html`<option value="${k}" ${req.query.status === k ? 'selected' : ''}>${v}</option>`)}</select></label>
        ${blocks.length ? html`<label>Manzana<select name="block" data-autosubmit><option value="">Todas</option>${blocks.map((b) => html`<option ${req.query.block === b.block ? 'selected' : ''}>${b.block}</option>`)}</select></label>` : ''}
        <noscript><button class="btn small">Filtrar</button></noscript>
      </form>
      <table class="list" data-live-list>
        <thead><tr><th>Lote</th><th>Manzana</th><th class="num">m²</th><th>Medidas</th><th class="num">Precio</th><th>Estatus</th><th>Cliente</th><th>Acciones</th></tr></thead>
        <tbody>${lots.map((l) => html`<tr>
          <td class="nowrap"><a href="/admin/lotes/${l.id}"><strong>${l.code}</strong></a></td><td>${l.block}${l.number ? ` · L${l.number}` : ''}</td>
          <td class="num">${l.area_m2 != null ? Number(l.area_m2) : '—'}</td><td>${l.front_m && l.depth_m ? `${Number(l.front_m)} × ${Number(l.depth_m)} m` : '—'}</td>
          <td class="num">${money(l.price, l.currency)}</td>
          <td>${lotBadge(l.status)}${l.status === 'apartado' && l.reserved_until ? html`<br><small class="muted">vence ${fmtDate(l.reserved_until)}</small>` : ''}</td>
          <td>${showLead(l) ? html`<a href="/admin/prospectos/${l.lead_id}">${l.lead_name}</a>` : l.lead_id ? html`<span class="muted">Otro asesor</span>` : '—'}</td>
          <td class="lot-actions">${lotActions(l)}</td></tr>`)}</tbody>
      </table>
      ${lots.length ? '' : html`<p class="muted pad">${all.length ? 'Ningún lote coincide con el filtro.' : 'Este proyecto aún no tiene inventario cargado.'}</p>`}
    </section>

    ${can(u, 'inventory.manage') ? html`
    <div class="grid2">
      <form class="card form" method="post" action="/admin/proyectos/${d.id}/lotes/importar">
        ${csrfField(req)}
        <h2>Cargar o actualizar lotes</h2>
        <p class="muted">Pega desde Excel (o separa con punto y coma) en este orden: <code>clave; manzana; lote; m²; frente; fondo; precio</code>. Si la clave ya existe se actualizan medidas y precio; el estatus y el cliente no cambian.</p>
        <label class="block">Lotes<textarea name="lots" rows="7" required placeholder="M1-L01;M1;01;140;7;20;278000"></textarea></label>
        <div class="fields"><label>Moneda<select name="currency">${['MXN', 'USD'].map((c) => html`<option ${d.currency === c ? 'selected' : ''}>${c}</option>`)}</select></label></div>
        <button class="btn" type="submit">Importar</button>
      </form>
      <form class="card form" method="post" action="/admin/proyectos/${d.id}/responsable">
        ${csrfField(req)}
        <h2>Responsable del proyecto</h2>
        <div class="fields"><label>Responsable<select name="manager_id"><option value="">Sin asignar</option>${staff.filter((s) => s.role !== 'asesor').map((s) => html`<option value="${s.id}" ${d.manager_id === s.id ? 'selected' : ''}>${s.name}</option>`)}</select></label></div>
        <button class="btn small" type="submit">Guardar</button>
      </form>
    </div>` : ''}

    ${can(u, 'projects.tasks') ? html`
    <section class="card">
      <h2>Avances y actividades</h2>
      <form class="inline" method="post" action="/admin/proyectos/${d.id}/actividades">${csrfField(req)}
        <input name="title" required maxlength="160" placeholder="Actividad (p. ej. Introducción de red eléctrica, Manzana 3)">
        <select name="assignee_id"><option value="">Responsable…</option>${staff.map((s) => html`<option value="${s.id}">${s.name}</option>`)}</select>
        <input type="date" name="due_date" title="Fecha compromiso">
        <button class="btn small" type="submit">Agregar</button>
      </form>
      <table><thead><tr><th>Actividad</th><th>Responsable</th><th>Compromiso</th><th>Estatus</th></tr></thead><tbody>
        ${tasks.map((t) => html`<tr class="${t.status !== 'completada' && t.due_date && new Date(t.due_date) < new Date(new Date().toDateString()) ? 'late' : ''}">
          <td>${t.title}${t.detail ? html`<br><small class="muted">${t.detail}</small>` : ''}</td><td>${t.assignee_name ?? '—'}</td><td>${t.due_date ? fmtDate(t.due_date) : '—'}</td>
          <td><form class="mini" method="post" action="/admin/actividades/${t.id}">${csrfField(req)}<select name="status" data-autosubmit>${Object.entries(TASK_STATUS).map(([k, v]) => html`<option value="${k}" ${t.status === k ? 'selected' : ''}>${v}</option>`)}</select><noscript><button class="btn small">OK</button></noscript></form>
          ${t.completed_at ? html`<small class="muted">${fmtDate(t.completed_at)}</small>` : ''}</td></tr>`)}
      </tbody></table>
      ${tasks.length ? '' : html`<p class="muted">Sin actividades registradas.</p>`}
    </section>` : ''}

    ${can(u, 'projects.documents') ? html`
    <section class="card">
      <h2>Documentación</h2>
      <p class="muted">Planos, permisos, escrituras y contratos. Son privados: solo administración y gerencia pueden descargarlos.</p>
      <form class="inline" method="post" enctype="multipart/form-data" action="/admin/proyectos/${d.id}/documentos">${csrfField(req)}
        <input name="title" required maxlength="160" placeholder="Nombre del documento"><input type="file" name="file" required accept="application/pdf,image/jpeg,image/png">
        <button class="btn small" type="submit">Subir</button></form>
      <ul class="docs">${docs.map((x) => html`<li><a href="/admin/documentos/${x.id}">${x.title}</a> <small class="muted">${x.filename} · ${(x.size_bytes / 1024).toFixed(0)} KB · ${x.uploaded_by_name ?? ''} · ${fmtDate(x.created_at)}</small></li>`)}</ul>
      ${docs.length ? '' : html`<p class="muted">Sin documentos.</p>`}
    </section>` : ''}`;
  res.send(String(adminPage({ req, title: d.name, active: '/admin/proyectos', body })));
});

router.post('/admin/proyectos/:id/lotes/importar', requirePermission('inventory.manage'), async (req, res, next) => {
  const d = await getById(Number(req.params.id) || 0);
  if (!d) return next();
  const back = `/admin/proyectos/${d.id}`;
  const { rows, errors } = parseLots(req.body.lots);
  if (errors.length) return err(res, back, errors.slice(0, 5).join(' '));
  if (!rows.length) return err(res, back, 'No se encontraron lotes en el texto.');
  const r = await importLots(d.id, rows, req.body.currency === 'USD' ? 'USD' : 'MXN', req);
  res.redirect(303, `${back}?aviso=${encodeURIComponent(`Importación lista: ${r.created} lotes nuevos, ${r.updated} actualizados.`)}`);
});

router.post('/admin/proyectos/:id/responsable', requirePermission('inventory.manage'), async (req, res, next) => {
  const id = Number(req.params.id) || 0;
  const managerId = Number(req.body.manager_id) || null;
  if (managerId && !(await one(`SELECT 1 FROM users WHERE id = $1 AND active AND role IN ('admin','gerencia')`, [managerId]))) {
    return err(res, `/admin/proyectos/${id}`, 'Responsable no válido.');
  }
  const d = await one('UPDATE developments SET manager_id = $2, updated_at = now() WHERE id = $1 RETURNING id', [id, managerId]);
  if (!d) return next();
  await audit({ req, action: 'development.manager', entity: 'development', entityId: id, details: { manager_id: managerId } });
  res.redirect(303, `/admin/proyectos/${id}?msg=ok`);
});

// ---------- Lote ----------
router.get('/admin/lotes/:id', async (req, res, next) => {
  const l = await getLot(req.params.id);
  if (!l) return next();
  const events = await lotEvents(l.id);
  const visibleLead = async (id) => id && (can(req.user, 'leads.view_all') || (await one('SELECT 1 FROM leads WHERE id = $1 AND assigned_to = $2', [id, req.user.id])));
  const leadVisible = await visibleLead(l.lead_id);
  const body = html`
    <div class="lead-head"><div><h2>Lote ${l.code}</h2><p><a href="/admin/proyectos/${l.development_id}">${l.development_name}</a> · ${lotBadge(l.status)}</p></div></div>
    <div class="grid2">
      ${can(req.user, 'inventory.manage') ? html`<form class="card form" method="post" action="/admin/lotes/${l.id}">
        ${csrfField(req)}<h2>Datos del lote</h2>
        <div class="fields">
          <label>Manzana<input name="block" value="${l.block}" maxlength="20"></label>
          <label>Lote<input name="number" value="${l.number}" maxlength="20"></label>
          <label>Superficie (m²)<input name="area_m2" inputmode="decimal" value="${l.area_m2 ?? ''}"></label>
          <label>Frente (m)<input name="front_m" inputmode="decimal" value="${l.front_m ?? ''}"></label>
          <label>Fondo (m)<input name="depth_m" inputmode="decimal" value="${l.depth_m ?? ''}"></label>
          <label>Precio<input name="price" inputmode="decimal" value="${l.price ?? ''}"></label>
          <label>Moneda<select name="currency">${['MXN', 'USD'].map((c) => html`<option ${l.currency === c ? 'selected' : ''}>${c}</option>`)}</select></label>
          <label class="wide">Notas internas<textarea name="notes" rows="2">${l.notes}</textarea></label>
        </div>
        <button class="btn" type="submit">Guardar</button>
      </form>` : html`<section class="card"><h2>Datos del lote</h2><p>${l.area_m2 ?? '—'} m² · ${l.front_m && l.depth_m ? `${l.front_m} × ${l.depth_m} m · ` : ''}${money(l.price, l.currency)}</p></section>`}
      <section class="card"><h2>Situación</h2>
        <p>${lotBadge(l.status)} ${l.lead_id ? (leadVisible ? html`· <a href="/admin/prospectos/${l.lead_id}">${l.lead_name}</a>` : '· asignado a otro asesor') : ''}</p>
        ${l.status === 'apartado' ? html`<p class="muted">Apartado por ${l.reserved_by_name ?? '—'}${l.reserved_until ? ` · vence ${fmtDate(l.reserved_until)}` : ''}</p>` : ''}
        ${l.status === 'vendido' && can(req.user, 'inventory.manage') ? html`<form class="inline" method="post" action="/admin/lotes/${l.id}/estado" data-confirm="¿Cancelar la venta y liberar el lote?">${csrfField(req)}
          <input type="hidden" name="status" value="disponible"><input name="note" required maxlength="300" placeholder="Motivo de la cancelación"><button class="btn small ghost" type="submit">Cancelar venta</button></form>` : ''}
        <h2>Historial</h2>
        <ul class="timeline small">${events.map((e) => html`<li><time>${fmtDateTime(e.created_at)}</time> ${e.from_status ? LOT_STATUS[e.from_status] : '—'} → <strong>${LOT_STATUS[e.to_status]}</strong>${e.user_name ? ` · ${e.user_name}` : ' · Sistema'}${e.note ? ` · ${e.note}` : ''}</li>`)}</ul>
        ${events.length ? '' : html`<p class="muted">Sin movimientos.</p>`}
      </section>
    </div>`;
  res.send(String(adminPage({ req, title: `Lote ${l.code}`, active: '/admin/proyectos', body })));
});

const decimal = (v) => {
  const s = String(v ?? '').replace(/[$,\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n < 1e11 ? n : NaN;
};

// Apartado desde la ficha del prospecto.
router.post('/admin/lotes/apartar', requirePermission('inventory.reserve'), async (req, res) => {
  const leadId = Number(req.body.lead_id) || 0;
  const back = `/admin/prospectos/${leadId}`;
  const until = /^\d{4}-\d{2}-\d{2}$/.test(req.body.reserved_until ?? '') ? req.body.reserved_until : null;
  const r = await changeLotStatus(req.user, req.body.lot_id, { status: 'apartado', leadId, reservedUntil: until }, req);
  if (r.error === 'forbidden') return res.status(403).send('No tienes permiso para este movimiento.');
  if (r.error) return err(res, back, r.error === 'not_found' ? 'Lote no encontrado.' : r.error);
  res.redirect(303, `${back}?msg=ok`);
});

router.post('/admin/lotes/:id', requirePermission('inventory.manage'), async (req, res, next) => {
  const l = await getLot(req.params.id);
  if (!l) return next();
  const vals = Object.fromEntries(['area_m2', 'front_m', 'depth_m', 'price'].map((k) => [k, decimal(req.body[k])]));
  if (Object.values(vals).some(Number.isNaN)) return err(res, `/admin/lotes/${l.id}`, 'Revisa los valores numéricos.');
  const row = { block: String(req.body.block ?? '').trim().slice(0, 20), number: String(req.body.number ?? '').trim().slice(0, 20),
    ...vals, currency: req.body.currency === 'USD' ? 'USD' : 'MXN', notes: String(req.body.notes ?? '').slice(0, 2000) };
  await query(`UPDATE lots SET block = $2, number = $3, area_m2 = $4, front_m = $5, depth_m = $6, price = $7, currency = $8, notes = $9, updated_at = now() WHERE id = $1`,
    [l.id, row.block, row.number, row.area_m2, row.front_m, row.depth_m, row.price, row.currency, row.notes]);
  const changed = Object.fromEntries(Object.entries(row).filter(([k, v]) => String(l[k] ?? '') !== String(v ?? '')).map(([k, v]) => [k, { from: l[k], to: v }]));
  await audit({ req, action: 'lot.update', entity: 'lot', entityId: l.id, details: changed });
  res.redirect(303, `/admin/lotes/${l.id}?msg=ok`);
});

router.post('/admin/lotes/:id/estado', requirePermission('inventory.reserve', 'inventory.sell', 'inventory.manage'), async (req, res, next) => {
  const l = await getLot(req.params.id);
  if (!l) return next();
  const until = /^\d{4}-\d{2}-\d{2}$/.test(req.body.reserved_until ?? '') ? req.body.reserved_until : null;
  const r = await changeLotStatus(req.user, l.id, {
    status: req.body.status, leadId: req.body.lead_id, note: String(req.body.note ?? '').trim(), reservedUntil: until,
  }, req);
  const back = String(req.get('referer') ?? '').match(/\/admin\/(proyectos|lotes|prospectos)\/\d+/)?.[0] ?? `/admin/proyectos/${l.development_id}`;
  if (r.error === 'forbidden') return res.status(403).send('No tienes permiso para este movimiento.');
  if (r.error === 'not_found') return next();
  if (r.error) return err(res, back, r.error);
  res.redirect(303, `${back}?msg=ok`);
});

// ---------- Actividades ----------
router.post('/admin/proyectos/:id/actividades', requirePermission('projects.tasks'), async (req, res, next) => {
  const d = await getById(Number(req.params.id) || 0);
  if (!d) return next();
  const title = String(req.body.title ?? '').trim().slice(0, 160);
  if (!title) return err(res, `/admin/proyectos/${d.id}`, 'Escribe la actividad.');
  const due = /^\d{4}-\d{2}-\d{2}$/.test(req.body.due_date ?? '') ? req.body.due_date : null;
  const assignee = Number(req.body.assignee_id) || null;
  if (assignee && !(await one('SELECT 1 FROM users WHERE id = $1 AND active', [assignee]))) return err(res, `/admin/proyectos/${d.id}`, 'Responsable no válido.');
  const t = await one(`INSERT INTO project_tasks (development_id, title, assignee_id, due_date, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [d.id, title, assignee, due, req.user.id]);
  await audit({ req, action: 'task.create', entity: 'development', entityId: d.id, details: { task: t.id, title } });
  res.redirect(303, `/admin/proyectos/${d.id}?msg=ok`);
});

router.post('/admin/actividades/:id', requirePermission('projects.tasks'), async (req, res, next) => {
  const status = TASK_STATUS[req.body.status] ? req.body.status : null;
  if (!status) return res.sendStatus(400);
  const t = await one(
    `UPDATE project_tasks SET status = $2, completed_at = CASE WHEN $2 = 'completada' THEN COALESCE(completed_at, now()) END, updated_at = now()
      WHERE id = $1 RETURNING id, development_id`, [Number(req.params.id) || 0, status]);
  if (!t) return next();
  await audit({ req, action: 'task.status', entity: 'development', entityId: t.development_id, details: { task: t.id, status } });
  res.redirect(303, `/admin/proyectos/${t.development_id}?msg=ok`);
});

// ---------- Documentos privados ----------
const DOC_TYPES = {
  'application/pdf': { ext: '.pdf', magic: (b) => b.toString('ascii', 0, 5) === '%PDF-' },
  'image/jpeg': { ext: '.jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: '.png', magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
};
const docUpload = multer({
  storage: multer.diskStorage({ destination: DOC_DIR, filename: (_r, f, cb) => cb(null, randomBytes(16).toString('hex') + (DOC_TYPES[f.mimetype]?.ext ?? '')) }),
  limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 10 },
  fileFilter: (_r, f, cb) => cb(null, Boolean(DOC_TYPES[f.mimetype])),
}).single('file');

export function mountProjectUploads(app, requireCsrf) {
  const cleanupOn403 = (req, res, next) => {
    res.once('finish', () => { if (res.statusCode === 403 && req.file) unlink(req.file.path).catch(() => {}); });
    requireCsrf(req, res, next);
  };
  app.post('/admin/proyectos/:id/documentos', requirePermission('projects.documents'), docUpload, cleanupOn403, async (req, res, next) => {
    const d = await getById(Number(req.params.id) || 0);
    const back = `/admin/proyectos/${req.params.id}`;
    if (!req.file) return d ? err(res, back, 'Sube un PDF, JPG o PNG.') : next();
    const fh = await open(req.file.path, 'r');
    const { buffer } = await fh.read(Buffer.alloc(8), 0, 8, 0);
    await fh.close();
    const title = String(req.body.title ?? '').trim().slice(0, 160);
    if (!d || !title || !DOC_TYPES[req.file.mimetype].magic(buffer)) {
      await unlink(req.file.path).catch(() => {});
      return d ? err(res, back, 'Archivo no válido o falta el nombre del documento.') : next();
    }
    const doc = await one(
      `INSERT INTO project_documents (development_id, title, filename, stored_name, mime, size_bytes, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [d.id, title, path.basename(req.file.originalname).slice(0, 200), req.file.filename, req.file.mimetype, req.file.size, req.user.id]);
    await audit({ req, action: 'document.upload', entity: 'development', entityId: d.id, details: { document: doc.id, title } });
    res.redirect(303, `${back}?msg=ok`);
  });
}

router.get('/admin/documentos/:id', requirePermission('projects.documents'), async (req, res, next) => {
  const doc = await one('SELECT * FROM project_documents WHERE id = $1', [Number(req.params.id) || 0]);
  if (!doc) return next();
  await audit({ req, action: 'document.download', entity: 'development', entityId: doc.development_id, details: { document: doc.id } });
  res.set('Content-Type', doc.mime);
  res.set('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`);
  res.sendFile(path.join(DOC_DIR, path.basename(doc.stored_name)));
});

export default router;
