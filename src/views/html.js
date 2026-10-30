// Plantillas con escape automático: todo valor interpolado se escapa salvo que se marque con raw().
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

class Raw {
  constructor(value) { this.value = value; }
  toString() { return this.value; }
}

export const raw = (v) => new Raw(String(v ?? ''));
export const escape = (v) => String(v ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);

function render(v) {
  if (v == null || v === false) return '';
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(render).join('');
  return escape(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
  return new Raw(out);
}

// Solo URLs http(s), tel:, mailto:, wa.me o rutas relativas; bloquea javascript: y similares.
export function safeUrl(url) {
  const u = String(url ?? '').trim();
  if (/^(https?:|tel:|mailto:)/i.test(u) || u.startsWith('/') || u.startsWith('#')) return u;
  return '#';
}

export const fmtDate = (d) => {
  if (!d) return '';
  // Una fecha sin hora ('AAAA-MM-DD') es un día de calendario: no se convierte de zona horaria.
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
    return new Date(`${d}T12:00:00Z`).toLocaleDateString('es-MX', { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' });
  }
  return new Date(d).toLocaleDateString('es-MX', { timeZone: 'America/Tijuana', day: '2-digit', month: 'short', year: 'numeric' });
};
export const fmtDateTime = (d) => (d ? new Date(d).toLocaleString('es-MX', { timeZone: 'America/Tijuana', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

// Valor para <input type="datetime-local"> en hora de Tijuana.
export function toLocalInput(d) {
  if (!d) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Tijuana', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(d)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// Interpreta un valor de <input type="datetime-local"> como hora de Tijuana.
export function fromLocalInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(String(value ?? ''));
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let t = asUtc;
  for (let i = 0; i < 2; i++) {
    const shown = toLocalInput(new Date(t));
    const [d, h] = shown.split('T');
    const [y, mo, da] = d.split('-').map(Number);
    const [hh, mm] = h.split(':').map(Number);
    t += asUtc - Date.UTC(y, mo - 1, da, hh, mm);
  }
  return new Date(t);
}
