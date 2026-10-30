import { config } from '../config.js';

/**
 * ¿Se acepta una conexión de Socket.IO con este origen? Solo desde el propio sitio.
 * En desarrollo también se acepta el mismo host (localhost con cualquier puerto configurado).
 */
export function originAllowed(origin, host, { publicUrl = config.publicUrl, isProd = config.isProd } = {}) {
  if (!origin) return false;
  let parsed;
  try { parsed = new URL(origin); } catch { return false; }
  if (parsed.origin === new URL(publicUrl).origin) return true;
  return !isProd && Boolean(host) && parsed.host === host;
}
