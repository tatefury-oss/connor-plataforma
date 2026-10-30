import { html } from '../html.js';
import { page } from './layout.js';

const M = 'font-family: Montserrat, sans-serif';

export function privacyPage({ s }) {
  const contact = [s.email, s.phone_display].filter(Boolean).join(' o al ');
  const text = s.privacy_notice || [
    `${s.company_name}, con domicilio en Tecate, Baja California${s.office_address ? ` (${s.office_address})` : ''}, es responsable del tratamiento de los datos personales que nos proporcionas.`,
    'Los datos que recabamos a través de este sitio y de WhatsApp (nombre, teléfono, correo electrónico, desarrollo de interés, presupuesto aproximado y mensajes) se utilizan para atender tu solicitud de información, darte seguimiento comercial, agendar visitas y, en su caso, formalizar la compra de un lote.',
    'No vendemos ni compartimos tus datos con terceros ajenos a la operación comercial de la empresa. El acceso a tu información está restringido al personal autorizado.',
    `Puedes ejercer tus derechos de acceso, rectificación, cancelación u oposición (ARCO), o revocar tu consentimiento, escribiendo al ${contact}.`,
    'Este aviso puede actualizarse; la versión vigente siempre estará publicada en esta página.',
  ].join('\n\n');
  const body = html`
  <section>
    <div style="max-width: 820px; margin: 0 auto; padding: clamp(48px, 7vw, 96px) clamp(16px, 4vw, 40px); display: flex; flex-direction: column; gap: 22px">
      <div style="${M}; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; color: #1747B8">AVISO DE PRIVACIDAD</div>
      <h1 style="margin: 0; ${M}; font-weight: 800; font-size: clamp(2rem, 3.6vw, 3rem); line-height: 1.08; color: #0F1626">Protección de tus datos personales</h1>
      ${text.split(/\n{2,}/).map((p) => html`<p style="margin: 0; font-size: 17px; line-height: 1.7">${p}</p>`)}
    </div>
  </section>`;
  return page({ s, title: 'Aviso de privacidad', body });
}

export function notFoundPage({ s }) {
  const body = html`
  <section>
    <div style="max-width: 820px; margin: 0 auto; padding: clamp(64px, 9vw, 120px) clamp(16px, 4vw, 40px); display: flex; flex-direction: column; gap: 22px">
      <div style="${M}; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; color: #1747B8">404</div>
      <h1 style="margin: 0; ${M}; font-weight: 800; font-size: clamp(2rem, 3.6vw, 3rem); color: #0F1626">No encontramos esta página.</h1>
      <a href="/" style="align-self: flex-start; background: #1F5FE0; color: #FFFFFF; text-decoration: none; ${M}; font-weight: 700; font-size: 15px; padding: 17px 28px">Volver al inicio</a>
    </div>
  </section>`;
  return page({ s, title: 'Página no encontrada', body });
}
