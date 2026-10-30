import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { one, query } from '../db.js';

export const SESSION_COOKIE = config.isProd ? '__Host-connor_sid' : 'connor_sid';
const LOGIN_CSRF_COOKIE = config.isProd ? '__Host-connor_lcsrf' : 'connor_lcsrf';

const sha256 = (v) => createHash('sha256').update(v).digest('hex');
const token = () => randomBytes(32).toString('base64url');

const cookieOpts = (maxAgeMs) => ({
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'strict',
  path: '/',
  maxAge: maxAgeMs,
});

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return ba.length === bb.length && ba.length > 0 && timingSafeEqual(ba, bb);
}

export async function createSession(res, user, req) {
  const raw = token();
  const ttl = config.sessionHours * 3600 * 1000;
  await query(
    `INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + $6 * interval '1 millisecond')`,
    [sha256(raw), user.id, token(), req.ip, String(req.headers['user-agent'] || '').slice(0, 300), ttl],
  );
  res.cookie(SESSION_COOKIE, raw, cookieOpts(ttl));
}

export async function destroySession(req, res) {
  const raw = req.cookies?.[SESSION_COOKIE];
  if (raw) await query('DELETE FROM sessions WHERE id = $1', [sha256(raw)]);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function destroyUserSessions(userId) {
  await query('DELETE FROM sessions WHERE user_id = $1', [userId]);
}

// Resuelve la sesión del token en claro de la cookie. Renueva la expiración (sliding).
export async function sessionFromToken(raw) {
  if (!raw) return null;
  return one(
    `UPDATE sessions s SET last_seen_at = now(),
            expires_at = GREATEST(s.expires_at, now() + $2 * interval '1 hour')
       FROM users u
      WHERE s.id = $1 AND s.expires_at > now() AND u.id = s.user_id AND u.active
  RETURNING s.csrf_token, u.id, u.email, u.name, u.role, u.available`,
    [sha256(raw), config.sessionHours],
  );
}

export async function loadUser(req, _res, next) {
  const row = await sessionFromToken(req.cookies?.[SESSION_COOKIE]);
  if (row) {
    const { csrf_token: csrf, ...user } = row;
    req.user = user;
    req.csrfToken = csrf;
  }
  next();
}

// CSRF del formulario de acceso (antes de existir sesión): doble envío con cookie.
export function issueLoginCsrf(res) {
  const t = token();
  res.cookie(LOGIN_CSRF_COOKIE, t, cookieOpts(30 * 60 * 1000));
  return t;
}

export function checkLoginCsrf(req) {
  return safeEqual(req.cookies?.[LOGIN_CSRF_COOKIE], req.body?._csrf);
}

// Protege cualquier método que modifica datos dentro del panel.
export function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = req.body?._csrf || req.get('x-csrf-token');
  if (!req.csrfToken || !safeEqual(sent, req.csrfToken)) {
    return res.status(403).send('Solicitud rechazada (CSRF). Recarga la página e intenta de nuevo.');
  }
  next();
}
