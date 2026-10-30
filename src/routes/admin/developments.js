import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../../config.js';
import { one, tx } from '../../db.js';
import { requirePermission } from '../../security/rbac.js';
import { audit } from '../../services/audit.js';
import { STATUS_LABELS, getById, listAll, mediaFor, pad2, slugify } from '../../services/developments.js';
import { html } from '../../views/html.js';
import { adminPage, csrfField } from '../../views/admin/layout.js';

const router = Router();
router.use('/admin/desarrollos', requirePermission('developments.manage'));

mkdirSync(config.uploadDir, { recursive: true });

const ALLOWED = {
  'image/jpeg': { ext: '.jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: '.png', magic: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { ext: '.webp', magic: (b) => b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  'video/mp4': { ext: '.mp4', magic: (b) => b.toString('ascii', 4, 8) === 'ftyp' },
};

const upload = multer({
  storage: multer.diskStorage({
    destination: config.uploadDir,
    filename: (_req, file, cb) => cb(null, randomBytes(16).toString('hex') + (ALLOWED[file.mimetype]?.ext ?? '')),
  }),
  limits: { fileSize: 60 * 1024 * 1024, files: 12, fields: 60 },
  fileFilter: (_req, file, cb) => cb(null, Boolean(ALLOWED[file.mimetype])),
});

// El tipo declarado por el navegador no basta: se comprueba la firma real del archivo.
async function verifyFile(file) {
  const fh = await open(file.path, 'r');
  try {
    const { buffer } = await fh.read(Buffer.alloc(16), 0, 16, 0);
    if (ALLOWED[file.mimetype]?.magic(buffer)) return true;
  } finally {
    await fh.close();
  }
  await unlink(file.path).catch(() => {});
  return false;
}

const optionalNumber = z.string().trim().max(20).transform((v) => (v === '' ? null : Number(v))).refine((v) => v === null || Number.isFinite(v), 'Número no válido');

const devSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().max(80).default(''),
  number: z.coerce.number().int().min(1).max(99),
  zone: z.string().trim().max(60).default(''),
  location: z.string().trim().max(300).default(''),
  map_label: z.string().trim().max(120).default(''),
  description: z.string().trim().max(8000).default(''),
  badge: z.string().trim().max(30).default(''),
  status: z.enum(Object.keys(STATUS_LABELS)),
  currency: z.enum(['MXN', 'USD']),
  total_price: z.string().trim().max(60).default(''),
  features: z.string().max(3000).default(''),
  cover_alt: z.string().trim().max(200).default(''),
  latitude: optionalNumber.refine((v) => v === null || (v >= -90 && v <= 90), 'Latitud fuera de rango'),
  longitude: optionalNumber.refine((v) => v === null || (v >= -180 && v <= 180), 'Longitud fuera de rango'),
  total_area_m2: optionalNumber,
  total_lots: optionalNumber,
  sort_order: z.coerce.number().int().min(0).max(999).default(0),
  published: z.string().optional(),
  ...Object.fromEntries([0, 1, 2].flatMap((i) => [
    [`stat${i}_label`, z.string().trim().max(40).default('')],
    [`stat${i}_value`, z.string().trim().max(60).default('')],
    [`stat${i}_detail`, z.string().trim().max(80).default('')],
  ])),
});

function toRow(d) {
  return {
    name: d.name, slug: slugify(d.slug || d.name), number: d.number, zone: d.zone || null, location: d.location,
    map_label: d.map_label, description: d.description, badge: d.badge ? d.badge.toUpperCase() : null, status: d.status,
    currency: d.currency, total_price: d.total_price || null, cover_alt: d.cover_alt,
    features: d.features.split('\n').map((f) => f.trim()).filter(Boolean).slice(0, 20),
    stats: [0, 1, 2].map((i) => ({ label: d[`stat${i}_label`].toUpperCase(), value: d[`stat${i}_value`], detail: d[`stat${i}_detail`] })).filter((s) => s.label || s.value),
    latitude: d.latitude, longitude: d.longitude, total_area_m2: d.total_area_m2, total_lots: d.total_lots,
    sort_order: d.sort_order, published: d.published === '1',
  };
}

const COLS = ['name', 'slug', 'number', 'zone', 'location', 'map_label', 'description', 'badge', 'status', 'currency', 'total_price', 'cover_alt', 'features', 'stats', 'latitude', 'longitude', 'total_area_m2', 'total_lots', 'sort_order', 'published'];
const values = (row) => COLS.map((c) => (c === 'stats' ? JSON.stringify(row.stats) : row[c]));

function form(req, d = {}, media = []) {
  const isNew = !d.id;
  const stats = d.stats ?? [{}, {}, {}];
  const v = (k) => d[k] ?? '';
  return html`
  <form class="card form" method="post" enctype="multipart/form-data" action="${isNew ? '/admin/desarrollos' : `/admin/desarrollos/${d.id}`}">
    ${csrfField(req)}
    <h2>Información general</h2>
    <div class="fields">
      <label class="wide">Nombre *<input name="name" value="${v('name')}" required maxlength="120"></label>
      <label>Número en el mapa *<input name="number" type="number" min="1" max="99" value="${v('number')}" required></label>
      <label>Orden<input name="sort_order" type="number" min="0" max="999" value="${v('sort_order') || 0}"></label>
      <label>URL (slug)<input name="slug" value="${v('slug')}" placeholder="se genera del nombre"></label>
      <label>Zona<input name="zone" value="${v('zone')}" placeholder="Tecate, El Cóndor, La Rumorosa…"></label>
      <label class="wide">Ubicación / subtítulo<input name="location" value="${v('location')}" maxlength="300"></label>
      <label>Texto en la lista del mapa<input name="map_label" value="${v('map_label')}" maxlength="120"></label>
      <label>Etiqueta destacada<input name="badge" value="${v('badge')}" placeholder="PREVENTA, SIN INTERESES…" maxlength="30"></label>
      <label>Estatus<select name="status">${Object.entries(STATUS_LABELS).map(([k, l]) => html`<option value="${k}" ${v('status') === k ? 'selected' : ''}>${l}</option>`)}</select></label>
      <label>Moneda<select name="currency">${['MXN', 'USD'].map((c) => html`<option ${v('currency') === c ? 'selected' : ''}>${c}</option>`)}</select></label>
      <label class="check"><input type="checkbox" name="published" value="1" ${isNew || d.published ? 'checked' : ''}> Publicado en el sitio</label>
      <label class="wide">Descripción (párrafos separados por línea en blanco)<textarea name="description" rows="5">${v('description')}</textarea></label>
    </div>
    <h2>Ficha comercial</h2>
    <div class="fields stats">
      ${[0, 1, 2].map((i) => html`
        <label>Recuadro ${i + 1} · título<input name="stat${i}_label" value="${stats[i]?.label ?? ''}" placeholder="LOTE"></label>
        <label>Valor<input name="stat${i}_value" value="${stats[i]?.value ?? ''}" placeholder="140 m²"></label>
        <label>Detalle<input name="stat${i}_detail" value="${stats[i]?.detail ?? ''}" placeholder="10 × 25 m"></label>`)}
      <label>Precio total<input name="total_price" value="${v('total_price')}" placeholder="vacío = Por confirmar"></label>
    </div>
    <label class="block">Características / servicios (una por línea)<textarea name="features" rows="5">${(d.features ?? []).join('\n')}</textarea></label>
    <h2>Proyecto</h2>
    <div class="fields">
      <label>Superficie total (m²)<input name="total_area_m2" inputmode="decimal" value="${v('total_area_m2')}"></label>
      <label>Número de lotes<input name="total_lots" inputmode="numeric" value="${v('total_lots')}"></label>
      <label>Latitud<input name="latitude" inputmode="decimal" value="${v('latitude')}" placeholder="32.5672"></label>
      <label>Longitud<input name="longitude" inputmode="decimal" value="${v('longitude')}" placeholder="-116.6251"></label>
    </div>
    <h2>Imágenes</h2>
    <div class="fields">
      ${d.cover_image ? html`<div class="wide"><img class="thumb" src="${d.cover_image}" alt=""></div>` : ''}
      <label>Foto de portada (JPG, PNG o WebP)<input type="file" name="cover" accept="image/jpeg,image/png,image/webp"></label>
      <label>Texto alternativo de la portada<input name="cover_alt" value="${v('cover_alt')}" maxlength="200"></label>
      <label class="wide">Agregar a la galería (fotos o video MP4)<input type="file" name="gallery" multiple accept="image/jpeg,image/png,image/webp,video/mp4"></label>
    </div>
    <button class="btn" type="submit">${isNew ? 'Crear desarrollo' : 'Guardar cambios'}</button>
  </form>
  ${isNew ? '' : html`
  <section class="card">
    <h2>Galería</h2>
    <form class="inline" method="post" action="/admin/desarrollos/${d.id}/video">${csrfField(req)}<input name="url" type="url" required placeholder="Enlace de YouTube" maxlength="300"><input name="alt" placeholder="Título del video" maxlength="200"><button class="btn small" type="submit">Agregar video</button></form>
    <div class="gallery">
      ${media.map((m) => html`<figure>${m.kind === 'image' ? html`<img src="${m.url}" alt="">` : html`<div class="video">▶ ${m.alt || m.url}</div>`}
        <form method="post" action="/admin/desarrollos/${d.id}/media/${m.id}/eliminar" data-confirm="¿Eliminar este elemento de la galería?">${csrfField(req)}<button class="link danger" type="submit">Eliminar</button></form></figure>`)}
    </div>
    ${media.length ? '' : html`<p class="muted">Sin elementos en la galería.</p>`}
  </section>`}`;
}

router.get('/admin/desarrollos', async (req, res) => {
  const rows = await listAll();
  const body = html`
    <div class="toolbar"><a class="btn" href="/admin/desarrollos/nuevo">+ Nuevo desarrollo</a></div>
    <section class="card flush"><table class="list">
      <thead><tr><th>#</th><th>Desarrollo</th><th>Zona</th><th>Estatus</th><th>Precio total</th><th class="num">Prospectos</th><th>Sitio</th></tr></thead>
      <tbody>${rows.map((d) => html`<tr><td>${pad2(d.number)}</td><td><a href="/admin/desarrollos/${d.id}"><strong>${d.name}</strong></a></td><td>${d.zone ?? '—'}</td><td>${STATUS_LABELS[d.status]}</td><td>${d.total_price ?? 'Por confirmar'}</td><td class="num">${d.lead_count}</td><td>${d.published ? html`<a href="/desarrollos/${d.slug}" target="_blank">Publicado ↗</a>` : 'Oculto'}</td></tr>`)}</tbody>
    </table></section>`;
  res.send(String(adminPage({ req, title: 'Desarrollos', active: '/admin/desarrollos', body })));
});

router.get('/admin/desarrollos/nuevo', (req, res) => {
  res.send(String(adminPage({ req, title: 'Nuevo desarrollo', active: '/admin/desarrollos', body: form(req, { status: 'venta', currency: 'MXN' }) })));
});

router.get('/admin/desarrollos/:id', async (req, res, next) => {
  const d = await getById(Number(req.params.id) || 0);
  if (!d) return next();
  res.send(String(adminPage({ req, title: d.name, active: '/admin/desarrollos', body: form(req, d, await mediaFor(d.id)) })));
});

const fields = upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'gallery', maxCount: 10 }]);

// multer procesa el multipart antes de validar CSRF (el token viaja dentro del formulario).
async function save(req, res) {
  const files = [...(req.files?.cover ?? []), ...(req.files?.gallery ?? [])];
  const cleanup = () => Promise.all(files.map((f) => unlink(f.path).catch(() => {})));
  const parsed = devSchema.safeParse(req.body);
  const id = req.params.id ? Number(req.params.id) : null;
  const backUrl = id ? `/admin/desarrollos/${id}` : '/admin/desarrollos/nuevo';
  if (!parsed.success) {
    await cleanup();
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return res.redirect(303, `${backUrl}?error=${encodeURIComponent(`Revisa el formulario — ${msg}`)}`);
  }
  for (const f of files) {
    if (!(await verifyFile(f))) {
      await cleanup();
      return res.redirect(303, `${backUrl}?error=${encodeURIComponent(`El archivo ${f.originalname} no es una imagen o video válido.`)}`);
    }
  }
  const row = toRow(parsed.data);
  const urlOf = (f) => `/uploads/${path.basename(f.filename)}`;
  try {
    const devId = await tx(async (db) => {
      let devId = id;
      const before = id ? (await db.query('SELECT * FROM developments WHERE id = $1 FOR UPDATE', [id])).rows[0] : null;
      if (id && !before) return null;
      if (id) {
        await db.query(`UPDATE developments SET ${COLS.map((c, i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1`, [id, ...values(row)]);
      } else {
        devId = (await db.query(`INSERT INTO developments (${COLS.join(', ')}) VALUES (${COLS.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, values(row))).rows[0].id;
      }
      if (req.files?.cover?.[0]) await db.query('UPDATE developments SET cover_image = $2 WHERE id = $1', [devId, urlOf(req.files.cover[0])]);
      for (const [i, f] of (req.files?.gallery ?? []).entries()) {
        await db.query(
          `INSERT INTO development_media (development_id, kind, url, alt, sort_order)
           VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(sort_order), 0) + 1 + $5 FROM development_media WHERE development_id = $1))`,
          [devId, f.mimetype.startsWith('video/') ? 'video' : 'image', urlOf(f), row.name, i],
        );
      }
      const changed = before ? Object.fromEntries(COLS.filter((c) => JSON.stringify(before[c] ?? null) !== JSON.stringify(c === 'stats' ? row.stats : row[c] ?? null)).map((c) => [c, { from: before[c], to: row[c] }])) : row;
      await audit({ db, req, action: id ? 'development.update' : 'development.create', entity: 'development', entityId: devId, details: { changed, uploads: files.length } });
      return devId;
    });
    if (!devId) { await cleanup(); return res.sendStatus(404); }
    res.redirect(303, `/admin/desarrollos/${devId}?msg=${id ? 'ok' : 'creado'}`);
  } catch (err) {
    await cleanup();
    if (err.code === '23505') return res.redirect(303, `${backUrl}?error=${encodeURIComponent('Ya existe un desarrollo con esa URL (slug).')}`);
    throw err;
  }
}

// Si el token CSRF no es válido se borran los archivos recién recibidos.
function csrfAfterUpload(requireCsrf) {
  return (req, res, next) => {
    res.once('finish', () => {
      if (res.statusCode === 403) {
        for (const f of Object.values(req.files ?? {}).flat()) unlink(f.path).catch(() => {});
      }
    });
    requireCsrf(req, res, next);
  };
}

export function mountDevelopmentUploads(app, requireCsrf) {
  const guard = [requirePermission('developments.manage'), fields, csrfAfterUpload(requireCsrf)];
  app.post('/admin/desarrollos', ...guard, save);
  app.post('/admin/desarrollos/:id', ...guard, save);
}

router.post('/admin/desarrollos/:id/video', async (req, res, next) => {
  const d = await getById(Number(req.params.id) || 0);
  if (!d) return next();
  const url = String(req.body.url ?? '').trim();
  if (!/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) {
    return res.redirect(303, `/admin/desarrollos/${d.id}?error=${encodeURIComponent('Solo se aceptan enlaces de YouTube.')}`);
  }
  const m = await one(
    `INSERT INTO development_media (development_id, kind, url, alt, sort_order)
     VALUES ($1, 'video', $2, $3, (SELECT COALESCE(max(sort_order), 0) + 1 FROM development_media WHERE development_id = $1)) RETURNING id`,
    [d.id, url, String(req.body.alt ?? '').slice(0, 200)],
  );
  await audit({ req, action: 'development.media_add', entity: 'development', entityId: d.id, details: { media: m.id, url } });
  res.redirect(303, `/admin/desarrollos/${d.id}?msg=ok`);
});

router.post('/admin/desarrollos/:id/media/:mid/eliminar', async (req, res) => {
  const m = await one('DELETE FROM development_media WHERE id = $1 AND development_id = $2 RETURNING *', [Number(req.params.mid) || 0, Number(req.params.id) || 0]);
  if (m?.url.startsWith('/uploads/')) await unlink(path.join(config.uploadDir, path.basename(m.url))).catch(() => {});
  if (m) await audit({ req, action: 'development.media_delete', entity: 'development', entityId: m.development_id, details: { url: m.url } });
  res.redirect(303, `/admin/desarrollos/${req.params.id}?msg=ok`);
});

export default router;
