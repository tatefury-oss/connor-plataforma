import { Router } from 'express';
import {
  REF_TYPES, addMembers, channelsFor, createGroup, deleteMessage, directory, markRead, membersOf, messagesFor, openDirect, parseRef,
  readAllNotifications, readNotification, removeMember, renameGroup, sendMessage, notificationsFor, unreadNotifications, unreadTotal,
} from '../../services/chat.js';
import { fmtDateTime, html } from '../../views/html.js';
import { ROLES } from '../../security/rbac.js';
import { adminPage, csrfField } from '../../views/admin/layout.js';

const router = Router();
const err = (res, url, msg) => res.redirect(303, `${url}?error=${encodeURIComponent(msg)}`);
const wantsJson = (req) => req.accepts(['html', 'json']) === 'json';

export function renderMessage(m, me, csrf) {
  if (m.system) return html`<div class="cmsg system" data-id="${m.id}"><span>${m.body}</span> <time>${fmtDateTime(m.created_at)}</time></div>`;
  const mine = m.user_id === me.id;
  return html`<div class="cmsg ${mine ? 'mine' : ''}" data-id="${m.id}">
    <div class="meta"><strong>${mine ? 'Tú' : m.author ?? 'Usuario eliminado'}</strong> <time>${fmtDateTime(m.created_at)}</time></div>
    ${m.deleted_at ? html`<p class="deleted">Mensaje eliminado</p>` : html`
      ${m.body ? html`<p>${m.body}</p>` : ''}
      ${m.ref ? html`<div class="ref">${REF_TYPES[m.ref_type]}: ${m.ref.url ? html`<a href="${m.ref.url}">${m.ref.label}</a>` : html`<span class="muted">${m.ref.label}</span>`}</div>` : ''}
      ${mine ? html`<form method="post" action="/admin/chat/${m.channel_id}/mensajes/${m.id}/eliminar" class="del" data-confirm="¿Eliminar este mensaje?"><input type="hidden" name="_csrf" value="${csrf}"><button class="link" type="submit">Eliminar</button></form>` : ''}`}
  </div>`;
}

async function chatPage(req, res, channelId = null) {
  let data = null;
  let members = [];
  if (channelId) {
    data = await messagesFor(req.user, channelId);
    if (!data) return null;
    members = await membersOf(data.channel.id);
    const lastId = data.messages.at(-1)?.id ?? 0;
    // Se marca como leída antes de calcular los contadores, para que la lista y el menú ya no la cuenten.
    if (lastId > data.channel.last_read_id) {
      await markRead(req.user, data.channel.id, lastId);
      req.badges = { ...req.badges, chat: await unreadTotal(req.user) };
    }
  }
  const [channels, people] = await Promise.all([channelsFor(req.user), directory(req.user)]);
  const ch = data?.channel;
  const title = ch ? (ch.kind === 'group' ? ch.name : members.find((m) => m.id !== req.user.id)?.name ?? 'Mensaje directo') : 'Chat del equipo';
  const ref = parseRef(req.query.ref);
  const body = html`
    <div class="chat-layout">
      <aside class="channels">
        <form class="mini-stack" method="post" action="/admin/chat/directo">${csrfField(req)}
          <select name="user_id" required><option value="">Mensaje directo a…</option>${people.map((p) => html`<option value="${p.id}">${p.name} · ${ROLES[p.role]}</option>`)}</select>
          ${ref ? html`<input type="hidden" name="ref" value="${req.query.ref}">` : ''}
          <button class="btn small" type="submit">Abrir</button></form>
        <details ${channels.length ? '' : 'open'}><summary>+ Nuevo grupo de trabajo</summary>
          <form class="mini-stack" method="post" action="/admin/chat/grupos">${csrfField(req)}
            <input name="name" required maxlength="80" placeholder="Nombre (p. ej. Ventas La Rumorosa)">
            <select name="members" multiple size="6" required aria-label="Integrantes">${people.map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select>
            <small class="muted">Ctrl/⌘ + clic para elegir varios.</small>
            <button class="btn small" type="submit">Crear grupo</button></form></details>
        <ul id="channel-list">${channels.map((c) => html`<li class="${ch?.id === c.id ? 'on' : ''}" data-channel="${c.id}"><a href="/admin/chat/${c.id}${ref ? `?ref=${encodeURIComponent(req.query.ref)}` : ''}">
          <span class="ctitle">${c.kind === 'group' ? '# ' : ''}${c.title ?? '—'}</span>${c.unread ? html`<b class="count">${c.unread}</b>` : ''}</a></li>`)}</ul>
        ${channels.length ? '' : html`<p class="muted">Aún no tienes conversaciones.</p>`}
      </aside>
      <section class="chat-pane">
        ${ch ? html`
          <header class="chat-head"><div><h2>${ch.kind === 'group' ? '# ' : ''}${title}</h2><small class="muted">${members.map((m) => m.name).join(', ')}</small></div>
            ${ch.kind === 'group' ? html`<details class="group-admin"><summary>Grupo</summary>
              ${ch.my_role === 'owner' ? html`
                <form class="mini-stack" method="post" action="/admin/chat/${ch.id}/renombrar">${csrfField(req)}<input name="name" value="${ch.name}" maxlength="80" required><button class="btn small ghost" type="submit">Cambiar nombre</button></form>
                <form class="mini-stack" method="post" action="/admin/chat/${ch.id}/miembros">${csrfField(req)}<select name="members" multiple size="4">${people.filter((p) => !members.some((m) => m.id === p.id)).map((p) => html`<option value="${p.id}">${p.name}</option>`)}</select><button class="btn small ghost" type="submit">Agregar</button></form>
                <ul class="member-list">${members.filter((m) => m.id !== req.user.id).map((m) => html`<li>${m.name}${m.member_role === 'owner' ? ' (admin)' : ''}<form method="post" action="/admin/chat/${ch.id}/miembros/${m.id}/quitar" data-confirm="¿Quitar a ${m.name}?">${csrfField(req)}<button class="link danger" type="submit">Quitar</button></form></li>`)}</ul>` : ''}
              <form method="post" action="/admin/chat/${ch.id}/miembros/${req.user.id}/quitar" data-confirm="¿Salir del grupo?">${csrfField(req)}<button class="link danger" type="submit">Salir del grupo</button></form>
            </details>` : ''}
          </header>
          <div class="cthread" id="cthread" data-channel="${ch.id}" data-last="${data.messages.at(-1)?.id ?? 0}" data-me="${req.user.id}">
            ${data.messages.map((m) => renderMessage(m, req.user, req.csrfToken))}
            ${data.messages.length ? '' : html`<p class="muted empty-note">Escribe el primer mensaje.</p>`}
          </div>
          <form class="ask" id="chat-form" method="post" action="/admin/chat/${ch.id}/mensajes">${csrfField(req)}
            <div class="compose">
              ${ref ? html`<div class="ref pending-ref">Compartirás: ${REF_TYPES[ref.type]} #${ref.id} <a href="/admin/chat/${ch.id}">quitar</a><input type="hidden" name="ref" value="${req.query.ref}"></div>` : ''}
              <textarea name="body" rows="2" maxlength="4000" placeholder="Escribe un mensaje… (Enter envía, Shift+Enter salto de línea)"></textarea>
            </div>
            <button class="btn" type="submit">Enviar</button>
          </form>`
        : html`<div class="empty"><h2>Chat del equipo</h2><p class="muted">Abre un mensaje directo o crea un grupo de trabajo. Puedes compartir prospectos, lotes, ventas y desarrollos: cada persona los ve según sus permisos.</p>
            ${ref ? html`<p class="alert ok">Elige a quién enviar: ${REF_TYPES[ref.type]} #${ref.id}</p>` : ''}</div>`}
      </section>
    </div>
    <script src="/js/chat.js" defer></script>`;
  return adminPage({ req, title: 'Chat', active: '/admin/chat', body });
}

router.get('/admin/chat', async (req, res) => res.send(String(await chatPage(req, res))));

router.get('/admin/chat/contadores', async (req, res) => {
  const [chat, notifications] = await Promise.all([unreadTotal(req.user), unreadNotifications(req.user)]);
  res.json({ chat, notifications });
});

router.get('/admin/chat/:id', async (req, res, next) => {
  const page = await chatPage(req, res, req.params.id);
  if (!page) return next();
  res.send(String(page));
});

router.get('/admin/chat/:id/mensajes', async (req, res, next) => {
  const data = await messagesFor(req.user, req.params.id, { after: req.query.after });
  if (!data) return next();
  const last = (data.messages.at(-1)?.id ?? Number(req.query.after)) || 0;
  if (data.messages.length) await markRead(req.user, data.channel.id, last);
  res.json({ html: data.messages.map((m) => String(renderMessage(m, req.user, req.csrfToken))).join(''), last });
});

router.post('/admin/chat/directo', async (req, res) => {
  const r = await openDirect(req.user, req.body.user_id);
  if (r.error) return err(res, '/admin/chat', r.error);
  const ref = parseRef(req.body.ref) ? `?ref=${encodeURIComponent(req.body.ref)}` : '';
  res.redirect(303, `/admin/chat/${r.id}${ref}`);
});

router.post('/admin/chat/grupos', async (req, res) => {
  const r = await createGroup(req.user, req.body.name, req.body.members);
  if (r.error) return err(res, '/admin/chat', r.error);
  res.redirect(303, `/admin/chat/${r.id}`);
});

router.post('/admin/chat/:id/mensajes', async (req, res, next) => {
  const r = await sendMessage(req.user, req.params.id, { body: req.body.body, ref: req.body.ref });
  if (r.error === 'not_found') return next();
  if (wantsJson(req)) return res.status(r.error ? 422 : 200).json(r);
  if (r.error) return err(res, `/admin/chat/${req.params.id}`, r.error);
  res.redirect(303, `/admin/chat/${req.params.id}`);
});

router.post('/admin/chat/:id/mensajes/:mid/eliminar', async (req, res, next) => {
  const r = await deleteMessage(req.user, req.params.id, req.params.mid);
  if (r.error) return next();
  res.redirect(303, `/admin/chat/${req.params.id}`);
});

router.post('/admin/chat/:id/renombrar', async (req, res, next) => {
  const r = await renameGroup(req.user, req.params.id, req.body.name);
  if (r.error === 'not_found') return next();
  if (r.error) return err(res, `/admin/chat/${req.params.id}`, r.error);
  res.redirect(303, `/admin/chat/${req.params.id}`);
});

router.post('/admin/chat/:id/miembros', async (req, res, next) => {
  const r = await addMembers(req.user, req.params.id, req.body.members ?? []);
  if (r.error === 'not_found') return next();
  if (r.error) return err(res, `/admin/chat/${req.params.id}`, r.error);
  res.redirect(303, `/admin/chat/${req.params.id}`);
});

router.post('/admin/chat/:id/miembros/:uid/quitar', async (req, res, next) => {
  const r = await removeMember(req.user, req.params.id, req.params.uid);
  if (r.error === 'not_found') return next();
  if (r.error) return err(res, `/admin/chat/${req.params.id}`, r.error);
  res.redirect(303, Number(req.params.uid) === req.user.id ? '/admin/chat' : `/admin/chat/${req.params.id}`);
});

// ---------- Notificaciones ----------
router.get('/admin/notificaciones', async (req, res) => {
  const rows = await notificationsFor(req.user, 100);
  const body = html`
    <div class="toolbar"><form method="post" action="/admin/notificaciones/leidas">${csrfField(req)}<button class="btn ghost small" type="submit">Marcar todas como leídas</button></form></div>
    <section class="card flush"><ul class="notif-list">
      ${rows.map((n) => html`<li class="${n.read_at ? '' : 'unread'}"><a href="/admin/notificaciones/${n.id}"><strong>${n.title}</strong><span>${n.body}</span><time>${fmtDateTime(n.created_at)}</time></a></li>`)}
    </ul>${rows.length ? '' : html`<p class="muted pad">Sin notificaciones.</p>`}</section>`;
  res.send(String(adminPage({ req, title: 'Notificaciones', active: '/admin/notificaciones', body })));
});

router.get('/admin/notificaciones/:id', async (req, res, next) => {
  const n = await readNotification(req.user, req.params.id);
  if (!n) return next();
  // Solo rutas internas del panel.
  res.redirect(303, typeof n.url === 'string' && /^\/admin(\/|$)/.test(n.url) ? n.url : '/admin/notificaciones');
});

router.post('/admin/notificaciones/leidas', async (req, res) => {
  await readAllNotifications(req.user);
  res.redirect(303, '/admin/notificaciones');
});

export default router;
