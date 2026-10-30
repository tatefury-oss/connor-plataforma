import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createApp } from './app.js';
import { config, productionProblems, whatsappReceiveEnabled, whatsappSendEnabled } from './config.js';
import { pool } from './db.js';
import { migrate, pendingMigrations } from './migrate.js';
import { parseCookies } from './security/cookies.js';
import { originAllowed } from './security/origin.js';
import { SESSION_COOKIE, sessionFromToken } from './security/session.js';
import { botConfigured, handleInbound } from './services/bot.js';
import { releaseExpiredReservations } from './services/inventory.js';
import { applyRetention } from './services/privacy.js';
import { flushNotifications, setIo } from './services/realtime.js';
import { setInboundHandler } from './services/whatsapp.js';
import { seed } from './seed.js';

const problems = productionProblems();
if (problems.length) {
  console.error(`Configuración insegura para producción:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}

if (config.autoMigrate) {
  await migrate();
  await seed({ log: () => {} });
} else {
  // En producción no se modifica la base al arrancar: primero respaldo y luego `npm run migrate`.
  const pending = await pendingMigrations();
  if (pending.length) {
    console.error(`Hay migraciones pendientes (${pending.join(', ')}). Respalda la base y ejecuta: npm run migrate`);
    process.exit(1);
  }
}

const app = createApp();
const server = createServer(app);

// Sincronización en tiempo real: cada socket se autentica con la cookie de sesión del panel.
// Solo se aceptan conexiones desde el propio sitio (evita secuestro de WebSocket entre sitios).
const io = new Server(server, {
  serveClient: true,
  cors: { origin: false },
  allowRequest: (req, callback) => callback(null, originAllowed(req.headers.origin, req.headers.host)),
});
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
  releaseExpiredReservations().catch((err) => console.error('[inventario] error al liberar apartados', err));
  applyRetention().catch((err) => console.error('[retención]', err));
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
