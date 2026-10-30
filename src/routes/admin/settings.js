import { Router } from 'express';
import { requirePermission } from '../../security/rbac.js';
import { getSettings, updateSettings } from '../../services/settings.js';
import { html } from '../../views/html.js';
import { adminPage, csrfField } from '../../views/admin/layout.js';

const router = Router();
router.use('/admin/configuracion', requirePermission('settings.manage'));

const GROUPS = [
  ['Contacto', [
    ['company_name', 'Nombre de la empresa'],
    ['phone_display', 'Teléfono (como se muestra)'],
    ['phone_e164', 'Teléfono para marcar (+52…)'],
    ['whatsapp_number', 'WhatsApp (solo dígitos con lada de país)'],
    ['whatsapp_message', 'Mensaje inicial de WhatsApp'],
    ['email', 'Correo de contacto'],
    ['office_address', 'Dirección de oficina'],
  ]],
  ['Redes sociales', [
    ['instagram_handle', 'Instagram (usuario sin @)'],
    ['tiktok_handle', 'TikTok (usuario sin @)'],
    ['facebook_name', 'Facebook (nombre visible)'],
    ['facebook_url', 'Facebook (URL de la página)'],
  ]],
  ['Portada', [
    ['hero_eyebrow', 'Texto superior'],
    ['hero_title', 'Título'],
    ['hero_title_accent', 'Título (parte en azul)'],
    ['hero_text', 'Descripción', 'textarea'],
    ['hero_image', 'Imagen (ruta)'],
    ['hero_caption', 'Leyenda de la imagen'],
  ]],
  ['Empresa', [
    ['about_title', 'Título de “Quiénes somos”'],
    ['about_text_1', 'Párrafo 1', 'textarea'],
    ['about_text_2', 'Párrafo 2', 'textarea'],
    ['mission', 'Misión (vacío = no se muestra)', 'textarea'],
    ['vision', 'Visión (vacío = no se muestra)', 'textarea'],
    ['philosophy', 'Filosofía (vacío = no se muestra)', 'textarea'],
    ['founding_year', 'Año de fundación (vacío = no se muestra)'],
  ]],
  ['Desarrollos y financiamiento', [
    ['developments_intro', 'Introducción de desarrollos', 'textarea'],
    ['financing_down_payment', 'Enganche destacado'],
    ['financing_down_payment_text', 'Texto del enganche'],
    ['financing_max_payments', 'Mensualidades destacadas'],
  ]],
  ['Legal', [
    ['privacy_notice', 'Aviso de privacidad (vacío = texto base; debe revisarlo un abogado)', 'textarea'],
  ]],
];

router.get('/admin/configuracion', async (req, res) => {
  const s = await getSettings();
  const body = html`<form class="form" method="post" action="/admin/configuracion">
    ${csrfField(req)}
    ${GROUPS.map(([title, items]) => html`<section class="card"><h2>${title}</h2><div class="fields">
      ${items.map(([k, label, type]) => html`<label class="${type === 'textarea' ? 'wide' : ''}">${label}${type === 'textarea'
        ? html`<textarea name="${k}" rows="${k === 'privacy_notice' ? 12 : 3}">${s[k]}</textarea>`
        : html`<input name="${k}" value="${s[k]}">`}</label>`)}
    </div></section>`)}
    <div class="sticky-save"><button class="btn" type="submit">Guardar y publicar</button> <a class="btn ghost" href="/" target="_blank">Ver sitio ↗</a></div>
  </form>`;
  res.send(String(adminPage({ req, title: 'Sitio público', active: '/admin/configuracion', body })));
});

router.post('/admin/configuracion', async (req, res) => {
  const values = { ...req.body };
  delete values._csrf;
  if (values.whatsapp_number) values.whatsapp_number = String(values.whatsapp_number).replace(/\D/g, '');
  if (values.phone_e164) values.phone_e164 = '+' + String(values.phone_e164).replace(/\D/g, '');
  if (values.facebook_url && !/^https:\/\//.test(values.facebook_url)) {
    return res.redirect(303, `/admin/configuracion?error=${encodeURIComponent('La URL de Facebook debe iniciar con https://')}`);
  }
  await updateSettings(values, req);
  res.redirect(303, '/admin/configuracion?msg=ok');
});

export default router;
