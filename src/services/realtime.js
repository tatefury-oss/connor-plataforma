// Puente entre los servicios y Socket.IO; el servidor registra la instancia al arrancar.
let io = null;

export function setIo(instance) { io = instance; }

export function notifyUser(userId, event, payload) {
  if (io && userId) io.to(`user:${userId}`).emit(event, payload);
}

export function notifyRoles(roles, event, payload) {
  if (io) io.to(roles.map((r) => `role:${r}`)).emit(event, payload);
}
