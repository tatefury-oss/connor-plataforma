// Mejora progresiva del formulario: envía sin recargar y muestra errores en línea.
document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-pick-development]');
  const select = document.querySelector('.lead-form select[name=development_id]');
  if (link && select && location.pathname === '/') {
    select.value = link.dataset.pickDevelopment;
  }
});

document.addEventListener('submit', async (e) => {
  const form = e.target.closest('.lead-form');
  if (!form) return;
  e.preventDefault();
  const button = form.querySelector('button[type=submit]');
  form.querySelectorAll('.field-error, .form-alert').forEach((el) => el.remove());
  button.disabled = true;
  try {
    const res = await fetch(form.action, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(new FormData(form)),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      const done = document.createElement('div');
      done.className = 'lead-done';
      done.setAttribute('role', 'status');
      done.style.cssText = 'background:#FFFFFF;border:1px solid #E2DBCF;padding:32px;display:flex;flex-direction:column;gap:14px';
      const t = document.createElement('span');
      t.style.cssText = 'font-family:Montserrat,sans-serif;font-weight:800;font-size:24px;color:#0F1626';
      t.textContent = '¡Gracias! Recibimos tu solicitud.';
      const p = document.createElement('span');
      p.style.cssText = 'font-size:16px;line-height:1.6;color:#4A5468';
      p.textContent = 'Un asesor de CONNOR se comunicará contigo muy pronto.';
      done.append(t, p);
      form.replaceWith(done);
      return;
    }
    const errors = data.errors || { _form: res.status === 429 ? 'Demasiadas solicitudes. Intenta más tarde.' : 'No pudimos enviar tu solicitud. Intenta de nuevo.' };
    for (const [key, msg] of Object.entries(errors)) {
      const el = document.createElement('span');
      el.className = key === '_form' ? 'form-alert' : 'field-error';
      el.textContent = msg;
      const field = key === 'consent' ? form.querySelector('.check') : form.querySelector(`[name="${CSS.escape(key)}"]`)?.closest('.field');
      if (key !== '_form' && field) {
        if (key === 'consent') field.after(el); else field.append(el);
      } else {
        form.prepend(el);
      }
    }
  } catch {
    const el = document.createElement('div');
    el.className = 'form-alert';
    el.textContent = 'Sin conexión. Revisa tu internet e intenta de nuevo.';
    form.prepend(el);
  } finally {
    button.disabled = false;
  }
});
