import { config } from '../../config.js';
import { html, raw, safeUrl } from '../html.js';

const M = 'font-family: Montserrat, sans-serif';

export const ICON_PHONE = raw('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"></path>');

export const telHref = (s) => `tel:${s.phone_e164}`;
export const waHref = (s, text = s.whatsapp_message) =>
  `https://wa.me/${String(s.whatsapp_number).replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;

function brand(size = 'nav') {
  const big = size === 'footer';
  return html`<img src="/assets/325064d3b4316ae2578e7736d1db07c2.png" alt="" style="height: ${big ? 52 : 44}px; width: auto">
        <span style="display: flex; flex-direction: column; gap: ${big ? 4 : 3}px">
          <span style="${M}; font-weight: 800; font-size: ${big ? 24 : 22}px; line-height: 1${big ? '' : '; letter-spacing: 0.02em'}"><span style="color: #4F7FFF">CON</span>NOR</span>
          <span style="${M}; font-weight: 600; font-size: 10px; letter-spacing: 0.2em; color: #A9B3C4">CONSTRUCTORA DEL NOROESTE</span>
        </span>`;
}

// En la portada los enlaces son anclas; en otras páginas apuntan a la portada.
function header(s, home) {
  const base = home ? '' : '/';
  return html`
  <header style="background: #0F1626; color: #FFFFFF">
    <nav aria-label="Principal" style="max-width: 1200px; margin: 0 auto; padding: 18px clamp(16px, 4vw, 40px); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px 32px">
      <a href="${base}#inicio" style="display: flex; align-items: center; gap: 12px; text-decoration: none; color: #FFFFFF">
        ${brand()}
      </a>
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 8px 28px; ${M}; font-weight: 600; font-size: 14px">
        <a href="${base}#nosotros" style="color: #DCE2EC; text-decoration: none; padding: 12px 0">Nosotros</a>
        <a href="${base}#servicios" style="color: #DCE2EC; text-decoration: none; padding: 12px 0">Servicios</a>
        <a href="${base}#desarrollos" style="color: #DCE2EC; text-decoration: none; padding: 12px 0">Desarrollos</a>
        <a href="${base}#ubicacion" style="color: #DCE2EC; text-decoration: none; padding: 12px 0">Ubicación</a>
        <a href="${telHref(s)}" style="color: #FFFFFF; background: #1F5FE0; text-decoration: none; padding: 13px 20px">${s.phone_display}</a>
      </div>
    </nav>
  </header>`;
}

function footer(s, home) {
  const base = home ? '' : '/';
  const ig = s.instagram_handle && `https://www.instagram.com/${s.instagram_handle}`;
  const tt = s.tiktok_handle && `https://www.tiktok.com/@${s.tiktok_handle}`;
  return html`
  <footer id="contacto" style="background: #0F1626; color: #FFFFFF">
    <div style="max-width: 1200px; margin: 0 auto; padding: clamp(56px, 8vw, 96px) clamp(16px, 4vw, 40px) 40px; display: flex; flex-direction: column; gap: 48px">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 40px">
        <div style="display: flex; flex-direction: column; gap: 18px">
          <div style="display: flex; align-items: center; gap: 12px">
            ${brand('footer')}
          </div>
          <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #A9B3C4">Cuidamos tu patrimonio. Desarrollo inmobiliario en Tecate y el noroeste de México.</p>
        </div>
        <div style="display: flex; flex-direction: column; gap: 14px">
          <span style="${M}; font-weight: 700; font-size: 12px; letter-spacing: 0.2em; color: #A9B3C4">CONTACTO</span>
          <a href="${telHref(s)}" style="color: #FFFFFF; text-decoration: none; font-size: 18px; font-weight: 700">${s.phone_display}</a>
          <a href="${waHref(s)}" target="_blank" rel="noopener" style="color: #FFFFFF; text-decoration: none; font-size: 16px">WhatsApp · ${s.phone_display}</a>
          ${s.email ? html`<a href="mailto:${s.email}" style="font-size: 16px; color: #C9D0DC; text-decoration: none">${s.email}</a>` : ''}
          ${s.office_address ? html`<span style="font-size: 16px; color: #C9D0DC">${s.office_address}</span>` : ''}
        </div>
        <div style="display: flex; flex-direction: column; gap: 14px">
          <span style="${M}; font-weight: 700; font-size: 12px; letter-spacing: 0.2em; color: #A9B3C4">SÍGUENOS</span>
          ${ig ? html`<a href="${ig}" target="_blank" rel="noopener" style="color: #FFFFFF; text-decoration: none; font-size: 16px">Instagram · @${s.instagram_handle}</a>` : ''}
          ${tt ? html`<a href="${tt}" target="_blank" rel="noopener" style="color: #FFFFFF; text-decoration: none; font-size: 16px">TikTok · @${s.tiktok_handle}</a>` : ''}
          ${s.facebook_url
            ? html`<a href="${safeUrl(s.facebook_url)}" target="_blank" rel="noopener" style="color: #FFFFFF; text-decoration: none; font-size: 16px">Facebook · ${s.facebook_name}</a>`
            : s.facebook_name ? html`<span style="font-size: 16px; color: #FFFFFF">Facebook · ${s.facebook_name}</span>` : ''}
        </div>
        <div style="display: flex; flex-direction: column; gap: 14px">
          <span style="${M}; font-weight: 700; font-size: 12px; letter-spacing: 0.2em; color: #A9B3C4">NAVEGA</span>
          <a href="${base}#nosotros" style="color: #C9D0DC; text-decoration: none; font-size: 16px">Nosotros</a>
          <a href="${base}#servicios" style="color: #C9D0DC; text-decoration: none; font-size: 16px">Servicios</a>
          <a href="${base}#desarrollos" style="color: #C9D0DC; text-decoration: none; font-size: 16px">Desarrollos</a>
          <a href="${base}#ubicacion" style="color: #C9D0DC; text-decoration: none; font-size: 16px">Ubicación</a>
          <a href="/aviso-de-privacidad" style="color: #C9D0DC; text-decoration: none; font-size: 16px">Aviso de privacidad</a>
        </div>
      </div>
      <div style="border-top: 1px solid rgba(255,255,255,0.12); padding-top: 24px; display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; font-size: 14px; color: #7F8AA0">
        <span>© ${new Date().getFullYear()} ${s.company_name}</span>
        <span>Tecate · El Cóndor · La Rumorosa · Baja California</span>
      </div>
    </div>
  </footer>`;
}

const WA_ICON = raw('<svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.3-.9.9-.9 2.2s1 2.5 1.1 2.7c.1.2 1.9 2.9 4.6 4 1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.2z"/></svg>');

export function page({ s, title, description, home = false, body, ogImage }) {
  const fullTitle = title ? `${title} · ${s.company_name}` : `${s.company_name} · Terrenos en Tecate y La Rumorosa`;
  return html`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fullTitle}</title>
<meta name="description" content="${description || s.hero_text}">
<meta property="og:title" content="${fullTitle}">
<meta property="og:description" content="${description || s.hero_text}">
<meta property="og:type" content="website">
${ogImage ? html`<meta property="og:image" content="${new URL(ogImage, config.publicUrl).href}">` : ''}
<meta name="theme-color" content="#0F1626">
<link rel="icon" href="/assets/325064d3b4316ae2578e7736d1db07c2.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&amp;family=Manrope:wght@400;500;600;700&amp;display=swap">
<link rel="stylesheet" href="/css/site.css">
<script src="/js/site.js" defer></script>
</head>
<body>
<div style="width: 100%; background: #F6F3EE; font-family: Manrope, sans-serif; color: #2B3347">
  <!-- NAV -->
  ${header(s, home)}
  <main>
  ${body}
  </main>
  <!-- CONTACTO / FOOTER -->
  ${footer(s, home)}
</div>
<a class="wa-float" href="${waHref(s)}" target="_blank" rel="noopener" aria-label="Escríbenos por WhatsApp">${WA_ICON}</a>
</body>
</html>`;
}
