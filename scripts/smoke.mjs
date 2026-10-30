// Prueba de humo de punta a punta contra un servidor en marcha (después de cada despliegue).
// Uso: SMOKE_URL=https://connor.mx SMOKE_EMAIL=... SMOKE_PASSWORD=... npm run smoke
// No modifica datos de clientes: solo lee páginas, valida cabeceras y prueba el acceso.
const base = (process.env.SMOKE_URL || 'http://localhost:3000').replace(/\/$/, '');
const results = [];
const check = async (name, fn) => {
  const t = Date.now();
  try { await fn(); results.push(['OK', name, Date.now() - t]); } catch (err) { results.push(['FALLA', `${name}: ${err.message}`, Date.now() - t]); }
};
const assert = (c, msg) => { if (!c) throw new Error(msg); };
const jar = {};
const req = async (path, init = {}) => {
  const res = await fetch(base + path, { redirect: 'manual', ...init, headers: { ...(init.headers || {}), cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } });
  for (const c of res.headers.getSetCookie()) { const [p] = c.split(';'); const i = p.indexOf('='); jar[p.slice(0, i)] = p.slice(i + 1); }
  return res;
};

await check('Base de datos lista (/readyz)', async () => assert((await (await req('/readyz')).json()).db === true, 'la base no responde'));
await check('Portada pública', async () => {
  const r = await req('/'); const html = await r.text();
  assert(r.status === 200, `estado ${r.status}`);
  assert(html.includes('Construimos'), 'falta el contenido de la portada');
  assert(/script-src 'self'/.test(r.headers.get('content-security-policy') || ''), 'falta CSP');
  if (base.startsWith('https')) assert(r.headers.get('strict-transport-security'), 'falta HSTS');
});
await check('Ficha de desarrollo', async () => assert((await req('/desarrollos/valle-del-borrego')).status === 200, 'no carga'));
await check('Aviso de privacidad', async () => assert((await req('/aviso-de-privacidad')).status === 200, 'no carga'));
await check('Panel exige sesión', async () => assert((await req('/admin/prospectos')).status === 303, 'el panel respondió sin sesión'));
await check('Recursos estáticos', async () => assert((await req('/css/site.css')).status === 200 && (await req('/socket.io/socket.io.min.js')).status === 200, 'faltan recursos'));
if (process.env.SMOKE_EMAIL) {
  await check('Inicio de sesión', async () => {
    const page = await (await req('/admin/login')).text();
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page)?.[1];
    const r = await req('/admin/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: csrf, email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD || '', next: '/admin' }) });
    assert(r.status === 303 && r.headers.get('location') === '/admin', `no inició sesión (estado ${r.status})`);
  });
  for (const p of ['/admin', '/admin/chat', '/admin/notificaciones', '/admin/cuenta']) {
    await check(`Página ${p}`, async () => { const r = await req(p); assert(r.status === 200, `estado ${r.status}`); assert(r.headers.get('cache-control') === 'no-store', 'se puede cachear'); });
  }
}
let failed = 0;
for (const [s, name, ms] of results) { if (s !== 'OK') failed++; console.log(`${s.padEnd(5)} ${name} (${ms} ms)`); }
console.log(failed ? `\n${failed} verificación(es) fallaron` : '\nTodo en orden');
process.exit(failed ? 1 : 0);
