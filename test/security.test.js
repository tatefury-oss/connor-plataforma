import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { createApp } from '../src/app.js';
import { one, query } from '../src/db.js';
import { originAllowed } from '../src/security/origin.js';
import { createSale } from '../src/services/finance.js';
import { changeLotStatus, importLots, parseLots } from '../src/services/inventory.js';
import { captureLead } from '../src/services/leads.js';
import { anonymizeLead, applyRetention } from '../src/services/privacy.js';
import { client, setup, PASSWORD } from './helpers.js';

let ctx;
let users;
before(async () => { ctx = await setup(); users = ctx.users; });
after(async () => { await ctx.close(); });
const as = (key, role) => ({ id: users[key], role, name: key });

function routes() {
  const out = [];
  const walk = (stack) => {
    for (const l of stack) {
      if (l.route) for (const m of Object.keys(l.route.methods)) out.push([m.toUpperCase(), l.route.path]);
      else if (l.handle?.stack) walk(l.handle.stack);
    }
  };
  walk(createApp().router.stack);
  return out;
}

describe('control de acceso a todas las rutas del panel', () => {
  test('ninguna ruta privada responde sin sesión', async () => {
    const privateRoutes = routes().filter(([, p]) => typeof p === 'string' && p.startsWith('/admin') && !p.startsWith('/admin/login'));
    assert.ok(privateRoutes.length > 60, `se esperaban muchas rutas, hay ${privateRoutes.length}`);
    for (const [method, path] of privateRoutes) {
      const url = path.replace(/:[a-z]+/gi, '1');
      const res = await fetch(ctx.base + url, { method, redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: method === 'GET' ? undefined : 'x=1' });
      assert.ok([303, 401, 403].includes(res.status), `${method} ${path} respondió ${res.status} sin sesión`);
      if (res.status === 303) assert.match(res.headers.get('location'), /^\/admin\/login/);
    }
  });

  test('las páginas del panel no se guardan en caché y llevan CSP', async () => {
    const c = client(ctx.base);
    await c.login('admin@test.local');
    const res = await c.req('/admin');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  });
});

describe('sesiones y contraseñas', () => {
  test('iniciar sesión invalida la sesión anterior del mismo navegador', async () => {
    const first = client(ctx.base);
    await first.login('gerente@test.local');
    const oldToken = first.jar.connor_sid;
    // El mismo navegador (con la cookie vieja) vuelve a iniciar sesión.
    const browser = client(ctx.base);
    const page = await browser.req('/admin/login');
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text_)[1];
    browser.jar.connor_sid = oldToken;
    const res = await browser.req('/admin/login', { method: 'POST', form: { _csrf: csrf, email: 'admin@test.local', password: PASSWORD, next: '/admin' } });
    assert.equal(res.status, 303);
    assert.notEqual(browser.jar.connor_sid, oldToken);
    const stale = client(ctx.base);
    stale.jar.connor_sid = oldToken;
    assert.equal((await stale.req('/admin')).status, 303, 'la sesión anterior ya no sirve');
  });

  test('cambiar la contraseña exige la actual y cierra los otros dispositivos', async () => {
    const laptop = client(ctx.base);
    const phone = client(ctx.base);
    await laptop.login('beto@test.local');
    await phone.login('beto@test.local');
    const csrf = await laptop.csrf();
    const bad = await laptop.req('/admin/cuenta/contrasena', { method: 'POST', form: { _csrf: csrf, current: 'equivocada-123456', password: 'Nueva-Contrasena-2026', confirm: 'Nueva-Contrasena-2026' } });
    assert.match(bad.headers.get('location'), /error=/);
    const ok = await laptop.req('/admin/cuenta/contrasena', { method: 'POST', form: { _csrf: csrf, current: PASSWORD, password: 'Nueva-Contrasena-2026', confirm: 'Nueva-Contrasena-2026' } });
    assert.match(ok.headers.get('location'), /msg=ok/);
    assert.equal((await laptop.req('/admin')).status, 200, 'la sesión actual sigue activa');
    assert.equal((await phone.req('/admin')).status, 303, 'el otro dispositivo queda fuera');
    assert.equal((await client(ctx.base).login('beto@test.local', 'Nueva-Contrasena-2026')).status, 303);
    await query(`UPDATE users SET password_hash = (SELECT password_hash FROM users WHERE id = $1) WHERE id = $2`, [users.ana, users.beto]);
  });
});

describe('entradas maliciosas', () => {
  test('inyección SQL en filtros no rompe ni filtra datos', async () => {
    const c = client(ctx.base);
    await c.login('ana@test.local');
    for (const q of ["' OR 1=1 --", "x'; DROP TABLE leads; --", '%', '\\', "1) UNION SELECT password_hash FROM users --"]) {
      const res = await c.req(`/admin/prospectos?q=${encodeURIComponent(q)}&stage=${encodeURIComponent(q)}&development=${encodeURIComponent(q)}&tag=${encodeURIComponent(q)}`);
      assert.equal(res.status, 200, q);
      assert.ok(!res.text_.includes('scrypt$'));
    }
    assert.ok(await one('SELECT 1 FROM leads LIMIT 1') !== undefined, 'la tabla sigue existiendo');
  });

  test('no hay recorrido de directorios en archivos', async () => {
    for (const p of ['/uploads/../package.json', '/uploads/%2e%2e/package.json', '/uploads/..%2f.env', '/css/../../.env']) {
      const res = await fetch(ctx.base + p);
      assert.ok(res.status === 404 || res.status === 400, `${p} → ${res.status}`);
      assert.ok(!(await res.text()).includes('DATABASE_URL'));
    }
  });

  test('Socket.IO solo acepta conexiones del propio sitio', () => {
    const opts = { publicUrl: 'https://connor.mx', isProd: true };
    assert.equal(originAllowed('https://connor.mx', 'connor.mx', opts), true);
    assert.equal(originAllowed('https://evil.example', 'connor.mx', opts), false);
    assert.equal(originAllowed(undefined, 'connor.mx', opts), false);
    assert.equal(originAllowed('null', 'connor.mx', opts), false);
    assert.equal(originAllowed('http://localhost:4000', 'localhost:4000', { publicUrl: 'http://localhost:3000', isProd: false }), true);
    assert.equal(originAllowed('http://localhost:4000', 'localhost:4000', { publicUrl: 'https://connor.mx', isProd: true }), false);
  });

  test('chequeo de salud con base de datos', async () => {
    assert.deepEqual(await (await fetch(`${ctx.base}/readyz`)).json(), { ok: true, db: true });
  });
});

describe('protección de datos personales (ARCO)', () => {
  test('acceso: el administrador descarga los datos del titular; otros roles no', async () => {
    const lead = await captureLead({ name: 'Titular Acceso', phone: '6641110001', source: 'web', email: 'titular@correo.mx', consent: true });
    const a = client(ctx.base);
    await a.login('admin@test.local');
    const res = await a.req(`/admin/prospectos/${lead.id}/datos-personales.json`);
    assert.equal(res.status, 200);
    const data = JSON.parse(res.text_);
    assert.equal(data.titular.correo, 'titular@correo.mx');
    assert.ok(data.titular.consentimiento_aviso_privacidad);
    const g = client(ctx.base);
    await g.login('gerente@test.local');
    assert.equal((await g.req(`/admin/prospectos/${lead.id}/datos-personales.json`)).status, 403);
  });

  test('cancelación: elimina datos personales sin dejarlos en la bitácora', async () => {
    const lead = await captureLead({ name: 'Titular Cancelación', phone: '6641110002', source: 'web', email: 'borrar@correo.mx', message: 'Mi domicilio es Calle 1' });
    assert.equal((await anonymizeLead(as('gerente', 'gerencia'), lead.id, 'ARCO-1', null)).error, 'forbidden');
    assert.ok((await anonymizeLead(as('admin', 'admin'), lead.id, 'ARCO-2026-001', null)).anonymized);
    const row = await one('SELECT name, phone, email, phone_normalized FROM leads WHERE id = $1', [lead.id]);
    assert.equal(row.name, `Titular anonimizado #${lead.id}`);
    assert.equal(row.phone ?? row.email ?? row.phone_normalized, null);
    const leftovers = await one(`SELECT count(*)::int AS n FROM lead_activities WHERE lead_id = $1 AND body LIKE '%Calle 1%'`, [lead.id]);
    assert.equal(leftovers.n, 0);
    const auditRow = await one(`SELECT details FROM audit_log WHERE action = 'privacy.anonymize' AND entity_id = $1`, [String(lead.id)]);
    assert.ok(!JSON.stringify(auditRow.details).includes('borrar@correo.mx'));
    // El mismo teléfono puede volver a registrarse como prospecto nuevo.
    const again = await captureLead({ name: 'Nuevo contacto', phone: '6641110002', source: 'web' });
    assert.notEqual(again.id, lead.id);
  });

  test('si hay ventas, los datos se conservan por obligación legal y se bloquea su uso comercial', async () => {
    const dev = await one(`SELECT id FROM developments WHERE slug = 'los-pinos'`);
    await importLots(dev.id, parseLots('ARCO-1;A;1;600;20;30;500000').rows, 'MXN', null);
    const lead = await captureLead({ name: 'Cliente con venta', phone: '6641110003', source: 'web' });
    const lot = await one(`SELECT id FROM lots WHERE code = 'ARCO-1'`);
    assert.ok((await changeLotStatus(as('admin', 'admin'), lot.id, { status: 'vendido', leadId: lead.id }, null)).ok);
    assert.ok((await createSale(as('admin', 'admin'), { lotId: lot.id, saleDate: '2026-01-01', agreedPrice: '500000', downPayment: '500000', downPaymentDate: '2026-01-01', installments: 0 }, null)).id);
    const r = await anonymizeLead(as('admin', 'admin'), lead.id, 'ARCO-2', null);
    assert.ok(r.blocked);
    const row = await one('SELECT name, tags, bot_paused_at FROM leads WHERE id = $1', [lead.id]);
    assert.equal(row.name, 'Cliente con venta');
    assert.ok(row.tags.includes('no-contactar'));
    assert.ok(row.bot_paused_at);
  });

  test('retención: borra notificaciones leídas antiguas y conserva las pendientes', async () => {
    await query(`INSERT INTO notifications (user_id, type, title, read_at, created_at) VALUES
      ($1, 'x', 'vieja leída', now() - interval '200 days', now() - interval '200 days'),
      ($1, 'x', 'vieja sin leer', NULL, now() - interval '200 days')`, [users.admin]);
    const r = await applyRetention();
    assert.ok(r.notifications >= 1);
    assert.equal(await one(`SELECT 1 FROM notifications WHERE title = 'vieja leída'`), null);
    assert.ok(await one(`SELECT 1 FROM notifications WHERE title = 'vieja sin leer'`));
  });
});

describe('integridad del calendario', () => {
  test('el acumulado guardado coincide con la suma de parcialidades anteriores', async () => {
    const bad = await one(`SELECT count(*)::int AS n FROM installments i
      WHERE i.before_amount <> COALESCE((SELECT sum(amount) FROM installments j WHERE j.sale_id = i.sale_id AND j.number < i.number), 0)`);
    assert.equal(bad.n, 0);
  });
});

describe('configuración de producción', () => {
  test('exige HTTPS y conexión segura o privada a la base', async () => {
    const { config, productionProblems } = await import('../src/config.js');
    const saved = { ...config };
    Object.assign(config, { isProd: true, publicUrl: 'http://connor.mx', databaseUrl: 'postgres://u:p@dpg-abc/connor', databaseSsl: false, databasePrivateNetwork: false });
    assert.equal(productionProblems().length, 2);
    Object.assign(config, { publicUrl: 'https://connor-plataforma.onrender.com', databasePrivateNetwork: true });
    assert.deepEqual(productionProblems(), []);
    Object.assign(config, saved);
  });
});
