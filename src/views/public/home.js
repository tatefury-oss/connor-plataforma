import { pad2 } from '../../services/developments.js';
import { html, raw } from '../html.js';
import { ICON_PHONE, page, telHref } from './layout.js';
import { devCard, leadSection } from './partials.js';

const M = 'font-family: Montserrat, sans-serif';

// Posiciones de los marcadores del mapa esquemático por zona (coordenadas del SVG original).
const PIN_SLOTS = {
  tecate: [[250, 190], [318, 222], [284, 250], [220, 230]],
  'el condor': [[760, 312], [800, 330], [720, 330]],
  'la rumorosa': [[1015, 318], [1068, 318], [1040, 350], [990, 345]],
};
const zoneKey = (z) => String(z ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function joinEs(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} y ${items.at(-1)}`;
}

const VALUES = [
  ['Experiencia comprobada', '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><path d="M9 12l2 2 4-4"></path>'],
  ['Profesionales calificados', '<path d="M2 18h20"></path><path d="M4 18v-3a8 8 0 0 1 16 0v3"></path><path d="M10 7V5h4v2"></path>'],
  ['Compromiso y confianza', '<path d="M11 17l2 2a1.4 1.4 0 0 0 2-2"></path><path d="M14 14l2.5 2.5a1.4 1.4 0 0 0 2-2l-3.9-3.9a3 3 0 0 0-4.2 0l-.9.9a1.4 1.4 0 0 1-2-2l2.8-2.8a5 5 0 0 1 6.1-.8l.5.3a3 3 0 0 0 2 .4L21 6"></path><path d="M21 3v8h-2"></path><path d="M3 3l1 11 6 6"></path><path d="M3 4h8"></path>'],
  ['Soluciones a tu medida', '<path d="M3 21h18"></path><path d="M5 21V10l7-5 7 5v11"></path><path d="M10 21v-5h4v5"></path>'],
];

const SERVICES = [
  ['Demolición', 'Retiro seguro de estructuras existentes para liberar el predio.', '#0F1626', '<path d="M3 21h10"></path><path d="M5 21v-6h6v6"></path><path d="M8 15V9l6-5 6 3-3 4"></path><path d="M17 11l2 3"></path>'],
  ['Excavación', 'Movimiento de tierras y cortes con maquinaria pesada.', '#0F1626', '<path d="M2 20h20"></path><path d="M4 20v-4h8v4"></path><path d="M8 16V8l8-4 4 6-3 2"></path><path d="M17 12v3"></path>'],
  ['Preparación de terreno', 'Limpieza, nivelación y trazo de lotes y vialidades.', '#0F1626', '<rect x="7" y="7" width="10" height="7" rx="1"></rect><path d="M3 18h18"></path><circle cx="7" cy="18" r="2"></circle><circle cx="17" cy="18" r="2"></circle><path d="M3 11h4"></path>'],
  ['Desarrollo de fraccionamientos', 'Planeación, lotificación y urbanización de nuevos desarrollos.', '#1F5FE0', '<rect x="3" y="3" width="18" height="18" rx="1"></rect><path d="M3 9h18M9 21V9M15 9v12"></path>'],
  ['Venta de lotes y terrenos', 'Lotes residenciales y terrenos de inversión con financiamiento directo.', '#1F5FE0', '<circle cx="8" cy="15" r="4"></circle><path d="M11 12l9-9M17 6l3 3M14.5 8.5l2 2"></path>'],
  ['Atención personalizada', 'Te acompañamos desde la visita al terreno hasta tu escritura, con calidad en cada detalle.', '#1F5FE0', '<path d="M4 14v-2a8 8 0 0 1 16 0v2"></path><rect x="2" y="14" width="4" height="6" rx="1"></rect><rect x="18" y="14" width="4" height="6" rx="1"></rect><path d="M20 20a4 4 0 0 1-4 2h-3"></path>'],
];

function mapPins(developments) {
  const used = {};
  return developments.map((d) => {
    const slots = PIN_SLOTS[zoneKey(d.zone)];
    if (!slots) return '';
    const i = used[zoneKey(d.zone)] = (used[zoneKey(d.zone)] ?? -1) + 1;
    const [x, y] = slots[i % slots.length];
    return html`<a href="/desarrollos/${d.slug}" aria-label="${d.name}"><g transform="translate(${x} ${y})"><path d="M0 0C-5 -9 -16 -16 -16 -28A16 16 0 1 1 16 -28C16 -16 5 -9 0 0Z" fill="#1F5FE0" stroke="#FFFFFF" stroke-width="2"></path><text x="0" y="-23" text-anchor="middle" fill="#FFFFFF" font-family="Montserrat, sans-serif" font-size="12" font-weight="800">${pad2(d.number)}</text></g></a>`;
  });
}

export function homePage({ s, developments, selectedId, sent, errors, values }) {
  const zones = [...new Set(developments.map((d) => d.zone).filter(Boolean))];
  const body = html`
  <!-- HERO -->
  <section id="inicio" style="background: #0F1626; color: #FFFFFF">
    <div style="max-width: 1200px; margin: 0 auto; padding: clamp(48px, 7vw, 96px) clamp(16px, 4vw, 40px) clamp(56px, 8vw, 112px); display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr)); gap: clamp(32px, 5vw, 64px); align-items: center">
      <div style="display: flex; flex-direction: column; gap: 28px">
        <div style="${M}; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; color: #6E9BFF">${s.hero_eyebrow}</div>
        <h1 style="margin: 0; ${M}; font-weight: 800; font-size: clamp(2.4rem, 5.2vw, 4.4rem); line-height: 1.03; letter-spacing: -0.025em">${s.hero_title} <span style="color: #6E9BFF">${s.hero_title_accent}</span></h1>
        <p style="margin: 0; font-size: clamp(1.05rem, 1.6vw, 1.25rem); line-height: 1.6; color: #B6BFCE; max-width: 560px">${s.hero_text}</p>
        <div style="display: flex; flex-wrap: wrap; gap: 14px">
          <a href="#desarrollos" style="background: #1F5FE0; color: #FFFFFF; text-decoration: none; ${M}; font-weight: 700; font-size: 15px; padding: 17px 28px">Ver desarrollos</a>
          <a href="${telHref(s)}" style="border: 1.5px solid rgba(255,255,255,0.4); color: #FFFFFF; text-decoration: none; ${M}; font-weight: 700; font-size: 15px; padding: 16px 26px; display: flex; align-items: center; gap: 10px"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PHONE}</svg>Llamar ahora</a>
        </div>
      </div>
      <div style="position: relative">
        <img src="${s.hero_image}" alt="Equipo de CONNOR en un terreno en preparación" fetchpriority="high" style="display: block; width: 100%; aspect-ratio: 5 / 4; object-fit: cover">
        ${s.hero_caption ? html`<div style="position: absolute; left: 0; bottom: 0; background: #1F5FE0; color: #FFFFFF; padding: 16px 22px; ${M}; font-weight: 700; font-size: 14px; letter-spacing: 0.06em">${s.hero_caption}</div>` : ''}
      </div>
    </div>
  </section>

  <!-- VALORES -->
  <section aria-label="Nuestros valores" style="background: #FFFFFF; border-bottom: 1px solid #E2DBCF">
    <div style="max-width: 1200px; margin: 0 auto; padding: 32px clamp(16px, 4vw, 40px); display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 24px">
      ${VALUES.map(([label, icon]) => html`<div style="display: flex; align-items: center; gap: 14px"><span style="flex: none; width: 48px; height: 48px; background: #EAF0FE; color: #1747B8; display: flex; align-items: center; justify-content: center"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${raw(icon)}</svg></span><span style="${M}; font-weight: 700; font-size: 15px; color: #0F1626">${label}</span></div>`)}
    </div>
  </section>

  <!-- NOSOTROS -->
  <section id="nosotros">
    <div style="max-width: 1200px; margin: 0 auto; padding: clamp(64px, 9vw, 120px) clamp(16px, 4vw, 40px); display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: clamp(32px, 6vw, 80px); align-items: center">
      <img src="/assets/27c048977bfc0e8cbd76274f689b310f.jpg" alt="Cuadrilla de CONNOR instalando recubrimiento en muro" loading="lazy" style="display: block; width: 100%; aspect-ratio: 4 / 5; object-fit: cover">
      <div style="display: flex; flex-direction: column; gap: 24px">
        <div style="${M}; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; color: #1747B8">QUIÉNES SOMOS</div>
        <h2 style="margin: 0; ${M}; font-weight: 800; font-size: clamp(2rem, 3.6vw, 3rem); line-height: 1.08; letter-spacing: -0.02em; color: #0F1626">${s.about_title}</h2>
        <p style="margin: 0; font-size: 18px; line-height: 1.7">${s.about_text_1}</p>
        ${s.about_text_2 ? html`<p style="margin: 0; font-size: 18px; line-height: 1.7; color: #4A5468">${s.about_text_2}</p>` : ''}
        ${[['Misión', s.mission], ['Visión', s.vision], ['Filosofía', s.philosophy]].filter(([, t]) => t).map(([k, t]) => html`<p style="margin: 0; font-size: 17px; line-height: 1.7; color: #4A5468"><strong style="${M}; color: #0F1626">${k}.</strong> ${t}</p>`)}
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 0; border-top: 1px solid #D9D1C3; margin-top: 8px">
          <div style="padding: 22px 16px 0 0; display: flex; flex-direction: column; gap: 6px"><span style="${M}; font-weight: 800; font-size: 36px; color: #1747B8">${developments.length}</span><span style="font-size: 15px; color: #4A5468">Desarrollos en comercialización</span></div>
          <div style="padding: 22px 16px 0 0; display: flex; flex-direction: column; gap: 6px"><span style="${M}; font-weight: 800; font-size: 36px; color: #1747B8">${zones.length}</span><span style="font-size: 15px; color: #4A5468">Zonas: ${joinEs(zones)}</span></div>
          ${s.founding_year ? html`<div style="padding: 22px 0 0 0; display: flex; flex-direction: column; gap: 6px"><span style="${M}; font-weight: 800; font-size: 36px; color: #1747B8">${s.founding_year}</span><span style="font-size: 15px; color: #4A5468">Año de fundación</span></div>` : ''}
        </div>
      </div>
    </div>
  </section>

  <!-- SERVICIOS -->
  <section id="servicios" style="background: #FFFFFF">
    <div style="max-width: 1200px; margin: 0 auto; padding: clamp(64px, 9vw, 120px) clamp(16px, 4vw, 40px); display: flex; flex-direction: column; gap: 48px">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 32px 64px; align-items: end">
        <div style="display: flex; flex-direction: column; gap: 20px">
          <div style="${M}; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; color: #1747B8">SERVICIOS</div>
          <h2 style="margin: 0; ${M}; font-weight: 800; font-size: clamp(2rem, 3.6vw, 3rem); line-height: 1.08; letter-spacing: -0.02em; color: #0F1626">Estamos listos para ayudarte.</h2>
          <p style="margin: 0; font-size: 18px; line-height: 1.7; color: #4A5468">Maquinaria, personal y experiencia para llevar un terreno desde su estado natural hasta un desarrollo listo para construir.</p>
        </div>
        <img src="/assets/ac98261b63c004d78005814ceb46ab16.jpg" alt="Tractor de oruga nivelando un terreno" loading="lazy" style="display: block; width: 100%; aspect-ratio: 16 / 7; object-fit: cover">
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 20px">
        ${SERVICES.map(([title, text, bg, icon]) => html`<div style="border: 1px solid #E2DBCF; padding: 28px; display: flex; flex-direction: column; gap: 14px"><span style="width: 52px; height: 52px; background: ${bg}; color: #FFFFFF; display: flex; align-items: center; justify-content: center"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${raw(icon)}</svg></span><span style="${M}; font-weight: 700; font-size: 20px; color: #0F1626">${title}</span><span style="font-size: 16px; line-height: 1.6; color: #4A5468">${text}</span></div>`)}
      </div>
    </div>
  </section>

  <!-- DESARROLLOS -->
  <section id="desarrollos">
    <div style="max-width: 1200px; margin: 0 auto; padding: clamp(64px, 9vw, 120px) clamp(16px, 4vw, 40px); display: flex; flex-direction: column; gap: 48px">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 24px 64px; align-items: end">
        <div style="display: flex; flex-direction: column; gap: 20px">
          <div style="${M}; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; color: #1747B8">NUESTROS DESARROLLOS</div>
          <h2 style="margin: 0; ${M}; font-weight: 800; font-size: clamp(2rem, 3.6vw, 3rem); line-height: 1.08; letter-spacing: -0.02em; color: #0F1626">Tu lugar ideal para construir tu futuro.</h2>
        </div>
        <p style="margin: 0; font-size: 18px; line-height: 1.7; color: #4A5468">${s.developments_intro}</p>
      </div>

      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr)); gap: 28px">
        ${developments.map((d) => devCard(d, s))}
      </div>
      <p style="margin: 0; font-size: 14px; color: #5D6678">Precios, disponibilidad y condiciones sujetos a cambio sin previo aviso. Algunos servicios se entregan de forma progresiva; consulte los detalles de cada desarrollo.</p>
    </div>
  </section>

  <!-- UBICACION -->
  <section id="ubicacion" style="background: #0F1626; color: #FFFFFF">
    <div style="max-width: 1200px; margin: 0 auto; padding: clamp(64px, 9vw, 120px) clamp(16px, 4vw, 40px); display: flex; flex-direction: column; gap: 40px">
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 24px 64px; align-items: end">
        <div style="display: flex; flex-direction: column; gap: 20px">
          <div style="${M}; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; color: #6E9BFF">UBICACIÓN ESTRATÉGICA</div>
          <h2 style="margin: 0; ${M}; font-weight: 800; font-size: clamp(2rem, 3.6vw, 3rem); line-height: 1.08; letter-spacing: -0.02em">De la frontera de Tecate a La Rumorosa.</h2>
        </div>
        <p style="margin: 0; font-size: 18px; line-height: 1.7; color: #B6BFCE">Desarrollos sobre el corredor de la Carretera Federal 2, con conexión a Tijuana, Mexicali y Ensenada, y a minutos de la garita internacional con Tecate, California.</p>
      </div>
      <div style="background: #131D33; border: 1px solid rgba(255,255,255,0.08); overflow: hidden">
        <svg viewBox="0 0 1200 560" width="100%" style="display: block; height: auto" role="img" aria-label="Mapa esquemático: Tecate en la frontera, El Cóndor y La Rumorosa al este sobre la Carretera Federal 2, con los desarrollos numerados">
          <defs><pattern id="gw" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M50 0H0V50" fill="none" stroke="rgba(255,255,255,0.045)"></path></pattern></defs>
          <rect width="1200" height="560" fill="url(#gw)"></rect>
          <path d="M0 0H1200V150L0 90Z" fill="#0C1424"></path>
          <path d="M0 90L1200 150" fill="none" stroke="#F08A3E" stroke-width="2.5" stroke-dasharray="10 8"></path>
          <text x="24" y="50" fill="#8A94A6" font-family="Montserrat, sans-serif" font-size="13" font-weight="700" letter-spacing="5">ESTADOS UNIDOS · CALIFORNIA</text>
          <text x="24" y="132" fill="#8A94A6" font-family="Montserrat, sans-serif" font-size="13" font-weight="700" letter-spacing="5">MÉXICO</text>
          <g fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1.2"><path d="M520 380C600 340 700 360 760 420S880 520 960 500"></path><path d="M500 440C590 400 690 430 750 490S870 580 960 560"></path><path d="M820 220C900 190 1000 210 1060 260S1160 320 1200 300"></path></g>
          <path d="M0 170C120 165 200 150 280 145C460 150 600 230 760 255C880 270 960 260 1040 262C1110 264 1160 250 1200 240" fill="none" stroke="#3F72FF" stroke-width="4"></path>
          <path d="M280 145C262 300 230 430 200 560" fill="none" stroke="#3F72FF" stroke-width="4"></path>
          <text x="20" y="196" fill="#FFFFFF" font-family="Manrope, sans-serif" font-size="15" font-weight="600">← Tijuana</text>
          <text x="1185" y="226" text-anchor="end" fill="#FFFFFF" font-family="Manrope, sans-serif" font-size="15" font-weight="600">Mexicali →</text>
          <text x="214" y="540" fill="#FFFFFF" font-family="Manrope, sans-serif" font-size="15" font-weight="600">↓ Ensenada</text>
          <text x="560" y="222" fill="#6E9BFF" font-family="Montserrat, sans-serif" font-size="12" font-weight="700" letter-spacing="2" transform="rotate(14 560 222)">CARR. FED. 2</text>
          <circle cx="280" cy="105" r="16" fill="none" stroke="rgba(240,138,62,0.7)" stroke-width="1.5"></circle>
          <circle cx="280" cy="105" r="7" fill="#F08A3E"></circle>
          <text x="304" y="84" fill="#FFFFFF" font-family="Montserrat, sans-serif" font-size="15" font-weight="800" letter-spacing="2">GARITA TECATE</text>
          <circle cx="285" cy="185" r="62" fill="rgba(31,95,224,0.16)" stroke="rgba(110,155,255,0.45)"></circle>
          <text x="360" y="200" fill="#FFFFFF" font-family="Montserrat, sans-serif" font-size="18" font-weight="800">TECATE</text>
          <circle cx="760" cy="300" r="40" fill="rgba(31,95,224,0.16)" stroke="rgba(110,155,255,0.45)"></circle>
          <text x="740" y="372" fill="#FFFFFF" font-family="Montserrat, sans-serif" font-size="18" font-weight="800">EL CÓNDOR</text>
          <circle cx="1040" cy="300" r="52" fill="rgba(31,95,224,0.16)" stroke="rgba(110,155,255,0.45)"></circle>
          <text x="970" y="384" fill="#FFFFFF" font-family="Montserrat, sans-serif" font-size="18" font-weight="800">LA RUMOROSA</text>
          ${mapPins(developments)}
          <text x="1180" y="540" text-anchor="end" fill="#7F8AA0" font-family="Manrope, sans-serif" font-size="13">Mapa esquemático · sin escala</text>
        </svg>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px 32px; font-size: 16px; color: #C9D0DC">
        ${developments.map((d) => html`<a href="/desarrollos/${d.slug}" style="color: inherit; text-decoration: none"><strong style="color: #FFFFFF">${pad2(d.number)}</strong> · ${d.name.split(' · ')[0]} — ${d.map_label || d.zone || 'ubicación por confirmar'}</a>`)}
      </div>
    </div>
  </section>

  <!-- FINANCIAMIENTO -->
  <section id="financiamiento">
    <div style="max-width: 1200px; margin: 0 auto; padding: clamp(64px, 9vw, 120px) clamp(16px, 4vw, 40px); display: flex; flex-direction: column; gap: 44px">
      <div style="display: flex; flex-direction: column; gap: 20px; max-width: 760px">
        <div style="${M}; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; color: #1747B8">FINANCIAMIENTO DIRECTO</div>
        <h2 style="margin: 0; ${M}; font-weight: 800; font-size: clamp(2rem, 3.6vw, 3rem); line-height: 1.08; letter-spacing: -0.02em; color: #0F1626">Invierte hoy, disfruta mañana.</h2>
        <p style="margin: 0; font-size: 18px; line-height: 1.7; color: #4A5468">Planes pensados para que asegurar tu patrimonio sea posible, sin trámites bancarios.</p>
      </div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0; border-top: 2px solid #0F1626">
        <div style="padding: 28px 24px 8px 0; display: flex; flex-direction: column; gap: 10px"><span style="${M}; font-weight: 800; font-size: 34px; color: #1747B8">Sin buró</span><span style="font-size: 16px; line-height: 1.6; color: #4A5468">Financiamiento directo, sin bancos ni revisión de buró de crédito.</span></div>
        <div style="padding: 28px 24px 8px 0; display: flex; flex-direction: column; gap: 10px"><span style="${M}; font-weight: 800; font-size: 34px; color: #1747B8">${s.financing_down_payment}</span><span style="font-size: 16px; line-height: 1.6; color: #4A5468">${s.financing_down_payment_text}</span></div>
        <div style="padding: 28px 24px 8px 0; display: flex; flex-direction: column; gap: 10px"><span style="${M}; font-weight: 800; font-size: 34px; color: #1747B8">${s.financing_max_payments}</span><span style="font-size: 16px; line-height: 1.6; color: #4A5468">Mensualidades para pagar tu terreno a tu ritmo.</span></div>
        <div style="padding: 28px 0 8px 0; display: flex; flex-direction: column; gap: 10px"><span style="${M}; font-weight: 800; font-size: 34px; color: #1747B8">MXN y USD</span><span style="font-size: 16px; line-height: 1.6; color: #4A5468">Opciones en pesos y en dólares para compradores de ambos lados de la frontera.</span></div>
      </div>
    </div>
  </section>

  ${leadSection({ developments, selectedId, sent, errors, values, s })}

  ${ctaSection(s)}`;

  return page({ s, home: true, body });
}

export function ctaSection(s) {
  return html`
  <!-- CTA -->
  <section style="background: #1F5FE0; color: #FFFFFF">
    <div style="max-width: 1200px; margin: 0 auto; padding: clamp(56px, 7vw, 88px) clamp(16px, 4vw, 40px); display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 32px">
      <div style="display: flex; flex-direction: column; gap: 14px; max-width: 620px">
        <h2 style="margin: 0; ${M}; font-weight: 800; font-size: clamp(1.8rem, 3.2vw, 2.6rem); line-height: 1.1; letter-spacing: -0.02em">Agenda tu visita a nuestros terrenos.</h2>
        <p style="margin: 0; font-size: 18px; line-height: 1.6; color: #E4ECFF">Te acompañamos en cada paso, para tu futuro y el de tu familia.</p>
      </div>
      <a href="${telHref(s)}" style="background: #FFFFFF; color: #0F1626; text-decoration: none; padding: 20px 30px; display: flex; align-items: center; gap: 14px; ${M}; font-weight: 800; font-size: clamp(1.4rem, 2.6vw, 2rem)"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#1F5FE0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PHONE}</svg>${s.phone_display}</a>
    </div>
  </section>`;
}
