import { Router } from 'express';
import { z } from 'zod';
import { many, one, tx } from '../../db.js';
import { ROLES, requirePermission } from '../../security/rbac.js';
import { hashPassword, passwordProblem } from '../../security/passwords.js';
import { destroyUserSessions } from '../../security/session.js';
import { audit } from '../../services/audit.js';
import { fmtDateTime, html } from '../../views/html.js';
import { adminPage, csrfField } from '../../views/admin/layout.js';

const router = Router();
router.use('/admin/usuarios', requirePermission('users.manage'));

const err = (res, url, msg) => res.redirect(303, `${url}?error=${encodeURIComponent(msg)}`);
const roleOptions = (sel) => Object.entries(ROLES).map(([k, v]) => html`<option value="${k}" ${sel === k ? 'selected' : ''}>${v}</option>`);

router.get('/admin/usuarios', async (req, res) => {
  const users = await many(`SELECT u.*, (SELECT count(*)::int FROM leads l WHERE l.assigned_to = u.id AND l.stage NOT IN ('cliente','perdido')) AS open_leads
                              FROM users u ORDER BY u.active DESC, u.role, u.name`);
  const body = html`
    <section class="card flush"><table class="list">
      <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th class="num">Prospectos abiertos</th><th>Último acceso</th></tr></thead>
      <tbody>${users.map((u) => html`<tr><td><a href="/admin/usuarios/${u.id}"><strong>${u.name}</strong></a></td><td>${u.email}</td><td>${ROLES[u.role]}</td>
        <td>${!u.active ? 'Inactivo' : u.locked_until && new Date(u.locked_until) > new Date() ? html`<span class="tag warn">Bloqueado</span>` : u.role === 'asesor' ? (u.available ? 'Disponible' : 'No disponible') : 'Activo'}</td>
        <td class="num">${u.role === 'asesor' ? u.open_leads : ''}</td><td>${fmtDateTime(u.last_login_at) || '—'}</td></tr>`)}</tbody>
    </table></section>
    <form class="card form" method="post" action="/admin/usuarios">
      ${csrfField(req)}
      <h2>Nuevo usuario</h2>
      <div class="fields">
        <label>Nombre *<input name="name" required maxlength="120"></label>
        <label>Correo *<input name="email" type="email" required maxlength="160"></label>
        <label>Teléfono<input name="phone" maxlength="20"></label>
        <label>Rol *<select name="role">${roleOptions('asesor')}</select></label>
        <label>Contraseña inicial * (mín. 12)<input name="password" type="password" required minlength="12" autocomplete="new-password"></label>
      </div>
      <button class="btn" type="submit">Crear usuario</button>
    </form>`;
  res.send(String(adminPage({ req, title: 'Usuarios', active: '/admin/usuarios', body })));
});

const createSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(160).transform((e) => e.toLowerCase()),
  phone: z.string().trim().max(20).default(''),
  role: z.enum(Object.keys(ROLES)),
  password: z.string(),
});

router.post('/admin/usuarios', async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return err(res, '/admin/usuarios', 'Revisa nombre, correo y rol.');
  const d = parsed.data;
  const problem = passwordProblem(d.password);
  if (problem) return err(res, '/admin/usuarios', problem);
  try {
    const u = await one(
      `INSERT INTO users (name, email, phone, role, password_hash) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [d.name, d.email, d.phone || null, d.role, await hashPassword(d.password)],
    );
    await audit({ req, action: 'user.create', entity: 'user', entityId: u.id, details: { email: d.email, role: d.role } });
    res.redirect(303, `/admin/usuarios/${u.id}?msg=creado`);
  } catch (e) {
    if (e.code === '23505') return err(res, '/admin/usuarios', 'Ya existe un usuario con ese correo.');
    throw e;
  }
});

router.get('/admin/usuarios/:id', async (req, res, next) => {
  const u = await one('SELECT * FROM users WHERE id = $1', [Number(req.params.id) || 0]);
  if (!u) return next();
  const body = html`
    <form class="card form" method="post" action="/admin/usuarios/${u.id}">
      ${csrfField(req)}
      <h2>Datos y permisos</h2>
      <div class="fields">
        <label>Nombre<input name="name" value="${u.name}" required maxlength="120"></label>
        <label>Correo<input value="${u.email}" disabled></label>
        <label>Teléfono<input name="phone" value="${u.phone ?? ''}" maxlength="20"></label>
        <label>Rol<select name="role">${roleOptions(u.role)}</select></label>
        <label class="check"><input type="checkbox" name="active" value="1" ${u.active ? 'checked' : ''}> Usuario activo</label>
        <label class="check"><input type="checkbox" name="available" value="1" ${u.available ? 'checked' : ''}> Disponible para Round Robin (asesores)</label>
      </div>
      <p class="muted">Desactivar a un usuario cierra sus sesiones. Sus prospectos se redistribuyen cuando el cliente vuelve a escribir, o puedes reasignarlos desde Prospectos.</p>
      <button class="btn" type="submit">Guardar</button>
    </form>
    <form class="card form" method="post" action="/admin/usuarios/${u.id}/password">
      ${csrfField(req)}
      <h2>Restablecer contraseña</h2>
      <div class="fields"><label>Nueva contraseña (mín. 12)<input name="password" type="password" required minlength="12" autocomplete="new-password"></label></div>
      <p class="muted">Se cerrarán todas las sesiones activas del usuario y se desbloqueará la cuenta.</p>
      <button class="btn ghost" type="submit">Cambiar contraseña</button>
    </form>`;
  res.send(String(adminPage({ req, title: u.name, active: '/admin/usuarios', body })));
});

router.post('/admin/usuarios/:id', async (req, res, next) => {
  const id = Number(req.params.id) || 0;
  const name = String(req.body.name ?? '').trim().slice(0, 120);
  const role = ROLES[req.body.role] ? req.body.role : null;
  const active = req.body.active === '1';
  const available = req.body.available === '1';
  if (name.length < 2 || !role) return err(res, `/admin/usuarios/${id}`, 'Datos no válidos.');
  if (id === req.user.id && (!active || role !== 'admin')) return err(res, `/admin/usuarios/${id}`, 'No puedes quitarte el rol de administrador ni desactivar tu propia cuenta.');
  const result = await tx(async (db) => {
    const before = (await db.query('SELECT * FROM users WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!before) return null;
    if (before.role === 'admin' && (role !== 'admin' || !active)) {
      const { rows: [{ n }] } = await db.query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active AND id <> $1`, [id]);
      if (!n) return { error: 'Debe existir al menos un administrador activo.' };
    }
    await db.query('UPDATE users SET name = $2, phone = $3, role = $4, active = $5, available = $6, updated_at = now() WHERE id = $1',
      [id, name, String(req.body.phone ?? '').trim().slice(0, 20) || null, role, active, available]);
    const changes = Object.fromEntries(Object.entries({ name, role, active, available }).filter(([k, v]) => before[k] !== v).map(([k, v]) => [k, { from: before[k], to: v }]));
    await audit({ db, req, action: 'user.update', entity: 'user', entityId: id, details: changes });
    return { before };
  });
  if (!result) return next();
  if (result.error) return err(res, `/admin/usuarios/${id}`, result.error);
  if (!active || result.before.role !== role) await destroyUserSessions(id);
  res.redirect(303, `/admin/usuarios/${id}?msg=ok`);
});

router.post('/admin/usuarios/:id/password', async (req, res, next) => {
  const id = Number(req.params.id) || 0;
  const problem = passwordProblem(req.body.password);
  if (problem) return err(res, `/admin/usuarios/${id}`, problem);
  const u = await one('UPDATE users SET password_hash = $2, failed_logins = 0, locked_until = NULL, updated_at = now() WHERE id = $1 RETURNING id',
    [id, await hashPassword(req.body.password)]);
  if (!u) return next();
  await destroyUserSessions(id);
  await audit({ req, action: 'user.password_reset', entity: 'user', entityId: id });
  if (id === req.user.id) return res.redirect(303, '/admin/login');
  res.redirect(303, `/admin/usuarios/${id}?msg=ok`);
});

export default router;
