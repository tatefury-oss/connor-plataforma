import { pad2 } from '../../services/developments.js';
import { html } from '../html.js';
import { ctaSection } from './home.js';
import { page, waHref } from './layout.js';
import { badges, chips, leadSection, statBox, totalBox } from './partials.js';

const M = 'font-family: Montserrat, sans-serif';

// Acepta enlaces de YouTube y los convierte a la versión sin cookies; otros videos se sirven como archivo.
export function youtubeEmbed(url) {
  const m = /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/.exec(String(url));
  return m ? `https://www.youtube-nocookie.com/embed/${m[1]}` : null;
}

function mediaItem(m) {
  if (m.kind === 'video') {
    const yt = youtubeEmbed(m.url);
    return yt
      ? html`<iframe src="${yt}" title="${m.alt || 'Video del desarrollo'}" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen style="display: block; width: 100%; aspect-ratio: 16 / 9; border: 0"></iframe>`
      : html`<video src="${m.url}" controls preload="metadata" style="display: block; width: 100%; aspect-ratio: 16 / 9; background: #0F1626"></video>`;
  }
  return html`<a href="${m.url}" target="_blank" rel="noopener"><img src="${m.url}" alt="${m.alt}" loading="lazy" style="display: block; width: 100%; aspect-ratio: 4 / 3; object-fit: cover"></a>`;
}

export function developmentPage({ s, d, media, developments, sent, errors, values }) {
  const hasMap = d.latitude != null && d.longitude != null;
  const lat = Number(d.latitude), lon = Number(d.longitude);
  const bbox = [lon - 0.012, lat - 0.008, lon + 0.012, lat + 0.008].map((n) => n.toFixed(6)).join('%2C');
  const body = html`
  <section style="background: #0F1626; color: #FFFFFF">
    <div style="max-width: 1200px; margin: 0 auto; padding: clamp(40px, 6vw, 80px) clamp(16px, 4vw, 40px); display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 440px), 1fr)); gap: clamp(32px, 5vw, 64px); align-items: center">
      <div style="display: flex; flex-direction: column; gap: 22px">
        <a href="/#desarrollos" style="${M}; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; color: #6E9BFF; text-decoration: none">← NUESTROS DESARROLLOS</a>
        <h1 style="margin: 0; ${M}; font-weight: 800; font-size: clamp(2.2rem, 4.6vw, 3.8rem); line-height: 1.05; letter-spacing: -0.025em">${d.name}</h1>
        <p style="margin: 0; font-size: clamp(1.05rem, 1.6vw, 1.2rem); line-height: 1.6; color: #B6BFCE">${d.location}</p>
        <div style="display: flex; flex-wrap: wrap; gap: 14px">
          <a href="#informes" style="background: #1F5FE0; color: #FFFFFF; text-decoration: none; ${M}; font-weight: 700; font-size: 15px; padding: 17px 28px">Solicitar información</a>
          <a href="${waHref(s, `Hola, me interesa información sobre ${d.name}.`)}" target="_blank" rel="noopener" style="border: 1.5px solid rgba(255,255,255,0.4); color: #FFFFFF; text-decoration: none; ${M}; font-weight: 700; font-size: 15px; padding: 16px 26px">WhatsApp</a>
        </div>
      </div>
      <div style="position: relative"><img src="${d.cover_image || ''}" alt="${d.cover_alt}" fetchpriority="high" style="display: block; width: 100%; aspect-ratio: 16 / 10; object-fit: cover">${badges(d)}</div>
    </div>
  </section>

  <section>
    <div style="max-width: 1200px; margin: 0 auto; padding: clamp(48px, 7vw, 96px) clamp(16px, 4vw, 40px); display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: clamp(32px, 6vw, 72px); align-items: start">
      <div style="display: flex; flex-direction: column; gap: 24px">
        <div style="${M}; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; color: #1747B8">${pad2(d.number)} · FICHA DEL DESARROLLO</div>
        ${d.description
          ? d.description.split(/\n{2,}/).map((p) => html`<p style="margin: 0; font-size: 18px; line-height: 1.7">${p}</p>`)
          : html`<p style="margin: 0; font-size: 18px; line-height: 1.7; color: #4A5468">Solicita información para conocer planos, disponibilidad de lotes y planes de financiamiento.</p>`}
        ${chips(d.features || [])}
        ${d.total_lots || d.total_area_m2 ? html`<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); border-top: 1px solid #D9D1C3">
          ${d.total_lots ? html`<div style="padding: 22px 16px 0 0; display: flex; flex-direction: column; gap: 6px"><span style="${M}; font-weight: 800; font-size: 32px; color: #1747B8">${d.total_lots}</span><span style="font-size: 15px; color: #4A5468">Lotes en el desarrollo</span></div>` : ''}
          ${d.total_area_m2 ? html`<div style="padding: 22px 16px 0 0; display: flex; flex-direction: column; gap: 6px"><span style="${M}; font-weight: 800; font-size: 32px; color: #1747B8">${Number(d.total_area_m2).toLocaleString('es-MX')} m²</span><span style="font-size: 15px; color: #4A5468">Superficie total</span></div>` : ''}
        </div>` : ''}
      </div>
      <div style="background: #FFFFFF; border: 1px solid #E2DBCF; padding: 28px; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px">
        ${(d.stats || []).slice(0, 3).map(statBox)}
        ${totalBox(d)}
        <p style="grid-column: 1 / -1; margin: 8px 0 0; font-size: 14px; color: #5D6678">Precios, disponibilidad y condiciones sujetos a cambio sin previo aviso.</p>
      </div>
    </div>
  </section>

  ${media.length ? html`
  <section aria-label="Galería" style="background: #FFFFFF">
    <div style="max-width: 1200px; margin: 0 auto; padding: clamp(48px, 7vw, 96px) clamp(16px, 4vw, 40px); display: flex; flex-direction: column; gap: 32px">
      <div style="${M}; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; color: #1747B8">GALERÍA</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 16px">${media.map(mediaItem)}</div>
    </div>
  </section>` : ''}

  ${hasMap ? html`
  <section aria-label="Mapa" style="background: #0F1626; color: #FFFFFF">
    <div style="max-width: 1200px; margin: 0 auto; padding: clamp(48px, 7vw, 96px) clamp(16px, 4vw, 40px); display: flex; flex-direction: column; gap: 24px">
      <div style="${M}; font-weight: 700; font-size: 13px; letter-spacing: 0.22em; color: #6E9BFF">UBICACIÓN</div>
      <iframe title="Mapa de ${d.name}" loading="lazy" src="https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&amp;layer=mapnik&amp;marker=${lat}%2C${lon}" style="display: block; width: 100%; aspect-ratio: 16 / 7; min-height: 320px; border: 0"></iframe>
      <a href="https://www.google.com/maps/dir/?api=1&amp;destination=${lat},${lon}" target="_blank" rel="noopener" style="align-self: flex-start; background: #1F5FE0; color: #FFFFFF; text-decoration: none; ${M}; font-weight: 700; font-size: 15px; padding: 15px 24px">Cómo llegar</a>
    </div>
  </section>` : ''}

  ${leadSection({ developments, selectedId: d.id, sent, errors, values, s })}
  ${ctaSection(s)}`;

  return page({ s, title: d.name, description: `${d.name} · ${d.location}`, body, ogImage: d.cover_image });
}
