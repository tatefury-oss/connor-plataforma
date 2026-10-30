import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { one, query } from '../../db.js';
import { ROLES, requirePermission } from '../../security/rbac.js';
import { hashPassword, passwordProblem, verifyPassword } from '../../security/passwords.js';
import { destroyOtherSessions } from '../../security/session.js';
import { audit } from '../../services/audit.js';
import { anonymizeLead, exportLeadData } from '../../services/privacy.js';
import { fmtDateTime, html } from '../../views/html.js';
import { adminPage, csrfField } from '../../views/admin/layout.js';

const router = Router();

const passwordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
  message: 'Demasiados intentos. Espera 15 minutos.' });

// ---------- Mi cuenta ----------
router.get('/admin/cuenta', async (req, res) => {
  const [u, sessions] = await Promise.all([
    one('SELECT name, email, role, last_login_at FROM users WHERE id = $1', [req.user.id]),
    one('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1 AND expires_at > now()', [req.user.id]),
  ]);
  const body = html`<div class="grid2">
    <section class="card"><h2>Mi cuenta</h2>
      <p><strong>${u.name}</strong><br>${u.email}<br>${ROLES[u.role]}</p>
      <p class="muted">Último acceso: ${fmtDateTime(u.last_login_at)} · Sesiones abiertas: ${sessions.n}</p>
      <form method="post" action="/admin/cuenta/cerrar-otras">${csrfField(req)}<button class="btn ghost small" type="submit">Cerrar sesión en los demás dispositivos</button></form>
    </section>
    <form class="card form" method="post" action="/admin/cuenta/contrasena">${csrfField(req)}
      <h2>Cambiar contraseña</h2>
      <div class="fields">
        <label class="wide">Contraseña actual<input type="password" name="current" required autocomplete="current-password"></label>
        <label>Nueva (mín. 12 caracteres)<input type="password" name="password" required minlength="12" autocomplete="new-password"></label>
        <label>Confirmar<input type="password" name="confirm" required minlength="12" autocomplete="new-password"></label>
      </div>
      <p class="muted">Al cambiarla se cierran tus sesiones en otros dispositivos.</p>
      <button class="btn" type="submit">Cambiar contraseña</button>
    </form></div>`;
  res.send(String(adminPage({ req, title: 'Mi cuenta', active: '/admin/cuenta', body })));
});

router.post('/admin/cuenta/contrasena', passwordLimiter, async (req, res) => {
  const back = (q) => res.redirect(303, `/admin/cuenta?${q}`);
  const u = await one('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  if (!(await verifyPassword(String(req.body.current ?? ''), u.password_hash))) {
    await audit({ req, action: 'auth.password_change_failed', entity: 'user', entityId: req.user.id });
    return back(`error=${encodeURIComponent('La contraseña actual no es correcta.')}`);
  }
  const problem = passwordProblem(req.body.password);
  if (problem) return back(`error=${encodeURIComponent(problem)}`);
  if (req.body.password !== req.body.confirm) return back(`error=${encodeURIComponent('La confirmación no coincide.')}`);
  if (await verifyPassword(req.body.password, u.password_hash)) return back(`error=${encodeURIComponent('La nueva contraseña debe ser distinta de la actual.')}`);
  await query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [req.user.id, await hashPassword(req.body.password)]);
  await destroyOtherSessions(req);
  await audit({ req, action: 'auth.password_change', entity: 'user', entityId: req.user.id });
  back('msg=ok');
});

router.post('/admin/cuenta/cerrar-otras', async (req, res) => {
  await destroyOtherSessions(req);
  await audit({ req, action: 'auth.logout_others', entity: 'user', entityId: req.user.id });
  res.redirect(303, '/admin/cuenta?msg=ok');
});

// ---------- Derechos ARCO ----------
router.get('/admin/prospectos/:id/datos-personales.json', requirePermission('privacy.manage'), async (req, res, next) => {
  const r = await exportLeadData(req.user, req.params.id, req);
  if (r.error) return next();
  res.set('Content-Disposition', `attachment; filename="datos-personales-${Number(req.params.id)}.json"`);
  res.json(r);
});

router.post('/admin/prospectos/:id/anonimizar', requirePermission('privacy.manage'), async (req, res, next) => {
  const r = await anonymizeLead(req.user, req.params.id, req.body.reason, req);
  if (r.error === 'not_found') return next();
  const back = `/admin/prospectos/${Number(req.params.id)}`;
  if (r.error) return res.redirect(303, `${back}?error=${encodeURIComponent(r.error)}`);
  res.redirect(303, `${back}?aviso=${encodeURIComponent(r.blocked
    ? 'El titular tiene ventas o lotes: sus datos se conservan por obligación legal y quedaron bloqueados para uso comercial.'
    : 'Datos personales eliminados.')}`);
});

export default router;
