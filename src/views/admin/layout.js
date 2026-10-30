import { can, canSeeFinance, canSeeLeads, ROLES } from '../../security/rbac.js';
import { html } from '../html.js';

const NAV = [
  ['/admin', 'Tablero', () => true],
  ['/admin/prospectos', 'Prospectos', canSeeLeads],
  ['/admin/embudo', 'Embudo', canSeeLeads],
  ['/admin/proyectos', 'Proyectos e inventario', (u) => can(u, 'inventory.view')],
  ['/admin/finanzas', 'Finanzas y cartera', canSeeFinance],
  ['/admin/desarrollos', 'Desarrollos', (u) => can(u, 'developments.manage')],
  ['/admin/configuracion', 'Sitio público', (u) => can(u, 'settings.manage')],
  ['/admin/usuarios', 'Usuarios', (u) => can(u, 'users.manage')],
  ['/admin/auditoria', 'Auditoría', (u) => can(u, 'audit.view')],
];

export const csrfField = (req) => html`<input type="hidden" name="_csrf" value="${req.csrfToken}">`;

export function flash(req) {
  const msg = { ok: 'Cambios guardados.', creado: 'Registro creado.', enviado: 'Mensaje enviado.' }[req.query.msg];
  const err = req.query.error;
  const notice = typeof req.query.aviso === 'string' ? req.query.aviso.slice(0, 200) : '';
  return html`${msg ? html`<div class="alert ok" role="status">${msg}</div>` : ''}${notice ? html`<div class="alert ok" role="status">${notice}</div>` : ''}${err ? html`<div class="alert err" role="alert">${err}</div>` : ''}`;
}

export function adminPage({ req, title, body, active }) {
  const u = req.user;
  return html`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="csrf-token" content="${req.csrfToken}">
<title>${title} · Panel CONNOR</title>
<link rel="icon" href="/assets/325064d3b4316ae2578e7736d1db07c2.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&amp;family=Manrope:wght@400;500;600;700&amp;display=swap">
<link rel="stylesheet" href="/css/admin.css">
<script src="/socket.io/socket.io.min.js" defer></script>
<script src="/js/admin.js" defer></script>
</head>
<body>
<div class="shell">
  <aside class="side">
    <a class="brand" href="/admin"><span><span class="accent">CON</span>NOR</span><small>PANEL PRIVADO</small></a>
    <nav aria-label="Panel">
      ${NAV.filter(([, , ok]) => ok(u)).map(([href, label]) => html`<a href="${href}" class="${active === href ? 'on' : ''}">${label}</a>`)}
    </nav>
    <div class="me">
      <strong>${u.name}</strong>
      <span>${ROLES[u.role]}</span>
      ${u.role === 'asesor' ? html`<form method="post" action="/admin/disponibilidad">${csrfField(req)}<button class="link" type="submit">${u.available ? '● Disponible para recibir prospectos' : '○ No disponible'}</button></form>` : ''}
      <form method="post" action="/admin/logout">${csrfField(req)}<button class="link" type="submit">Cerrar sesión</button></form>
    </div>
  </aside>
  <main class="main">
    <header class="top"><h1>${title}</h1><span class="live" id="live" title="Sincronización en tiempo real">●</span></header>
    ${flash(req)}
    ${body}
  </main>
</div>
<div id="toasts" aria-live="polite"></div>
</body>
</html>`;
}

export function loginPage({ csrf, error, next, email = '' }) {
  return html`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Acceso · Panel CONNOR</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&amp;family=Manrope:wght@400;500;600;700&amp;display=swap">
<link rel="stylesheet" href="/css/admin.css">
</head>
<body class="login">
  <form method="post" action="/admin/login" class="login-card">
    <img src="/assets/325064d3b4316ae2578e7736d1db07c2.png" alt="" height="52">
    <div class="brand big"><span><span class="accent">CON</span>NOR</span><small>CONSTRUCTORA DEL NOROESTE</small></div>
    ${error ? html`<div class="alert err" role="alert">${error}</div>` : ''}
    <input type="hidden" name="_csrf" value="${csrf}">
    <input type="hidden" name="next" value="${next}">
    <label>Correo<input type="email" name="email" value="${email}" required autocomplete="username" autofocus></label>
    <label>Contraseña<input type="password" name="password" required autocomplete="current-password"></label>
    <button class="btn" type="submit">Entrar</button>
  </form>
</body>
</html>`;
}

export function pager(base, query, total, page, perPage) {
  const pages = Math.max(1, Math.ceil(total / perPage));
  if (pages <= 1) return '';
  const link = (p) => {
    const q = new URLSearchParams(query);
    q.set('p', p);
    return `${base}?${q}`;
  };
  return html`<nav class="pager" aria-label="Paginación">
    ${page > 1 ? html`<a href="${link(page - 1)}">← Anterior</a>` : ''}
    <span>Página ${page} de ${pages} · ${total} registros</span>
    ${page < pages ? html`<a href="${link(page + 1)}">Siguiente →</a>` : ''}
  </nav>`;
}
