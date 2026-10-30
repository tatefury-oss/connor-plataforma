import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { config } from './config.js';
import { query } from './db.js';
import { cookieMiddleware } from './security/cookies.js';
import { requireAuth } from './security/rbac.js';
import { loadUser, requireCsrf } from './security/session.js';
import { unreadNotifications, unreadTotal } from './services/chat.js';
import auditRoutes from './routes/admin/audit.js';
import dashboardRoutes from './routes/admin/dashboard.js';
import developmentRoutes, { mountDevelopmentUploads } from './routes/admin/developments.js';
import assistantRoutes from './routes/admin/assistant.js';
import chatRoutes from './routes/admin/chat.js';
import accountRoutes from './routes/admin/account.js';
import financeRoutes from './routes/admin/finance.js';
import leadRoutes from './routes/admin/leads.js';
import projectRoutes, { mountProjectUploads } from './routes/admin/projects.js';
import settingsRoutes from './routes/admin/settings.js';
import userRoutes from './routes/admin/users.js';
import authRoutes from './routes/auth.js';
import publicRoutes, { notFound } from './routes/public.js';
import webhookRoutes from './routes/webhooks.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        mediaSrc: ["'self'"],
        frameSrc: ['https://www.openstreetmap.org', 'https://www.youtube-nocookie.com'],
        connectSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        upgradeInsecureRequests: config.isProd ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: config.isProd,
  }));

  // El webhook necesita el cuerpo crudo para validar la firma: va antes de los parsers.
  app.use(webhookRoutes);

  app.get('/healthz', (_req, res) => res.json({ ok: true }));
  // Listo para recibir tráfico solo si la base de datos responde.
  app.get('/readyz', async (_req, res) => {
    try { await query('SELECT 1'); res.json({ ok: true, db: true }); } catch { res.status(503).json({ ok: false, db: false }); }
  });

  // Registro de solicitudes sin datos personales (sin cadena de consulta ni cuerpo).
  app.use((req, res, next) => {
    if (/^\/(css|js|assets|uploads|socket\.io)\//.test(req.path)) return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      const entry = { t: new Date().toISOString(), method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms), user: req.user?.id ?? null };
      if (config.isProd) console.log(JSON.stringify(entry));
      else if (config.env !== 'test' && process.env.LOG_REQUESTS === '1') console.log(`${entry.method} ${entry.path} ${entry.status} ${entry.ms}ms`);
    });
    next();
  });
  app.use(express.static(new URL('../public/', import.meta.url).pathname, { index: false, maxAge: config.isProd ? '7d' : 0 }));
  app.use('/uploads', express.static(config.uploadDir, { index: false, maxAge: '30d', dotfiles: 'deny' }));

  app.use(cookieMiddleware);
  app.use(express.urlencoded({ extended: false, limit: '200kb', parameterLimit: 200 }));

  app.use(publicRoutes);

  // ---------- Entorno privado ----------
  app.use('/admin', loadUser, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(authRoutes);
  app.use('/admin', requireAuth);
  // Límite general para operaciones de escritura del panel por IP.
  app.use('/admin', rateLimit({ windowMs: 10 * 60 * 1000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false,
    skip: (req) => ['GET', 'HEAD', 'OPTIONS'].includes(req.method), message: 'Demasiadas operaciones. Espera unos minutos.' }));
  // Contadores del menú (chat sin leer y notificaciones) para las páginas HTML del panel.
  app.use('/admin', async (req, _res, next) => {
    if (req.method === 'GET' && req.accepts(['html', 'json']) === 'html') {
      const [chat, notifications] = await Promise.all([unreadTotal(req.user), unreadNotifications(req.user)]);
      req.badges = { chat, notifications };
    }
    next();
  });
  mountDevelopmentUploads(app, requireCsrf); // multipart: el token CSRF se lee tras procesar el formulario
  mountProjectUploads(app, requireCsrf);
  app.use('/admin', requireCsrf);
  app.use(dashboardRoutes);
  app.use(leadRoutes);
  app.use(projectRoutes);
  app.use(financeRoutes);
  app.use(assistantRoutes);
  app.use(chatRoutes);
  app.use(accountRoutes);
  app.use(developmentRoutes);
  app.use(settingsRoutes);
  app.use(userRoutes);
  app.use(auditRoutes);

  app.use(notFound);

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).send('El archivo es demasiado grande (máx. 60 MB).');
    if (err.type === 'entity.too.large') return res.status(413).send('La solicitud es demasiado grande.');
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
    res.status(500).send('Ocurrió un error inesperado. El equipo técnico fue notificado.');
  });

  return app;
}
