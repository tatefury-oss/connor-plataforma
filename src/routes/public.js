import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { getPublishedBySlug, listPublished, mediaFor } from '../services/developments.js';
import { captureLead, normalizePhone } from '../services/leads.js';
import { getSettings } from '../services/settings.js';
import { developmentPage } from '../views/public/development.js';
import { homePage } from '../views/public/home.js';
import { notFoundPage, privacyPage } from '../views/public/privacy.js';

const router = Router();

const leadSchema = z.object({
  name: z.string().trim().min(2, 'Escribe tu nombre.').max(120),
  country: z.enum(['52', '1']).default('52'),
  phone: z.string().trim().max(20),
  email: z.union([z.literal(''), z.email('Correo no válido.').max(160)]).default(''),
  development_id: z.string().regex(/^\d*$/).default(''),
  budget: z.string().trim().max(60).default(''),
  intent: z.enum(['info', 'visita']).default('info'),
  visit_date: z.union([z.literal(''), z.iso.date('Fecha no válida.')]).default(''),
  message: z.string().trim().max(2000).default(''),
  consent: z.literal('1', { error: 'Debes aceptar el aviso de privacidad.' }),
});

const contactLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: 'Demasiadas solicitudes. Intenta de nuevo en unos minutos o llámanos.',
});

async function renderHome(req, res, extra = {}) {
  const [s, developments] = await Promise.all([getSettings(), listPublished()]);
  const picked = developments.find((d) => d.slug === req.query.desarrollo);
  res.send(String(homePage({ s, developments, selectedId: picked?.id, sent: req.query.enviado === '1', ...extra })));
}

router.get('/', (req, res) => renderHome(req, res));

router.get('/desarrollos/:slug', async (req, res, next) => {
  const d = await getPublishedBySlug(req.params.slug);
  if (!d) return next();
  const [s, media, developments] = await Promise.all([getSettings(), mediaFor(d.id), listPublished()]);
  res.send(String(developmentPage({ s, d, media, developments, sent: req.query.enviado === '1' })));
});

router.get('/aviso-de-privacidad', async (_req, res) => {
  res.send(String(privacyPage({ s: await getSettings() })));
});

router.post('/contacto', contactLimiter, async (req, res) => {
  const wantsJson = req.accepts(['html', 'json']) === 'json';
  // Trampa anti-bots: se responde como éxito sin registrar nada.
  if (req.body?.website) return wantsJson ? res.json({ ok: true }) : res.redirect(303, '/?enviado=1#informes');
  const parsed = leadSchema.safeParse(req.body ?? {});
  const errors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors[issue.path[0] ?? '_form'] ??= issue.message;
    }
  }
  const data = parsed.data ?? {};
  if (parsed.success && !normalizePhone(data.phone, data.country)) errors.phone = 'Escribe un teléfono de 10 dígitos.';

  let developmentId = null;
  if (parsed.success && data.development_id) {
    const devs = await listPublished();
    developmentId = devs.find((d) => String(d.id) === data.development_id)?.id ?? null;
  }

  if (Object.keys(errors).length) {
    if (wantsJson) return res.status(422).json({ ok: false, errors });
    return renderHome(req, res.status(422), { errors, values: req.body });
  }

  await captureLead({
    name: data.name,
    phone: data.phone,
    country: data.country,
    email: data.email,
    source: 'web',
    developmentId,
    budget: data.budget,
    wantsVisit: data.intent === 'visita',
    visitDate: data.intent === 'visita' ? data.visit_date : '',
    message: data.message,
    consent: true,
  }, { req });

  if (wantsJson) return res.json({ ok: true });
  const back = String(req.get('referer') || '/');
  const path = /^https?:\/\/[^/]+(\/desarrollos\/[a-z0-9-]+)/.exec(back)?.[1] ?? '/';
  res.redirect(303, `${path}?enviado=1#informes`);
});

export async function notFound(_req, res) {
  res.status(404).send(String(notFoundPage({ s: await getSettings() })));
}

export default router;
