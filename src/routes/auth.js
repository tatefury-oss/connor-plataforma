import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { one, query } from '../db.js';
import { audit } from '../services/audit.js';
import { DUMMY_HASH, verifyPassword } from '../security/passwords.js';
import { checkLoginCsrf, createSession, destroySession, issueLoginCsrf, requireCsrf } from '../security/session.js';
import { loginPage } from '../views/admin/layout.js';

const router = Router();
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Demasiados intentos de acceso. Espera 15 minutos.',
});

// Solo rutas internas para evitar redirecciones abiertas.
const safeNext = (n) => (typeof n === 'string' && /^\/admin(\/|$|\?)/.test(n) ? n : '/admin');

router.get('/admin/login', (req, res) => {
  if (req.user) return res.redirect(303, '/admin');
  res.send(String(loginPage({ csrf: issueLoginCsrf(res), next: safeNext(req.query.next) })));
});

router.post('/admin/login', loginLimiter, async (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase().slice(0, 160);
  const password = String(req.body?.password ?? '');
  const next = safeNext(req.body?.next);
  const fail = (status, error) =>
    res.status(status).send(String(loginPage({ csrf: issueLoginCsrf(res), next, email, error })));

  if (!checkLoginCsrf(req)) return fail(403, 'La sesión del formulario expiró. Intenta de nuevo.');

  const user = await one('SELECT * FROM users WHERE lower(email) = $1', [email]);
  const ok = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);

  if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
    await audit({ req, userId: user.id, action: 'auth.locked_attempt', entity: 'user', entityId: user.id });
    return fail(429, `Cuenta bloqueada temporalmente por intentos fallidos. Intenta en ${LOCK_MINUTES} minutos.`);
  }
  if (!user || !ok || !user.active) {
    if (user) {
      await query(
        `UPDATE users SET failed_logins = failed_logins + 1,
                locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + $3 * interval '1 minute' END
          WHERE id = $1`,
        [user.id, MAX_FAILS, LOCK_MINUTES],
      );
    }
    await audit({ req, userId: user?.id ?? null, action: 'auth.failed', entity: 'user', entityId: user?.id, details: { email } });
    return fail(401, 'Correo o contraseña incorrectos.');
  }

  await query('UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [user.id]);
  await createSession(res, user, req);
  await audit({ req, userId: user.id, action: 'auth.login', entity: 'user', entityId: user.id });
  res.redirect(303, next);
});

router.post('/admin/logout', requireCsrf, async (req, res) => {
  if (req.user) await audit({ req, action: 'auth.logout', entity: 'user', entityId: req.user.id });
  await destroySession(req, res);
  res.redirect(303, '/admin/login');
});

export default router;
