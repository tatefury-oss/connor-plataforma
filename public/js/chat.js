// Conversación abierta: envía sin recargar y trae los mensajes nuevos cuando llega un aviso por Socket.IO.
(() => {
  const thread = document.getElementById('cthread');
  const form = document.getElementById('chat-form');
  if (!thread || !form) return;
  const channel = Number(thread.dataset.channel);
  const csrf = document.querySelector('meta[name=csrf-token]')?.content;
  const textarea = form.querySelector('textarea');
  const button = form.querySelector('button[type=submit]');
  let loading = false;
  let again = false;

  const scrollDown = () => { thread.scrollTop = thread.scrollHeight; };
  scrollDown();

  // Pide al servidor los mensajes posteriores al último visible (ya renderizados con los permisos del usuario).
  async function pull() {
    if (loading) { again = true; return; }
    loading = true;
    try {
      do {
        again = false;
        const res = await fetch(`/admin/chat/${channel}/mensajes?after=${thread.dataset.last}`, { headers: { Accept: 'application/json' } });
        if (!res.ok) break;
        const data = await res.json();
        if (data.html) {
          thread.querySelector('.empty-note')?.remove();
          const nearBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
          thread.insertAdjacentHTML('beforeend', data.html);
          thread.dataset.last = data.last;
          if (nearBottom) scrollDown();
        }
      } while (again);
    } finally {
      loading = false;
    }
  }

  async function send() {
    const body = textarea.value.trim();
    const ref = form.querySelector('input[name=ref]')?.value ?? '';
    if ((!body && !ref) || button.disabled) return;
    button.disabled = true;
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'x-csrf-token': csrf },
        body: new URLSearchParams({ _csrf: csrf, body, ref }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { alert(data.error || 'No se pudo enviar el mensaje.'); return; }
      textarea.value = '';
      form.querySelector('.pending-ref')?.remove();
      if (ref) history.replaceState(null, '', `/admin/chat/${channel}`);
      await pull();
      scrollDown();
    } finally {
      button.disabled = false;
      textarea.focus();
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(); });
  textarea.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });

  const wire = () => {
    const socket = window.connorSocket;
    if (!socket) return setTimeout(wire, 200);
    socket.on('chat:message', (p) => { if (p.channelId === channel && p.fromId !== Number(thread.dataset.me)) pull(); });
    socket.on('chat:deleted', (p) => {
      if (p.channelId !== channel) return;
      const el = thread.querySelector(`[data-id="${p.messageId}"]`);
      if (el) { el.querySelectorAll('p, .ref, form').forEach((n) => n.remove()); el.insertAdjacentHTML('beforeend', '<p class="deleted">Mensaje eliminado</p>'); }
    });
    socket.on('connect', pull); // al reconectar se recupera lo que llegó mientras tanto
  };
  wire();
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(); });
})();
