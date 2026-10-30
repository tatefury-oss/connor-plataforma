import { Router } from 'express';
import { many, one } from '../../db.js';
import { requirePermission } from '../../security/rbac.js';
import { fmtDateTime, html } from '../../views/html.js';
import { adminPage, pager } from '../../views/admin/layout.js';

const router = Router();
const PER_PAGE = 50;

router.get('/admin/auditoria', requirePermission('audit.view'), async (req, res) => {
  const page = Math.max(1, Number(req.query.p) || 1);
  const params = [];
  const where = [];
  if (req.query.entity) { params.push(String(req.query.entity)); where.push(`a.entity = $${params.length}`); }
  if (req.query.action) { params.push(`${String(req.query.action).replace(/[\\%_]/g, '\\$&')}%`); where.push(`a.action LIKE $${params.length}`); }
  if (req.query.entity_id) { params.push(String(req.query.entity_id)); where.push(`a.entity_id = $${params.length}`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { n } = await one(`SELECT count(*)::int AS n FROM audit_log a ${w}`, params);
  const rows = await many(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id ${w}
                            ORDER BY a.created_at DESC, a.id DESC LIMIT ${PER_PAGE} OFFSET ${(page - 1) * PER_PAGE}`, params);
  const query = Object.fromEntries(Object.entries(req.query).filter(([k, v]) => k !== 'p' && v));
  const body = html`
    <form class="filters" method="get">
      <label>Entidad<select name="entity"><option value="">Todas</option>${['lead', 'user', 'development', 'settings'].map((e) => html`<option ${req.query.entity === e ? 'selected' : ''}>${e}</option>`)}</select></label>
      <label>Acción<input name="action" value="${req.query.action ?? ''}" placeholder="auth., lead.reassign…"></label>
      <label>ID<input name="entity_id" value="${req.query.entity_id ?? ''}"></label>
      <button class="btn small" type="submit">Filtrar</button>
    </form>
    <p class="muted">La bitácora es de solo inserción: la base de datos rechaza cualquier modificación o borrado.</p>
    <section class="card flush"><table class="list">
      <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Registro</th><th>Detalle</th><th>IP</th></tr></thead>
      <tbody>${rows.map((a) => html`<tr><td>${fmtDateTime(a.created_at)}</td><td>${a.user_name ?? 'Sistema / público'}</td><td><code>${a.action}</code></td>
        <td>${a.entity === 'lead' && a.entity_id ? html`<a href="/admin/prospectos/${a.entity_id}">${a.entity} #${a.entity_id}</a>` : `${a.entity}${a.entity_id ? ` #${a.entity_id}` : ''}`}</td>
        <td><code class="json">${JSON.stringify(a.details)}</code></td><td>${a.ip ?? ''}</td></tr>`)}</tbody>
    </table></section>
    ${pager('/admin/auditoria', query, n, page, PER_PAGE)}`;
  res.send(String(adminPage({ req, title: 'Auditoría', active: '/admin/auditoria', body })));
});

export default router;
