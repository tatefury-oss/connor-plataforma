# CONNOR · Plataforma inmobiliaria

Sitio público + CRM + ERP ligero para **CONNOR Constructora del Noroeste** (Tecate, B.C.). El dueño del proyecto habla español y no es programador: explicaciones en español sencillo, pasos concretos y sin jerga.

- Requerimientos originales: `docs/origen/especificacion.md`. Diseño aprobado: `docs/origen/diseno-web.html` (la portada lo replica exactamente).
- Estado y funciones por fase: `README.md`. Operación: `docs/OPERACION.md`. Seguridad: `docs/SEGURIDAD.md`. Pruebas: `docs/PRUEBAS.md`. Publicación en Render: `docs/RENDER.md`.

## Stack

Node 22 (ESM) + Express 5 + PostgreSQL 16 (`pg`) + Socket.IO + `@anthropic-ai/sdk`. HTML renderizado en el servidor con plantillas propias (`src/views/html.js`, escape automático), sin framework de frontend. JavaScript del navegador en `public/js/` (la CSP prohíbe scripts en línea).

```
migrations/      SQL numerado (NNN_nombre.sql). Nunca editar uno ya publicado en main: crear uno nuevo.
src/services/    lógica (leads, bot, inventory, finance, analytics, assistant, chat, privacy, realtime…)
src/routes/      público, auth, webhooks y src/routes/admin/* (panel)
src/security/    sesiones/CSRF, contraseñas, rbac (permisos por rol), origin
test/            node:test contra una base *_test que se reconstruye en cada corrida
```

## Preparar una sesión nueva (contenedor en la nube)

```bash
npm ci
pg_ctlcluster 16 main start
su postgres -c "psql -c \"create user connor with password 'connor_dev_pw'\" -c 'create database connor owner connor' -c 'create database connor_test owner connor'"
printf 'DATABASE_URL=postgres://connor:connor_dev_pw@localhost:5432/connor\nPORT=3000\n' > .env
npm test                     # usa .env.test (ya en el repo) → connor_test
npm start                    # http://localhost:3000 · panel en /admin
NEW_USER_PASSWORD='…' npm run create-user -- --email admin@local.test --name "Admin Local" --role admin
```

Si `pg_ctlcluster` dice que el clúster ya existe o la base ya está creada, seguir con el siguiente paso.

## Reglas del código

- Toda consulta de datos de clientes pasa por el alcance de rol (`can()` en `src/security/rbac.js`, `scope()` en los servicios). Un asesor solo ve lo suyo; los registros ajenos responden 404.
- Permisos nuevos: agregarlos en `PERMISSIONS` de `rbac.js` y en la tabla de roles del README.
- Toda escritura del panel lleva CSRF (`csrfField(req)` en formularios o la cabecera `x-csrf-token`) y se registra con `audit()`.
- Pagos, ventas, calendarios y bitácora son inmutables (disparadores en la base). Las correcciones se hacen anulando con motivo.
- Montos en centavos al calcular. Las fechas `date` llegan como texto `AAAA-MM-DD` (no convertir de zona horaria). Zona horaria del negocio: `America/Tijuana`.
- Textos de interfaz y comentarios en español, con la densidad de comentarios del código existente.
- Modelos de Claude: `claude-opus-5-5` con `fallbacks: 'default'` (beta `server-side-fallback-2026-07-01`). Las pruebas usan clientes simulados (`setBotClient`, `setAssistantClient`).

## Flujo de trabajo

1. Rama nueva desde `main` actualizado (`git fetch origin main && git checkout -B <rama> origin/main`).
2. Cambios + pruebas (`npm test` debe quedar en verde) + revisión en navegador con Playwright cuando haya interfaz.
3. Commit, push y solicitud de cambios a `main` con `gh api repos/tatefury-oss/connor-plataforma/pulls` (GraphQL no está disponible). GitHub Actions corre las pruebas.
4. El dueño une la solicitud desde GitHub; Render publica solo desde `main`.

## Estado (30 oct 2026)

Fases 1 a 9 del documento construidas, probadas (87 pruebas) y unidas a `main`. **Aún no está publicado**: el siguiente paso es crear el Blueprint en Render siguiendo `docs/RENDER.md`.

Pendientes:
1. Publicar en Render y crear el primer usuario administrador. `render.yaml` no se pudo validar contra la documentación de Render; corregir si Render marca algún campo.
2. Imágenes del diseño (logotipo y fotos) en `public/assets/`, con los nombres de archivo de `docs/origen/diseno-web.html`. Aún no se tienen.
3. Datos de la empresa que el diseño dejó como marcadores: año de fundación, correo, dirección, precio total de Hacienda Flor de Mayo y de Los Pinos, zona de Hacienda Flor de Mayo y URL de Facebook. Se capturan desde el panel.
4. Credenciales: `ANTHROPIC_API_KEY` y WhatsApp Business (Meta). Los asistentes solo se han probado con simulaciones.
5. Revisión legal del aviso de privacidad.
6. Recomendados: verificación en dos pasos para administración y finanzas, prueba de penetración externa, adaptador Redis de Socket.IO si algún día se usan varias instancias.
