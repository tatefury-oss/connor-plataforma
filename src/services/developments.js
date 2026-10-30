import { many, one } from '../db.js';

export const STATUS_LABELS = { preventa: 'Preventa', venta: 'En venta', agotado: 'Agotado' };

export function listPublished() {
  return many(`SELECT * FROM developments WHERE published ORDER BY sort_order, number`);
}

export function listAll() {
  return many(`SELECT d.*, (SELECT count(*)::int FROM leads l WHERE l.development_id = d.id) AS lead_count
                 FROM developments d ORDER BY sort_order, number`);
}

export function getPublishedBySlug(slug) {
  return one(`SELECT * FROM developments WHERE slug = $1 AND published`, [slug]);
}

export function getById(id) {
  return one(`SELECT * FROM developments WHERE id = $1`, [id]);
}

export function mediaFor(developmentId) {
  return many(`SELECT * FROM development_media WHERE development_id = $1 ORDER BY sort_order, id`, [developmentId]);
}

export function pad2(n) { return String(n).padStart(2, '0'); }

export function slugify(text) {
  return String(text).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'desarrollo';
}
