import express, { Router } from 'express';
import { config, whatsappReceiveEnabled } from '../config.js';
import { safeEqual } from '../security/session.js';
import { handleWebhook, verifySignature } from '../services/whatsapp.js';

const router = Router();

// Verificación de suscripción que hace Meta al configurar el webhook.
router.get('/webhooks/whatsapp', (req, res) => {
  if (!whatsappReceiveEnabled()) return res.sendStatus(503);
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && safeEqual(token, config.whatsapp.verifyToken)) {
    return res.type('text/plain').send(String(challenge));
  }
  res.sendStatus(403);
});

router.post('/webhooks/whatsapp', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  if (!whatsappReceiveEnabled()) return res.sendStatus(503);
  if (!verifySignature(req.body, req.get('x-hub-signature-256'))) return res.sendStatus(401);
  let payload;
  try { payload = JSON.parse(req.body.toString('utf8')); } catch { return res.sendStatus(400); }
  await handleWebhook(payload);
  res.sendStatus(200);
});

export default router;
