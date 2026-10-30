import { pool, query } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { seed } from '../src/seed.js';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/security/passwords.js';
import { flushNotifications } from '../src/services/realtime.js';

export const PASSWORD = 'Contrasena-de-prueba-1';

export async function setup() {
  if (!process.env.DATABASE_URL?.includes('_test')) throw new Error('Las pruebas solo corren contra una base *_test');
  await query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await migrate({ log: () => {} });
  await seed({ log: () => {} });
  const hash = await hashPassword(PASSWORD);
  const users = {};
  for (const [key, role] of [['admin', 'admin'], ['gerente', 'gerencia'], ['ana', 'asesor'], ['beto', 'asesor'], ['fina', 'finanzas']]) {
    const { rows: [u] } = await query('INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
      [`${key}@test.local`, key, role, hash]);
    users[key] = u.id;
  }
  const server = createApp().listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, users, close: async () => { server.close(); await flushNotifications(); await pool.end(); } };
}

// Cliente HTTP mínimo con cookies.
export function client(base) {
  const jar = {};
  async function req(path, { method = 'GET', form, headers = {}, body } = {}) {
    const h = { ...headers, cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (form) { h['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form).toString(); }
    const res = await fetch(base + path, { method, headers: h, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      jar[pair.slice(0, i)] = pair.slice(i + 1);
    }
    res.text_ = await res.text();
    return res;
  }
  return {
    jar,
    req,
    async login(email, password = PASSWORD) {
      const page = await req('/admin/login');
      const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text_)[1];
      return req('/admin/login', { method: 'POST', form: { _csrf: csrf, email, password, next: '/admin' } });
    },
    async csrf(path = '/admin') {
      return /name="csrf-token" content="([^"]+)"/.exec((await req(path)).text_)?.[1];
    },
  };
}
