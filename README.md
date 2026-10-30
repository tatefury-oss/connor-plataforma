# CONNOR · Plataforma inmobiliaria

Sitio público + CRM Lite para **CONNOR Constructora del Noroeste**. Ambos entornos comparten una sola base de datos PostgreSQL: lo que se edita en el panel se publica al instante y cada solicitud del sitio o de WhatsApp entra al CRM y se asigna a un asesor.

## Estado por fases

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Arquitectura, base de datos, autenticación y roles | ✅ Listo |
| 2 | Sitio público con el diseño aprobado + administrador de contenidos | ✅ Listo |
| 3 | CRM Lite: prospectos, embudo, seguimiento, etiquetas, filtros, exportación | ✅ Listo |
| 4 | WhatsApp Business API + Round Robin | 🟡 Round Robin, webhook y envío listos; **falta configurar Meta** y el bot con IA |
| 5 | Inventario de lotes por desarrollo | ⏳ Pendiente (ya existe la ficha del proyecto, coordenadas, superficie y número de lotes) |
| 6 | Finanzas y cartera (ventas, planes de pago, abonos, morosidad, estados de cuenta) | ⏳ Pendiente (el rol Finanzas ya existe) |
| 7 | Asistente de IA, reportes y analítica avanzada | ⏳ Pendiente (el tablero ya tiene los indicadores comerciales) |
| 8 | Chat interno | ⏳ Pendiente (la sincronización en tiempo real con Socket.IO ya funciona) |
| 9 | Endurecimiento final y puesta en producción | ⏳ Pendiente |

## Qué hace hoy

**Sitio público** (`/`): el diseño original sección por sección. Todos los textos, teléfonos, redes y desarrollos salen de la base de datos.
- Ficha individual por desarrollo (`/desarrollos/:slug`) con galería de fotos y videos, mapa de OpenStreetMap (si tiene coordenadas) y botón "Cómo llegar".
- Formulario "Solicita información / Agenda tu visita" con validación, aviso de privacidad, trampa anti-bots y límite de envíos por IP. Funciona con o sin JavaScript.
- Botón flotante de WhatsApp y botón de WhatsApp por desarrollo con mensaje prellenado.
- El mapa esquemático coloca los pines a partir de la zona de cada desarrollo.

**Panel privado** (`/admin`):
- **Tablero** por rol. Gerencia y administración ven prospectos, tiempo de respuesta, citas, ventas, conversión, desempeño por asesor y prospectos por desarrollo, con filtros de fecha, desarrollo y asesor. Cada asesor ve sus pendientes del día.
- **Prospectos**: búsqueda, filtros (etapa, fuente, desarrollo, asesor, etiqueta, seguimientos vencidos), ficha con historial, próximo contacto, notas, llamadas, citas, etiquetas, reasignación con motivo, escalamiento y exportación a CSV (protegida contra inyección de fórmulas).
- **Embudo**: Nuevo → Contactado → Interesado → Cita → Negociación → Venta → Cliente (y Perdido).
- **Round Robin**: reparte entre asesores *activos y disponibles*, salta a los no disponibles y, si no hay ninguno, deja el prospecto sin asignar y avisa a administración. Un teléfono equivale a un solo prospecto: si alguien vuelve a escribir, se reconoce y conserva a su asesor. Cada asignación queda registrada con fecha, motivo y responsable.
- **Desarrollos**: alta y edición de la ficha, recuadros de precios, características, estatus, publicación, coordenadas, portada y galería (JPG, PNG, WebP, MP4 o YouTube).
- **Sitio público**: teléfonos, WhatsApp, correo, dirección, redes, textos de portada, misión, visión, filosofía y aviso de privacidad.
- **Usuarios**: alta, roles, activación, disponibilidad y restablecimiento de contraseña.
- **Auditoría**: bitácora de accesos y cambios. La base de datos rechaza cualquier edición o borrado de esta bitácora.
- **Tiempo real**: avisos al instante de nuevos prospectos, asignaciones, escalamientos y mensajes de WhatsApp, sin recargar la página.

## Roles (mínimo privilegio)

| Permiso | Admin | Gerencia | Asesor | Finanzas |
|---|---|---|---|---|
| Tablero | ✔ | ✔ | Solo lo suyo | Aviso de fase 6 |
| Ver prospectos | Todos | Todos | **Solo los asignados** | ✘ |
| Reasignar / exportar | ✔ | ✔ | ✘ (puede escalar) | ✘ |
| Desarrollos, sitio, usuarios, auditoría | ✔ | ✘ | ✘ | ✘ |

El alcance se aplica en las consultas SQL, no solo en la interfaz. Si un asesor intenta abrir un prospecto ajeno, recibe un 404.

## Seguridad implementada

- Contraseñas con **scrypt** (mínimo 12 caracteres). Bloqueo de 15 minutos tras 5 intentos fallidos, más límite de intentos por IP.
- Sesiones del lado del servidor. En la base solo se guarda el hash del token. Cookie `HttpOnly`, `SameSite=Strict` y `Secure` en producción.
- **CSRF** en todas las acciones del panel y en el formulario de acceso.
- **XSS**: todas las plantillas escapan por defecto. Además hay una CSP estricta (sin scripts en línea).
- **SQL injection**: solo consultas parametrizadas.
- Las cargas de archivos se validan por su firma real (no por la extensión), se renombran al azar y tienen límite de tamaño.
- El webhook de Meta se valida con la firma HMAC `X-Hub-Signature-256`.
- Secretos y tokens solo en variables de entorno del servidor. Nunca llegan al navegador.
- Cabeceras de seguridad con Helmet. El panel usa `noindex` y `Cache-Control: no-store`.

## Instalación

Requisitos: Node.js 22.9 o superior y PostgreSQL 14 o superior.

```bash
npm install
cp .env.example .env        # edita DATABASE_URL y el resto
npm run migrate && npm run seed
npm run create-user -- --email tu@correo.com --name "Tu Nombre" --role admin   # pide la contraseña
npm start                   # http://localhost:3000  ·  panel: /admin
```

**Imágenes del diseño:** copia la carpeta `assets/` que exportó la herramienta de diseño (logotipo y fotografías) dentro de `public/assets/`. Los nombres de archivo ya coinciden con los del diseño.

Pruebas automatizadas (usan una base separada que termina en `_test`, configurada en `.env.test`):

```bash
npm test
```

## Pendiente de configurar o autorizar (no se simuló)

1. **WhatsApp Business Platform (Meta).** Crear la app en developers.facebook.com, dar de alta el número y apuntar el webhook a `https://TU-DOMINIO/webhooks/whatsapp` con el campo `messages`. Después completar `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN` (token de usuario del sistema) y `WHATSAPP_PHONE_NUMBER_ID`. Mientras falten, el webhook responde 503 y el panel ofrece "Abrir WhatsApp" en lugar de enviar.
2. **Dominio y HTTPS.** Usar `NODE_ENV=production`, `PUBLIC_URL` y `TRUST_PROXY=1` si hay un proxy delante.
3. **Datos de la empresa** que el diseño dejó como marcadores: año de fundación, correo, dirección de oficina, zona y precio total de Hacienda Flor de Mayo, precio total de Los Pinos y URL de Facebook. Mientras estén vacíos no se muestran (o aparecen como "Por confirmar"). Se capturan en *Sitio público* y *Desarrollos*.
4. **Aviso de privacidad.** Hay un texto base. Debe revisarlo un abogado (LFPDPPP) y pegarse en *Sitio público → Legal*.
5. **Respaldos.** Programar `pg_dump` diario de la base y copia de la carpeta `uploads/` (o migrar a almacenamiento S3/R2).

## Estructura

```
migrations/      esquema SQL versionado
src/app.js       Express, seguridad y montaje de rutas
src/server.js    HTTP + Socket.IO (sesión autenticada)
src/security/    contraseñas, sesiones/CSRF, roles
src/services/    leads (Round Robin), WhatsApp, auditoría, ajustes
src/routes/      público, autenticación, webhooks y panel
src/views/       plantillas HTML con escape automático
public/          CSS, JS del navegador y assets del diseño
test/            pruebas de integración (node:test)
```

Dependencias: express, pg, helmet, express-rate-limit, socket.io, multer, zod.
