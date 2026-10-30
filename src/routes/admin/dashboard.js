import { Router } from 'express';
import { many, one, query } from '../../db.js';
import { can } from '../../security/rbac.js';
import { requireCsrf } from '../../security/session.js';
import { audit } from '../../services/audit.js';
import { STAGES } from '../../services/leads.js';
import { fmtDateTime, html } from '../../views/html.js';
import { adminPage } from '../../views/admin/layout.js';

const router = Router();

const kpi = (label, value, hint = '') => html`<div class="kpi"><span>${label}</span><strong>${value}</strong>${hint ? html`<small>${hint}</small>` : ''}</div>`;

function minutes(m) {
  if (m == null) return '—';
  const v = Number(m);
  if (v < 60) return `${Math.round(v)} min`;
  if (v < 1440) return `${(v / 60).toFixed(1)} h`;
  return `${(v / 1440).toFixed(1)} días`;
}

function parseRange(q) {
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const to = iso.test(q.hasta) ? q.hasta : null;
  const from = iso.test(q.desde) ? q.desde : null;
  return { from, to };
}

async function managementDashboard(req) {
  const { from, to } = parseRange(req.query);
  const dev = Number(req.query.desarrollo) || null;
  const adv = Number(req.query.asesor) || null;
  // Filtros comunes del tablero ($1 desde, $2 hasta, $3 desarrollo, $4 asesor).
  const p = [from, to, dev, adv];
  const W = `($1::date IS NULL OR l.created_at >= ($1::date::timestamp AT TIME ZONE 'America/Tijuana'))
         AND ($2::date IS NULL OR l.created_at < (($2::date + 1)::timestamp AT TIME ZONE 'America/Tijuana'))
         AND ($3::bigint IS NULL OR l.development_id = $3)
         AND ($4::bigint IS NULL OR l.assigned_to = $4)`;

  const [totals, byStage, byAdvisor, byDev, overdue, developments, advisors] = await Promise.all([
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE l.created_at > now() - interval '7 days')::int AS week,
                count(*) FILTER (WHERE l.assigned_to IS NULL)::int AS unassigned,
                count(*) FILTER (WHERE l.escalated_at IS NOT NULL)::int AS escalated,
                count(*) FILTER (WHERE l.stage IN ('venta','cliente'))::int AS won,
                count(*) FILTER (WHERE l.stage = 'cita')::int AS appointments,
                avg(extract(epoch FROM l.first_response_at - l.assigned_at) / 60) AS avg_response
           FROM leads l WHERE ${W}`, p),
    many(`SELECT l.stage, count(*)::int AS n FROM leads l WHERE ${W} GROUP BY l.stage`, p),
    many(`SELECT u.id, u.name, u.available, u.active,
                 count(l.id)::int AS leads,
                 count(l.id) FILTER (WHERE l.stage IN ('venta','cliente'))::int AS won,
                 count(l.id) FILTER (WHERE l.stage = 'nuevo')::int AS pending,
                 avg(extract(epoch FROM l.first_response_at - l.assigned_at) / 60) AS avg_response
            FROM users u LEFT JOIN leads l ON l.assigned_to = u.id AND ${W}
           WHERE u.role = 'asesor' GROUP BY u.id ORDER BY u.name`, p),
    many(`SELECT d.id, d.name, count(l.id)::int AS leads,
                 count(l.id) FILTER (WHERE l.stage IN ('venta','cliente'))::int AS won
            FROM developments d LEFT JOIN leads l ON l.development_id = d.id AND ${W}
           GROUP BY d.id ORDER BY d.sort_order, d.number`, p),
    one(`SELECT count(*)::int AS n FROM leads l WHERE l.next_contact_at < now() AND l.stage NOT IN ('cliente','perdido') AND ${W}`, p),
    many('SELECT id, name FROM developments ORDER BY sort_order, number'),
    many(`SELECT id, name FROM users WHERE role = 'asesor' ORDER BY name`),
  ]);
  const stageMap = Object.fromEntries(byStage.map((r) => [r.stage, r.n]));
  const maxStage = Math.max(1, ...byStage.map((r) => r.n));
  const conv = totals.total ? `${((totals.won / totals.total) * 100).toFixed(1)}%` : '—';

  return html`
    <form class="filters" method="get">
      <label>Desde<input type="date" name="desde" value="${from ?? ''}"></label>
      <label>Hasta<input type="date" name="hasta" value="${to ?? ''}"></label>
      <label>Desarrollo<select name="desarrollo"><option value="">Todos</option>${developments.map((d) => html`<option value="${d.id}" ${dev === d.id ? 'selected' : ''}>${d.name}</option>`)}</select></label>
      <label>Asesor<select name="asesor"><option value="">Todos</option>${advisors.map((a) => html`<option value="${a.id}" ${adv === a.id ? 'selected' : ''}>${a.name}</option>`)}</select></label>
      <button class="btn small" type="submit">Filtrar</button>
      <a class="btn ghost small" href="/admin">Limpiar</a>
    </form>
    <section class="kpis">
      ${kpi('Prospectos recibidos', totals.total, `${totals.week} en los últimos 7 días`)}
      ${kpi('Tiempo promedio de respuesta', minutes(totals.avg_response))}
      ${kpi('Citas activas', totals.appointments)}
      ${kpi('Ventas cerradas', totals.won)}
      ${kpi('Tasa de conversión', conv)}
      ${kpi('Sin asignar', totals.unassigned, totals.unassigned ? 'Requieren asignación manual' : '')}
      ${kpi('Escalados', totals.escalated)}
      ${kpi('Seguimientos vencidos', overdue.n)}
    </section>
    <div class="grid2">
      <section class="card"><h2>Embudo comercial</h2>
        <div class="bars">${Object.entries(STAGES).map(([k, label]) => html`<a class="bar" href="/admin/prospectos?stage=${k}"><span>${label}</span><i style="width: ${((stageMap[k] ?? 0) / maxStage) * 100}%"></i><b>${stageMap[k] ?? 0}</b></a>`)}</div>
      </section>
      <section class="card"><h2>Prospectos por desarrollo</h2>
        <table><thead><tr><th>Desarrollo</th><th class="num">Prospectos</th><th class="num">Ventas</th></tr></thead>
        <tbody>${byDev.map((d) => html`<tr><td><a href="/admin/prospectos?development=${d.id}">${d.name}</a></td><td class="num">${d.leads}</td><td class="num">${d.won}</td></tr>`)}</tbody></table>
      </section>
    </div>
    <section class="card"><h2>Desempeño por asesor</h2>
      <table><thead><tr><th>Asesor</th><th>Estado</th><th class="num">Asignados</th><th class="num">Sin contactar</th><th class="num">Ventas</th><th class="num">Conversión</th><th class="num">Resp. promedio</th></tr></thead>
      <tbody>${byAdvisor.map((a) => html`<tr><td><a href="/admin/prospectos?advisor=${a.id}">${a.name}</a></td><td>${!a.active ? 'Inactivo' : a.available ? 'Disponible' : 'No disponible'}</td><td class="num">${a.leads}</td><td class="num">${a.pending}</td><td class="num">${a.won}</td><td class="num">${a.leads ? `${((a.won / a.leads) * 100).toFixed(0)}%` : '—'}</td><td class="num">${minutes(a.avg_response)}</td></tr>`)}</tbody></table>
      ${byAdvisor.length ? '' : html`<p class="muted">No hay asesores registrados. Los prospectos quedarán sin asignar hasta que se den de alta en Usuarios.</p>`}
    </section>`;
}

async function advisorDashboard(req) {
  const id = req.user.id;
  const [totals, due] = await Promise.all([
    one(`SELECT count(*)::int AS total,
                count(*) FILTER (WHERE stage = 'nuevo')::int AS pending,
                count(*) FILTER (WHERE stage IN ('venta','cliente'))::int AS won,
                count(*) FILTER (WHERE next_contact_at < now() AND stage NOT IN ('cliente','perdido'))::int AS overdue
           FROM leads WHERE assigned_to = $1`, [id]),
    many(`SELECT id, name, stage, next_contact_at FROM leads
           WHERE assigned_to = $1 AND stage NOT IN ('cliente','perdido')
             AND (next_contact_at < now() + interval '1 day' OR stage = 'nuevo')
           ORDER BY next_contact_at NULLS FIRST LIMIT 30`, [id]),
  ]);
  return html`
    <section class="kpis">
      ${kpi('Mis prospectos', totals.total)}
      ${kpi('Sin contactar', totals.pending)}
      ${kpi('Seguimientos vencidos', totals.overdue)}
      ${kpi('Ventas', totals.won)}
    </section>
    <section class="card"><h2>Para hoy</h2>
      ${due.length ? html`<table><thead><tr><th>Prospecto</th><th>Etapa</th><th>Próximo contacto</th></tr></thead><tbody>
        ${due.map((l) => html`<tr class="${l.next_contact_at && new Date(l.next_contact_at) < new Date() ? 'late' : ''}"><td><a href="/admin/prospectos/${l.id}">${l.name}</a></td><td><span class="stage s-${l.stage}">${STAGES[l.stage]}</span></td><td>${l.next_contact_at ? fmtDateTime(l.next_contact_at) : 'Contactar cuanto antes'}</td></tr>`)}
      </tbody></table>` : html`<p class="muted">No tienes pendientes para hoy.</p>`}
    </section>`;
}

router.get('/admin', async (req, res) => {
  if (req.user.role === 'finanzas') return res.redirect(303, '/admin/finanzas');
  let body;
  if (can(req.user, 'reports.commercial')) body = await managementDashboard(req);
  else if (req.user.role === 'asesor') body = await advisorDashboard(req);
  else body = html`<p class="muted">Sin indicadores para tu rol.</p>`;
  res.send(String(adminPage({ req, title: 'Tablero', active: '/admin', body })));
});

router.post('/admin/disponibilidad', requireCsrf, async (req, res) => {
  if (req.user.role !== 'asesor') return res.sendStatus(403);
  const { rows: [u] } = await query('UPDATE users SET available = NOT available, updated_at = now() WHERE id = $1 RETURNING available', [req.user.id]);
  await audit({ req, action: 'user.availability', entity: 'user', entityId: req.user.id, details: { available: u.available } });
  res.redirect(303, req.get('referer')?.includes('/admin') ? new URL(req.get('referer')).pathname : '/admin');
});

export default router;
