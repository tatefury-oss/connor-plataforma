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
  publicUrl: env.PUBLIC_URL || `http://localhost:${env.PORT || 3000}`,
  trustProxy: env.TRUST_PROXY === '1',
  sessionHours: Number(env.SESSION_HOURS || 12),
  uploadDir: env.UPLOAD_DIR || new URL('../uploads/', import.meta.url).pathname,
  whatsapp: {
    verifyToken: env.WHATSAPP_VERIFY_TOKEN || '',
    appSecret: env.WHATSAPP_APP_SECRET || '',
    accessToken: env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
    graphVersion: env.WHATSAPP_GRAPH_VERSION || 'v21.0',
  },
};

export const whatsappReceiveEnabled = () => Boolean(config.whatsapp.verifyToken && config.whatsapp.appSecret);
export const whatsappSendEnabled = () => Boolean(config.whatsapp.accessToken && config.whatsapp.phoneNumberId);
