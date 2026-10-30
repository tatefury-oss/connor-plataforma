import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { config, whatsappReceiveEnabled, whatsappSendEnabled } from './config.js';
import { pool, query } from './db.js';
import { migrate } from './migrate.js';
import { parseCookies } from './security/cookies.js';
import { SESSION_COOKIE, sessionFromToken } from './security/session.js';
import { botConfigured, handleInbound } from './services/bot.js';
import { releaseExpiredReservations } from './services/inventory.js';
import { flushNotifications, setIo } from './services/realtime.js';
import { setInboundHandler } from './services/whatsapp.js';
import { seed } from './seed.js';

await migrate();
await seed({ log: () => {} });

const app = createApp();
const server = createServer(app);

// Sincronización en tiempo real: cada socket se autentica con la cookie de sesión del panel.
const io = new Server(server, { serveClient: true, cors: { origin: false } });
io.use(async (socket, next) => {
  try {
    const raw = parseCookies(socket.request.headers.cookie)[SESSION_COOKIE];
    const user = await sessionFromToken(raw);
    if (!user) return next(new Error('no autenticado'));
    socket.data.user = user;
    next();
  } catch (err) {
    next(err);
  }
});
io.on('connection', (socket) => {
  const { id, role } = socket.data.user;
  socket.join([`user:${id}`, `role:${role}`]);
});
setIo(io);
setInboundHandler(handleInbound);

const cleanup = setInterval(() => {
  query('DELETE FROM sessions WHERE expires_at < now()').catch(() => {});
  releaseExpiredReservations().catch((err) => console.error('[inventario] error al liberar apartados', err));
}, 60 * 60 * 1000);

server.listen(config.port, () => {
  console.log(`CONNOR escuchando en ${config.publicUrl}`);
  if (!whatsappReceiveEnabled()) console.log('· WhatsApp (recepción) sin configurar: faltan WHATSAPP_VERIFY_TOKEN / WHATSAPP_APP_SECRET');
  if (!botConfigured()) console.log('· Asistente virtual inactivo: requiere ANTHROPIC_API_KEY y el envío de WhatsApp configurado');
  if (!whatsappSendEnabled()) console.log('· WhatsApp (envío) sin configurar: faltan WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID');
});

function shutdown() {
  clearInterval(cleanup);
  io.close();
  server.close(() => flushNotifications().then(() => pool.end()).then(() => process.exit(0)));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
