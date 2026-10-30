import { html } from './html.js';

/**
 * Gráfica de barras verticales de una sola serie (SVG en línea, sin dependencias).
 * Cada barra tiene su texto emergente; el valor máximo y el último se rotulan directamente.
 * Siempre se acompaña de la tabla de datos para lectura accesible.
 */
export function barChart({ title, rows, format = (v) => String(v), label = (r) => r.label, height = 180 }) {
  const values = rows.map((r) => Number(r.value) || 0);
  const max = Math.max(1, ...values);
  const w = 640;
  const pad = { top: 22, bottom: 26, left: 8, right: 8 };
  const slot = (w - pad.left - pad.right) / Math.max(rows.length, 1);
  const bw = Math.max(6, Math.min(36, slot * 0.6));
  const ih = height - pad.top - pad.bottom;
  const iMax = values.indexOf(Math.max(...values));
  const iLast = rows.length - 1;
  return html`<figure class="chart">
    <figcaption>${title}</figcaption>
    <svg viewBox="0 0 ${w} ${height}" role="img" aria-label="${title}">
      <line x1="${pad.left}" x2="${w - pad.right}" y1="${height - pad.bottom}" y2="${height - pad.bottom}" class="axis"></line>
      ${rows.map((r, i) => {
        const v = values[i];
        const bh = (v / max) * ih;
        const x = pad.left + slot * i + (slot - bw) / 2;
        const y = height - pad.bottom - bh;
        const showValue = v > 0 && (i === iMax || i === iLast);
        return html`<g class="bar-g"><title>${label(r)}: ${format(v)}</title>
          <rect class="hit" x="${pad.left + slot * i}" y="${pad.top}" width="${slot}" height="${ih}"></rect>
          ${v > 0 ? html`<path class="bar" d="M${x},${y + bh} V${y + Math.min(4, bh)} Q${x},${y} ${x + Math.min(4, bw / 2)},${y} H${x + bw - Math.min(4, bw / 2)} Q${x + bw},${y} ${x + bw},${y + Math.min(4, bh)} V${y + bh} Z"></path>` : ''}
          ${showValue ? html`<text class="val" x="${x + bw / 2}" y="${y - 6}" text-anchor="middle">${format(v)}</text>` : ''}
          <text class="tick" x="${x + bw / 2}" y="${height - 8}" text-anchor="middle">${label(r)}</text></g>`;
      })}
    </svg>
    <details><summary>Ver datos</summary><table><tbody>${rows.map((r, i) => html`<tr><td>${label(r)}</td><td class="num">${format(values[i])}</td></tr>`)}</tbody></table></details>
  </figure>`;
}
