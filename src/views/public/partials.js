import { pad2 } from '../../services/developments.js';
import { html } from '../html.js';
import { waHref } from './layout.js';

const M = 'font-family: Montserrat, sans-serif';

export function statBox(st) {
  return html`<div style="background: #F6F3EE; padding: 14px 16px; display: flex; flex-direction: column; gap: 4px"><span style="${M}; font-weight: 600; font-size: 11px; letter-spacing: 0.14em; color: #5D6678">${st.label}</span><span style="${M}; font-weight: 800; font-size: 20px; color: #0F1626">${st.value}</span>${st.detail ? html`<span style="font-size: 13px; color: #5D6678">${st.detail}</span>` : ''}</div>`;
}

export function totalBox(d) {
  return html`<div style="background: #0F1626; padding: 14px 16px; display: flex; flex-direction: column; gap: 4px"><span style="${M}; font-weight: 600; font-size: 11px; letter-spacing: 0.14em; color: #A9B3C4">PRECIO TOTAL</span><span style="${M}; font-weight: 800; font-size: 20px; color: #FFFFFF">${d.total_price || 'Por confirmar'}</span></div>`;
}

export const chips = (features) => html`<div style="display: flex; flex-wrap: wrap; gap: 8px">${features.map((f) => html`<span style="font-size: 13px; padding: 6px 12px; border: 1px solid #D9D1C3; border-radius: 999px">${f}</span>`)}</div>`;

export function badges(d) {
  return html`<span style="position: absolute; left: 0; top: 16px; background: #0F1626; color: #FFFFFF; padding: 8px 14px; ${M}; font-weight: 700; font-size: 12px; letter-spacing: 0.16em">${pad2(d.number)} · ${(d.zone || 'Por confirmar').toUpperCase()}</span>${d.badge ? html`<span style="position: absolute; right: 16px; top: 16px; background: #F08A3E; color: #0F1626; padding: 8px 14px; ${M}; font-weight: 800; font-size: 12px; letter-spacing: 0.12em">${d.badge}</span>` : ''}`;
}

export function devCard(d, s) {
  const url = `/desarrollos/${d.slug}`;
  return html`
        <article style="background: #FFFFFF; border: 1px solid #E2DBCF; display: flex; flex-direction: column; min-width: 0">
          <a href="${url}" style="position: relative; display: block" aria-label="Ver ${d.name}"><img src="${d.cover_image || ''}" alt="${d.cover_alt}" loading="lazy" style="display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover">${badges(d)}</a>
          <div style="padding: 28px; display: flex; flex-direction: column; gap: 20px; flex: 1">
            <div style="display: flex; flex-direction: column; gap: 8px"><h3 style="margin: 0; ${M}; font-weight: 800; font-size: 26px; color: #0F1626"><a href="${url}" style="color: inherit; text-decoration: none">${d.name}</a></h3><span style="font-size: 16px; color: #4A5468">${d.location}</span></div>
            <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px">
              ${(d.stats || []).slice(0, 3).map(statBox)}
              ${totalBox(d)}
            </div>
            ${chips(d.features || [])}
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-top: auto; padding-top: 4px">
              <a href="${url}" style="background: #0F1626; color: #FFFFFF; text-decoration: none; ${M}; font-weight: 700; font-size: 14px; padding: 14px 20px">Ver detalles</a>
              <a href="${waHref(s, `Hola, me interesa información sobre ${d.name}.`)}" target="_blank" rel="noopener" style="border: 1.5px solid #D9D1C3; color: #0F1626; text-decoration: none; ${M}; font-weight: 700; font-size: 14px; padding: 13px 18px">WhatsApp</a>
              <a href="/?desarrollo=${d.slug}#informes" data-pick-development="${d.id}" style="color: #1747B8; text-decoration: none; ${M}; font-weight: 700; font-size: 14px; padding: 14px 4px">Solicitar información →</a>
            </div>
          </div>
        </article>`;
}

const LABEL = `${M}; font-weight: 600; font-size: 11px; letter-spacing: 0.14em; color: #5D6678`;

export function leadForm({ developments, selectedId, sent, errors = {}, values = {}, s }) {
  if (sent) {
    return html`<div class="lead-done" role="status" style="background: #FFFFFF; border: 1px solid #E2DBCF; padding: 32px; display: flex; flex-direction: column; gap: 14px">
      <span style="${M}; font-weight: 800; font-size: 24px; color: #0F1626">¡Gracias! Recibimos tu solicitud.</span>
      <span style="font-size: 16px; line-height: 1.6; color: #4A5468">Un asesor de CONNOR se comunicará contigo muy pronto. Si prefieres, escríbenos ahora mismo por WhatsApp.</span>
      <a href="${waHref(s)}" target="_blank" rel="noopener" style="align-self: flex-start; background: #1F5FE0; color: #FFFFFF; text-decoration: none; ${M}; font-weight: 700; font-size: 15px; padding: 15px 24px">Escribir por WhatsApp</a>
    </div>`;
  }
  const v = (k) => values[k] ?? '';
  const err = (k) => (errors[k] ? html`<span class="field-error">${errors[k]}</span>` : '');
  return html`<form class="lead-form" method="post" action="/contacto#informes" novalidate style="background: #FFFFFF; border: 1px solid #E2DBCF; padding: clamp(20px, 3vw, 32px); display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr)); gap: 18px">
      ${errors._form ? html`<div class="form-alert" role="alert" style="grid-column: 1 / -1">${errors._form}</div>` : ''}
      <label class="field" style="grid-column: 1 / -1"><span style="${LABEL}">NOMBRE COMPLETO *</span><input name="name" required maxlength="120" autocomplete="name" value="${v('name')}">${err('name')}</label>
      <label class="field"><span style="${LABEL}">PAÍS</span><select name="country"><option value="52" ${v('country') !== '1' ? 'selected' : ''}>México (+52)</option><option value="1" ${v('country') === '1' ? 'selected' : ''}>EE. UU. (+1)</option></select></label>
      <label class="field"><span style="${LABEL}">TELÉFONO / WHATSAPP *</span><input name="phone" type="tel" required maxlength="20" autocomplete="tel-national" inputmode="tel" value="${v('phone')}" placeholder="10 dígitos">${err('phone')}</label>
      <label class="field" style="grid-column: 1 / -1"><span style="${LABEL}">CORREO (OPCIONAL)</span><input name="email" type="email" maxlength="160" autocomplete="email" value="${v('email')}">${err('email')}</label>
      <label class="field"><span style="${LABEL}">DESARROLLO DE INTERÉS</span><select name="development_id"><option value="">Aún no lo sé</option>${developments.map((d) => html`<option value="${d.id}" ${String(selectedId) === String(d.id) ? 'selected' : ''}>${d.name}</option>`)}</select></label>
      <label class="field"><span style="${LABEL}">PRESUPUESTO APROXIMADO</span><select name="budget">${['', 'Menos de $150,000 MXN', '$150,000 – $300,000 MXN', '$300,000 – $600,000 MXN', 'Más de $600,000 MXN', 'Pago en dólares'].map((b) => html`<option value="${b}" ${v('budget') === b ? 'selected' : ''}>${b || 'Prefiero no decir'}</option>`)}</select></label>
      <fieldset class="field" style="grid-column: 1 / -1; border: 0; padding: 0; margin: 0"><legend style="${LABEL}; margin-bottom: 8px">¿QUÉ TE GUSTARÍA?</legend>
        <div style="display: flex; flex-wrap: wrap; gap: 10px 24px; font-size: 16px">
          <label class="radio"><input type="radio" name="intent" value="info" ${v('intent') !== 'visita' ? 'checked' : ''}> Recibir información</label>
          <label class="radio"><input type="radio" name="intent" value="visita" ${v('intent') === 'visita' ? 'checked' : ''}> Agendar una visita</label>
        </div>
      </fieldset>
      <label class="field visit-date"><span style="${LABEL}">FECHA PREFERIDA DE VISITA</span><input name="visit_date" type="date" value="${v('visit_date')}">${err('visit_date')}</label>
      <label class="field" style="grid-column: 1 / -1"><span style="${LABEL}">MENSAJE (OPCIONAL)</span><textarea name="message" rows="3" maxlength="2000">${v('message')}</textarea></label>
      <label class="hp" aria-hidden="true">No llenar<input name="website" tabindex="-1" autocomplete="off"></label>
      <label class="check" style="grid-column: 1 / -1"><input type="checkbox" name="consent" value="1" required ${v('consent') ? 'checked' : ''}> <span>Acepto el <a href="/aviso-de-privacidad" target="_blank">aviso de privacidad</a> y que CONNOR me contacte por teléfono o WhatsApp. *</span></label>
      ${err('consent')}
      <div style="grid-column: 1 / -1"><button type="submit" style="background: #1F5FE0; color: #FFFFFF; border: 0; cursor: pointer; ${M}; font-weight: 700; font-size: 15px; padding: 17px 28px">Enviar solicitud</button></div>
    </form>`;
}

export function leadSection({ developments, selectedId, sent, errors, values, s }) {
  return html`
  <!-- SOLICITUD DE INFORMACIÓN -->
  <section id="informes" style="background: #FFFFFF; border-top: 1px solid #E2DBCF">
    <div style="max-width: 1200px; margin: 0 auto; padding: clamp(64px, 9vw, 120px) clamp(16px, 4vw, 40px); display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: clamp(32px, 6vw, 80px); align-items: start">
      <div style="display: flex; flex-direction: column; gap: 20px">
        <div style="${M}; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; color: #1747B8">SOLICITA INFORMACIÓN</div>
        <h2 style="margin: 0; ${M}; font-weight: 800; font-size: clamp(2rem, 3.6vw, 3rem); line-height: 1.08; letter-spacing: -0.02em; color: #0F1626">Recibe información y agenda tu visita.</h2>
        <p style="margin: 0; font-size: 18px; line-height: 1.7; color: #4A5468">Déjanos tus datos y un asesor te contactará con precios, disponibilidad y planes de financiamiento del desarrollo que te interesa.</p>
      </div>
      ${leadForm({ developments, selectedId, sent, errors, values, s })}
    </div>
  </section>`;
}
