// Chat del asistente interno: envía sin recargar y muestra la respuesta (HTML ya saneado por el servidor).
(() => {
  const form = document.getElementById('ask-form');
  const thread = document.getElementById('thread');
  if (!form || !thread) return;
  const textarea = form.querySelector('textarea');
  const button = form.querySelector('button[type=submit]');
  const convInput = form.querySelector('input[name=conversation_id]');
  const csrf = document.querySelector('meta[name=csrf-token]')?.content;

  function bubble(role, content, isHtml = false) {
    thread.querySelector('.empty')?.remove();
    const el = document.createElement('div');
    el.className = `bubble ${role}`;
    if (isHtml) el.innerHTML = content; else { const p = document.createElement('p'); p.textContent = content; el.append(p); }
    thread.append(el);
    el.scrollIntoView({ block: 'end', behavior: 'smooth' });
    return el;
  }

  async function send(text) {
    if (!text.trim() || button.disabled) return;
    bubble('user', text);
    textarea.value = '';
    button.disabled = true;
    const wait = bubble('assistant pending', 'Consultando la información…');
    try {
      const res = await fetch(form.action, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'x-csrf-token': csrf },
        body: new URLSearchParams({ _csrf: csrf, conversation_id: convInput.value, text }),
      });
      const data = await res.json().catch(() => ({}));
      wait.remove();
      if (data.conversationId && !convInput.value) {
        convInput.value = data.conversationId;
        history.replaceState(null, '', `/admin/asistente/${data.conversationId}`);
      }
      if (data.html) bubble('assistant', data.html, true);
      else bubble('assistant error', data.error || 'No se pudo obtener respuesta.');
    } catch {
      wait.remove();
      bubble('assistant error', 'Sin conexión con el servidor.');
    } finally {
      button.disabled = false;
      textarea.focus();
    }
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(textarea.value); });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(textarea.value); }
  });
  thread.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-suggest]');
    if (chip) send(chip.dataset.suggest);
  });
  thread.lastElementChild?.scrollIntoView({ block: 'end' });
})();
