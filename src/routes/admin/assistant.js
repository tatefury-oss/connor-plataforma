import { Router } from 'express';
import { can, canSeeFinance, canSeeLeads, requirePermission } from '../../security/rbac.js';
import { trends, commercialSummary, normalizeRange } from '../../services/analytics.js';
import {
  ask, assistantConfigured, conversationMessages, deleteConversation, getConversation, listConversations, visibleText,
} from '../../services/assistant.js';
import { money } from '../../services/inventory.js';
import { barChart } from '../../views/charts.js';
import { fmtDateTime, html } from '../../views/html.js';
import { renderMarkdown } from '../../views/markdown.js';
import { adminPage, csrfField } from '../../views/admin/layout.js';

const router = Router();
router.use('/admin/asistente', requirePermission('assistant.use'));

// Sugerencias según lo que el rol puede consultar.
function suggestions(user) {
  const s = [];
  if (canSeeLeads(user)) {
    s.push('¿Qué prospectos no tienen seguimiento y a quién debo llamar primero?');
    s.push(can(user, 'leads.view_all') ? 'Prepara el reporte comercial de la última semana con recomendaciones.' : 'Resume mi semana: prospectos nuevos, citas y ventas.');
  }
  if (can(user, 'leads.view_all')) s.push('Analiza el desempeño de los asesores este mes.');
  if (canSeeFinance(user)) s.push('¿Cómo está la cartera vencida y quiénes son los morosos?');
  if (can(user, 'inventory.view')) s.push('¿Qué desarrollos tienen más lotes disponibles?');
  s.push('¿Qué tendencias ves en los últimos 6 meses?');
  return s.slice(0, 5);
}

function page(req, { conv = null, messages = [], conversations = [] }) {
  const prefill = typeof req.query.q === 'string' ? req.query.q.slice(0, 500) : '';
  const body = html`
    <div class="assistant-layout">
      <aside class="conv-list">
        <a class="btn small" href="/admin/asistente">+ Nueva conversación</a>
        <ul>${conversations.map((c) => html`<li class="${conv?.id === c.id ? 'on' : ''}"><a href="/admin/asistente/${c.id}">${c.title}</a><small>${fmtDateTime(c.updated_at)}</small></li>`)}</ul>
        ${conversations.length ? '' : html`<p class="muted">Tus conversaciones son privadas.</p>`}
      </aside>
      <section class="chat-pane">
        ${assistantConfigured() ? '' : html`<div class="alert err">El asistente requiere configurar ANTHROPIC_API_KEY en el servidor.</div>`}
        <div class="thread" id="thread" aria-live="polite">
          ${messages.length ? messages.map((m) => html`<div class="bubble ${m.role}">${m.role === 'assistant' ? renderMarkdown(m.text) : html`<p>${m.text}</p>`}</div>`)
            : html`<div class="empty"><h2>¿En qué te ayudo?</h2><p class="muted">Consulto prospectos, proyectos, inventario y cartera con los permisos de tu rol, preparo reportes y sugiero acciones. No puedo registrar pagos, cambiar saldos ni borrar información.</p>
              <div class="chips">${suggestions(req.user).map((s) => html`<button type="button" class="chip" data-suggest="${s}">${s}</button>`)}</div></div>`}
        </div>
        <form class="ask" method="post" action="/admin/asistente" id="ask-form">
          ${csrfField(req)}
          <input type="hidden" name="conversation_id" value="${conv?.id ?? ''}">
          <textarea name="text" rows="2" maxlength="4000" required placeholder="Escribe tu pregunta…">${prefill}</textarea>
          <button class="btn" type="submit">Enviar</button>
        </form>
        ${conv ? html`<form method="post" action="/admin/asistente/${conv.id}/eliminar" data-confirm="¿Eliminar esta conversación?">${csrfField(req)}<button class="link danger" type="submit">Eliminar conversación</button></form>` : ''}
      </section>
    </div>
    <script src="/js/assistant.js" defer></script>`;
  return adminPage({ req, title: 'Asistente', active: '/admin/asistente', body });
}

router.get('/admin/asistente', async (req, res) => {
  res.send(String(page(req, { conversations: await listConversations(req.user) })));
});

router.get('/admin/asistente/:id', async (req, res, next) => {
  const conv = await getConversation(req.user, req.params.id);
  if (!conv) return next();
  const [rows, conversations] = await Promise.all([conversationMessages(conv.id), listConversations(req.user)]);
  const messages = rows.map((m) => ({ role: m.role, text: visibleText(m) })).filter((m) => m.text.trim());
  res.send(String(page(req, { conv, messages, conversations })));
});

router.post('/admin/asistente', async (req, res) => {
  const wantsJson = req.accepts(['html', 'json']) === 'json';
  const r = await ask(req.user, { conversationId: req.body.conversation_id || null, text: req.body.text }, req);
  if (r.error === 'forbidden') return res.status(403).json({ error: 'Sin permiso.' });
  if (r.error === 'not_found') return wantsJson ? res.status(404).json({ error: 'Conversación no encontrada.' }) : res.sendStatus(404);
  if (wantsJson) {
    return res.status(r.error ? 422 : 200).json({ conversationId: r.conversationId ?? null, error: r.error ?? null, html: r.answer ? String(renderMarkdown(r.answer)) : null });
  }
  const target = r.conversationId ? `/admin/asistente/${r.conversationId}` : '/admin/asistente';
  res.redirect(303, r.error ? `${target}?error=${encodeURIComponent(r.error)}` : target);
});

router.post('/admin/asistente/:id/eliminar', async (req, res) => {
  await deleteConversation(req.user, req.params.id);
  res.redirect(303, '/admin/asistente');
});

// ---------- Analítica ----------
const monthLabel = (ym) => new Date(`${ym}-15T12:00:00Z`).toLocaleDateString('es-MX', { month: 'short', timeZone: 'UTC' });
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const minutes = (m) => (m == null ? '—' : Number(m) < 60 ? `${Math.round(m)} min` : Number(m) < 1440 ? `${(m / 60).toFixed(1)} h` : `${(m / 1440).toFixed(1)} días`);

router.get('/admin/analitica', requirePermission('analytics.view'), async (req, res) => {
  const [from, to] = normalizeRange(req.query.desde, req.query.hasta, 90);
  const [c, t] = await Promise.all([commercialSummary(req.user, from, to), trends(req.user, 12)]);
  const currencies = [...new Set([...t.ventas_por_mes, ...t.cobranza_por_mes].map((r) => r.moneda))];
  const series = (rows, cur, key) => t.prospectos_por_mes.map((m) => ({ label: monthLabel(m.mes), value: rows.find((r) => r.mes === m.mes && r.moneda === cur)?.[key] ?? 0 }));
  const maxStage = Math.max(1, ...Object.values(c.embudo));
  const q = `Analiza los indicadores comerciales del ${from} al ${to}: tendencias, fuentes que mejor convierten, desempeño de asesores y 3 recomendaciones concretas.`;
  const body = html`
    <form class="filters" method="get">
      <label>Desde<input type="date" name="desde" value="${from}"></label>
      <label>Hasta<input type="date" name="hasta" value="${to}"></label>
      <button class="btn small" type="submit">Aplicar</button>
      <a class="btn ghost small" href="/admin/asistente?q=${encodeURIComponent(q)}">Pedir análisis al asistente</a>
    </form>
    <section class="kpis">
      <div class="kpi"><span>Prospectos</span><strong>${c.totales.prospectos}</strong><small>${from} a ${to}</small></div>
      <div class="kpi"><span>Citas activas</span><strong>${c.totales.citas}</strong></div>
      <div class="kpi"><span>Ventas</span><strong>${c.totales.ventas}</strong></div>
      <div class="kpi"><span>Conversión</span><strong>${c.totales.conversion_pct == null ? '—' : `${c.totales.conversion_pct}%`}</strong></div>
      <div class="kpi"><span>Respuesta promedio</span><strong>${minutes(c.totales.respuesta_promedio_min)}</strong></div>
      <div class="kpi"><span>Sin contactar</span><strong>${c.totales.sin_contactar}</strong></div>
    </section>
    <div class="grid2">
      <section class="card">${barChart({ title: 'Prospectos por mes (últimos 12 meses)', rows: t.prospectos_por_mes.map((m) => ({ label: monthLabel(m.mes), value: m.prospectos })) })}</section>
      <section class="card">${barChart({ title: 'Prospectos convertidos en venta, por mes de alta', rows: t.prospectos_por_mes.map((m) => ({ label: monthLabel(m.mes), value: m.convertidos })) })}</section>
      ${currencies.map((cur) => html`
        <section class="card">${barChart({ title: `Ventas registradas por mes · ${cur}`, rows: series(t.ventas_por_mes, cur, 'monto'), format: (v) => money(v, cur).replace(` ${cur}`, '') })}</section>
        <section class="card">${barChart({ title: `Cobranza por mes · ${cur}`, rows: series(t.cobranza_por_mes, cur, 'cobrado'), format: (v) => money(v, cur).replace(` ${cur}`, '') })}</section>`)}
    </div>
    <div class="grid2">
      <section class="card"><h2>Embudo del periodo</h2><div class="bars">${Object.entries(c.embudo).map(([label, n]) => html`<div class="bar"><span>${label}</span><i style="width: ${(n / maxStage) * 100}%"></i><b>${n}</b></div>`)}</div></section>
      <section class="card"><h2>Fuentes de captación</h2>
        <table><thead><tr><th>Fuente</th><th class="num">Prospectos</th><th class="num">Ventas</th><th class="num">Conversión</th></tr></thead>
        <tbody>${c.por_fuente.map((r) => html`<tr><td>${r.fuente}</td><td class="num">${r.prospectos}</td><td class="num">${r.ventas}</td><td class="num">${pct(r.ventas, r.prospectos)}</td></tr>`)}</tbody></table>
        ${c.por_fuente.length ? '' : html`<p class="muted">Sin prospectos en el periodo.</p>`}</section>
    </div>
    <div class="grid2">
      <section class="card"><h2>Asesores</h2>
        <table><thead><tr><th>Asesor</th><th class="num">Prospectos</th><th class="num">Ventas</th><th class="num">Conversión</th><th class="num">Respuesta</th></tr></thead>
        <tbody>${c.por_asesor.map((a) => html`<tr><td>${a.asesor}</td><td class="num">${a.prospectos}</td><td class="num">${a.ventas}</td><td class="num">${pct(a.ventas, a.prospectos)}</td><td class="num">${minutes(a.respuesta_promedio_min)}</td></tr>`)}</tbody></table></section>
      <section class="card"><h2>Desarrollos</h2>
        <table><thead><tr><th>Desarrollo</th><th class="num">Prospectos</th><th class="num">Ventas</th><th class="num">Conversión</th></tr></thead>
        <tbody>${c.por_desarrollo.map((d) => html`<tr><td>${d.desarrollo}</td><td class="num">${d.prospectos}</td><td class="num">${d.ventas}</td><td class="num">${pct(d.ventas, d.prospectos)}</td></tr>`)}</tbody></table></section>
    </div>`;
  res.send(String(adminPage({ req, title: 'Analítica y reportes', active: '/admin/analitica', body })));
});

export default router;
