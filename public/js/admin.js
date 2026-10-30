// Notificaciones en tiempo real del panel (Socket.IO) y pequeñas mejoras de interfaz.
(() => {
  const toasts = document.getElementById('toasts');
  const live = document.getElementById('live');

  function toast(text, href) {
    if (!toasts) return;
    const el = document.createElement('div');
    el.className = 'toast';
    el.append(document.createTextNode(text + ' '));
    if (href) {
      const a = document.createElement('a');
      a.href = href;
      a.textContent = 'Ver';
      el.append(a);
    }
    toasts.append(el);
    setTimeout(() => el.remove(), 12000);
  }

  let unread = 0;
  const baseTitle = document.title;
  const bump = () => { unread++; document.title = `(${unread}) ${baseTitle}`; };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { unread = 0; document.title = baseTitle; } });

  // En listas y tableros, se recarga en cuanto llega un cambio (si el usuario no está escribiendo).
  const refreshable = document.querySelector('[data-live-list], .board, .kpis');
  let pending = null;
  function refreshSoon() {
    if (!refreshable) return;
    clearTimeout(pending);
    pending = setTimeout(() => {
      const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
      if (!typing) location.reload();
    }, 1500);
  }

  if (window.io) {
    const socket = window.io({ transports: ['websocket', 'polling'] });
    socket.on('connect', () => live?.classList.add('on'));
    socket.on('disconnect', () => live?.classList.remove('on'));
    const lead = (msg) => (p) => { bump(); toast(`${msg}: ${p.name}`, `/admin/prospectos/${p.id}`); refreshSoon(); };
    socket.on('lead:assigned', lead('Prospecto asignado a ti'));
    socket.on('lead:new', lead('Nuevo prospecto'));
    socket.on('lead:unassigned', lead('Prospecto SIN ASIGNAR'));
    socket.on('lead:escalated', lead('Prospecto escalado'));
    socket.on('lead:handoff', lead('El asistente transfirió a'));
    socket.on('lead:visit', lead('Solicitud de visita por WhatsApp'));
    socket.on('finance:changed', () => { if (location.pathname.startsWith('/admin/finanzas')) refreshSoon(); });
    socket.on('lot:changed', () => { if (/^\/admin\/(proyectos|lotes)/.test(location.pathname)) refreshSoon(); });
    socket.on('lot:expired', (p) => { bump(); toast(`Venció el apartado del lote ${p.code}`, `/admin/lotes/${p.id}`); });
    socket.on('wa:message', (p) => {
      bump();
      toast(`WhatsApp de ${p.name}: ${String(p.body).slice(0, 80)}`, `/admin/prospectos/${p.leadId}`);
      if (location.pathname === `/admin/prospectos/${p.leadId}`) refreshSoon();
    });
  }

  document.addEventListener('submit', (e) => {
    const msg = e.target.dataset.confirm;
    if (msg && !confirm(msg)) e.preventDefault();
  });
  document.addEventListener('change', (e) => {
    if (e.target.matches('[data-autosubmit]')) e.target.form.submit();
  });
})();
