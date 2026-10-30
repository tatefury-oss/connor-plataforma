// Toda la configuración sensible llega por variables de entorno; nada se envía al frontend.
const env = process.env;

function required(name) {
  const value = env[name];
  if (!value) throw new Error(`Falta la variable de entorno ${name}`);
  return value;
}

export const config = {
  env: env.NODE_ENV || 'development',
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT || 3000),
  databaseUrl: required('DATABASE_URL'),
  // Render define RENDER_EXTERNAL_URL (https://<servicio>.onrender.com) automáticamente.
  publicUrl: env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || `http://localhost:${env.PORT || 3000}`,
  trustProxy: env.TRUST_PROXY === '1',
  sessionHours: Number(env.SESSION_HOURS || 12),
  databaseSsl: env.DATABASE_SSL === '1',
  // La base está en la red privada del proveedor (p. ej. URL interna de Render): no viaja por internet.
  databasePrivateNetwork: env.DATABASE_PRIVATE_NETWORK === '1',
  dbPoolSize: Number(env.DB_POOL_SIZE || 10),
  // En producción las migraciones se aplican a mano (npm run migrate) después de un respaldo.
  autoMigrate: env.AUTO_MIGRATE ? env.AUTO_MIGRATE === '1' : env.NODE_ENV !== 'production',
  retention: {
    readNotificationsDays: Number(env.RETENTION_NOTIFICATIONS_DAYS || 90),
    assistantDays: Number(env.RETENTION_ASSISTANT_DAYS || 180),
    botRunsDays: Number(env.RETENTION_BOT_RUNS_DAYS || 365),
  },
  uploadDir: env.UPLOAD_DIR || new URL('../uploads/', import.meta.url).pathname,
  anthropicApiKey: env.ANTHROPIC_API_KEY || '',
  whatsapp: {
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: env.WHATSAPP_APP_SECRET || '',
    accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    graphVersion: env.WHATSAPP_GRAPH_VERSION || 'v21.0',
  },
};

/** Problemas de configuración que impiden operar con seguridad en producción. */
export function productionProblems() {
  if (!config.isProd) return [];
  const p = [];
  if (!/^https:\/\//.test(config.publicUrl)) p.push('PUBLIC_URL debe usar https:// en producción.');
  const local = /localhost|127\.0\.0\.1/.test(config.databaseUrl);
  if (!local && !config.databaseSsl && !config.databasePrivateNetwork) {
    p.push('Base de datos remota sin DATABASE_SSL=1 (o DATABASE_PRIVATE_NETWORK=1 si va por red privada del proveedor).');
  }
  return p;
}

export const whatsappReceiveEnabled = () => Boolean(config.whatsapp.verifyToken && config.whatsapp.appSecret);
export const whatsappSendEnabled = () => Boolean(config.whatsapp.accessToken && config.whatsapp.phoneNumberId);
