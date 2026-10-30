# Operación en producción

Guía para instalar, actualizar, respaldar y vigilar la plataforma CONNOR. Está pensada para un servidor propio (VPS) con Docker y Nginx; al final hay notas para servicios administrados.

## 1. Requisitos

- Servidor Linux con Docker y Docker Compose (2 vCPU y 4 GB de RAM son suficientes para empezar).
- Dominio apuntando al servidor y certificado HTTPS (Let's Encrypt con `certbot`).
- Credenciales externas, si se usarán: clave de Anthropic y datos de WhatsApp Business (ver el README).

## 2. Primera instalación

```bash
git clone https://github.com/tatefury-oss/connor-plataforma.git /opt/connor && cd /opt/connor
cp .env.example .env        # completar: PUBLIC_URL=https://…, POSTGRES_PASSWORD, APP_DB_PASSWORD, claves externas
docker compose up -d db
docker compose run --rm migrate
docker compose exec -T db psql -U connor connor -v app_password="'$APP_DB_PASSWORD'" -f /deploy/db-roles.sql
docker compose run --rm -e DATABASE_URL="postgres://connor:$POSTGRES_PASSWORD@db:5432/connor" migrate node src/seed.js
docker compose run --rm -e DATABASE_URL="postgres://connor:$POSTGRES_PASSWORD@db:5432/connor" migrate node scripts/create-user.js --email tu@correo.com --name "Tu Nombre" --role admin
docker compose up -d app
```

Después:

1. Copiar `deploy/nginx.conf` a Nginx, ajustar el dominio, obtener el certificado con `certbot --nginx` y recargar.
2. Copiar las imágenes del diseño (`assets/`) a `public/assets/` y reconstruir con `docker compose build app && docker compose up -d app`.
3. Verificar: `SMOKE_URL=https://tu-dominio npm run smoke` (desde cualquier equipo con Node 22).

**Por qué dos usuarios de base de datos:** las migraciones usan al dueño (`connor`); la aplicación se conecta como `connor_app`, que no puede borrar la bitácora, los pagos ni las ventas, ni cambiar la estructura de la base. Si alguien tomara el control del servidor de aplicación, no podría borrar ese historial.

El servidor **no arranca** en producción si `PUBLIC_URL` no es `https://`, si una base remota no usa `DATABASE_SSL=1` o si hay migraciones pendientes.

## 3. Actualizar a una nueva versión

Ninguna migración se aplica sola en producción. El orden es siempre:

```bash
cd /opt/connor && git pull
./scripts/backup.sh                       # 1. respaldo
docker compose build app
docker compose run --rm migrate           # 2. migraciones (si hay)
docker compose exec -T db psql -U connor connor -v app_password="'$APP_DB_PASSWORD'" -f /deploy/db-roles.sql   # 3. permisos de tablas nuevas
docker compose up -d app                  # 4. reinicio
SMOKE_URL=https://tu-dominio npm run smoke   # 5. verificación
```

Si algo falla después de migrar: detener la app, restaurar el respaldo del paso 1 (sección 4) y volver a la versión anterior con `git checkout <commit>`.

## 4. Respaldos y restauración

- `scripts/backup.sh` genera la base (`pg_dump`, formato custom), los archivos subidos y los documentos privados, comprueba que el respaldo se pueda leer y borra los de más de `KEEP_DAYS` días (30 por defecto). Los archivos quedan con permisos solo para el dueño, porque contienen datos personales.
- Programarlo diario y **copiar los respaldos fuera del servidor** (otro proveedor o almacenamiento con cifrado):

  ```cron
  15 3 * * *  cd /opt/connor && DATABASE_URL=postgres://connor:…@localhost:5432/connor BACKUP_DIR=/respaldos DATA_DIR=/var/lib/docker/volumes/connor_appdata/_data ./scripts/backup.sh >> /var/log/connor-backup.log 2>&1
  ```

- **Simulacro de restauración** (recomendado cada mes): restaurar en una base nueva y comparar conteos.

  ```bash
  createdb connor_prueba
  DATABASE_URL=postgres://connor:…@localhost/connor_prueba ./scripts/restore.sh /respaldos/connor-db-XXXX.dump /respaldos/connor-files-XXXX.tar.gz /tmp/archivos
  ```

## 5. Monitoreo

| Qué | Cómo |
|---|---|
| Disponibilidad | Vigilar `https://tu-dominio/readyz` (responde 200 solo si la base de datos contesta) con un servicio externo (UptimeRobot, Better Stack, etc.). |
| Registros | En producción cada solicitud se registra en JSON (método, ruta, estado, milisegundos, id de usuario), sin cadenas de búsqueda ni datos personales: `docker compose logs -f app`. |
| Errores | Las líneas con `ERROR` o los estados 500 indican fallos; el detalle técnico solo aparece en el registro, nunca en pantalla. |
| Respaldos | Revisar `/var/log/connor-backup.log`: cada día debe aparecer "respaldo correcto". |
| Uso de IA | Tablas `bot_runs` y `assistant_runs` (tokens por conversación). |
| Seguridad | Sección *Auditoría* del panel: intentos fallidos de acceso (`auth.failed`, `auth.locked_attempt`), exportaciones, anulaciones y solicitudes ARCO. |

## 6. Tareas automáticas

Cada hora el servidor:

- Libera los apartados de lotes vencidos.
- Borra las sesiones expiradas.
- Aplica la retención de datos: notificaciones leídas (90 días), conversaciones del asistente interno (180 días) y bitácora del bot (365 días). Los plazos se configuran en `.env`.
- La bitácora de auditoría, las ventas y los pagos **no** se borran nunca.

## 7. Incidentes

1. **Acceso indebido sospechado:** desactivar al usuario en *Usuarios* (cierra sus sesiones al instante), revisar *Auditoría* filtrando por su id y cambiar las contraseñas afectadas.
2. **Clave filtrada** (Anthropic, Meta o base de datos): revocarla en el proveedor, poner la nueva en `.env` y ejecutar `docker compose up -d app`.
3. **Servidor caído:** `docker compose ps` y `docker compose logs app`. Si la base no responde, `/readyz` devuelve 503.
4. **Pérdida de datos:** restaurar el último respaldo en una base nueva, verificar y después apuntar la aplicación a ella.

## 8. Servicios administrados (sin Docker)

La aplicación también corre en plataformas como Render o Railway:

- Comando de arranque: `node src/server.js`.
- Variables: `NODE_ENV=production`, `TRUST_PROXY=1`, `DATABASE_SSL=1` y el resto de `.env.example`.
- Base PostgreSQL 14 o superior. Ejecutar `npm run migrate` como paso previo al despliegue (con el usuario dueño) y `deploy/db-roles.sql` para el usuario de la aplicación.
- Disco persistente montado en `UPLOAD_DIR`. Los documentos privados se guardan junto a esa carpeta, en `private-docs`.
