# CONNOR · Plataforma inmobiliaria

Sitio público + CRM Lite para **CONNOR Constructora del Noroeste**. Ambos entornos comparten una sola base de datos PostgreSQL: lo que se edita en el panel se publica al instante y cada solicitud del sitio o de WhatsApp entra al CRM y se asigna a un asesor.

## Estado por fases

| Fase | Alcance | Estado |
|---|---|---|
| 1 | Arquitectura, base de datos, autenticación y roles | ✅ Listo |
| 2 | Sitio público con el diseño aprobado + administrador de contenidos | ✅ Listo |
| 3 | CRM Lite: prospectos, embudo, seguimiento, etiquetas, filtros, exportación | ✅ Listo |
| 4 | WhatsApp Business API, asistente con IA y Round Robin | ✅ Listo en código · **requiere credenciales de Meta y de Anthropic** para operar |
| 5 | Administración de proyectos e inventario de lotes | ✅ Listo |
| 6 | Finanzas y cartera: ventas, planes de pago, abonos, morosidad, estados de cuenta | ✅ Listo |
| 7 | Asistente de IA interno, reportes y analítica | ✅ Listo en código · **requiere `ANTHROPIC_API_KEY`** para el asistente |
| 8 | Chat interno, grupos de trabajo y notificaciones | ✅ Listo |
| 9 | Pruebas integrales, seguridad, optimización y preparación para producción | ✅ Listo · falta desplegar en el servidor final |

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

## Asistente virtual de WhatsApp (fase 4)

Cuando un cliente escribe al WhatsApp de la empresa:

1. El mensaje entra al CRM. Si es un número nuevo, se crea el prospecto y se asigna por Round Robin; si ya existía, se reconoce y conserva a su asesor.
2. El asistente (Claude, modelo `claude-opus-5-5`) responde solo con la **información autorizada**: los desarrollos publicados en el panel y los datos de financiamiento de *Sitio público*. Si un dato no está en el catálogo, dice que un asesor lo confirma.
3. Mientras conversa, registra en la ficha el nombre, el presupuesto, el desarrollo de interés y las solicitudes de visita, y avisa al asesor en tiempo real.
4. **Transfiere a un asesor** y deja de responder cuando el cliente pide hablar con una persona, quiere apartar o comprar, pregunta por pagos o contratos, tiene una queja o pregunta algo fuera del catálogo. También se retira si falla el servicio, si el modelo no puede responder o si la conversación pasa de 15 respuestas en una hora.
5. En cuanto un asesor responde desde el panel, el asistente se retira de esa conversación. Desde la ficha se puede pausar o reactivar por cliente, y desde *Sitio público → Asistente de WhatsApp* se apaga para todos o se le dan indicaciones (promociones vigentes, horarios de visita).

Límites de seguridad: el asistente no puede leer datos de otros clientes, no ve información financiera y no puede borrar, autorizar pagos ni cambiar saldos. Sus únicas herramientas son "registrar datos" y "transferir a asesor". Cada ejecución queda registrada (`bot_runs`) con el resultado y los tokens consumidos.

Para activarlo se necesitan `ANTHROPIC_API_KEY` y el envío de WhatsApp configurado (ver más abajo). Sin ellos el sitio y el CRM funcionan igual y el panel indica que el asistente no está configurado.

## Proyectos e inventario (fase 5)

- **Tablero de proyectos** (`/admin/proyectos`): lotes totales, disponibles, apartados y vendidos por desarrollo, avance de venta, valor del inventario disponible, responsable y actividades pendientes o vencidas.
- **Inventario por proyecto:** los lotes se cargan pegando desde Excel (`clave; manzana; lote; m²; frente; fondo; precio`). Volver a importar actualiza medidas y precios sin tocar el estatus ni el cliente.
- **Estatus del lote:** Disponible, Apartado, Vendido o Bloqueado. Cada cambio queda en el historial del lote, en la ficha del cliente y en la auditoría.
  - Un asesor aparta solo para sus propios prospectos (también desde la ficha del prospecto) y solo él o gerencia pueden liberar ese apartado.
  - Vender es de gerencia y administración; la venta mueve al prospecto a la etapa "Venta".
  - Cancelar una venta es solo del administrador y exige motivo.
  - Dos personas no pueden apartar el mismo lote a la vez: la base de datos bloquea el registro durante el cambio y además impide un lote apartado o vendido sin cliente.
  - Los apartados con fecha de vencimiento se liberan solos cada hora y se avisa a quien apartó.
- **Sitio público:** la ficha de cada desarrollo con inventario muestra la tabla de lotes disponibles (sin datos de clientes). El asistente de WhatsApp conoce cuántos lotes hay disponibles.
- **Avances y actividades** con responsable y fecha compromiso, y **documentación privada** (planos, permisos, escrituras en PDF/JPG/PNG). Los documentos se guardan fuera de la carpeta pública, solo los descargan administración y gerencia, y cada descarga queda auditada.

## Finanzas y cartera (fase 6)

- **Registro de venta** a partir de un lote apartado o vendido: precio pactado, enganche, número de mensualidades, fecha de la primera y tasa de interés anual (0 % por defecto). El calendario se calcula y se muestra para revisión antes de guardarlo; una vez guardado no se modifica. Con interés se usa pago fijo (amortización francesa). Los importes se calculan en centavos y la última parcialidad absorbe el redondeo, así el total siempre cuadra.
- Al registrar la venta el lote pasa a "Vendido" y el cliente a la etapa "Venta". Un lote solo puede tener una venta vigente.
- **Pagos (abonos):** monto, fecha (no futura), forma de pago, concepto y referencia bancaria. Se aplican a las parcialidades más antiguas primero (enganche incluido); el excedente abona a la siguiente. Cuando el saldo llega a cero la venta queda "Liquidada".
- **Trazabilidad:** la base de datos impide borrar o editar un pago confirmado. Una corrección se hace anulando el pago (solo el administrador, con motivo obligatorio) y registrando el correcto. El pago anulado sigue visible tachado, con quién lo anuló y por qué, y queda en la auditoría. Las ventas y los calendarios tampoco se pueden borrar.
- **Saldos siempre consistentes:** el saldo, lo vencido y los días de atraso no se guardan; se calculan en cada consulta a partir del calendario y los pagos confirmados.
- **Tablero de cartera** separado por moneda (MXN y USD): cuentas por cobrar, cartera vencida, clientes morosos (2 o más parcialidades vencidas o más de 30 días de atraso), cobrado en el mes, cobranza esperada a 30/60/90 días e ingresos de los últimos 12 meses.
- **Alertas:** próximos vencimientos (7 días), pagos vencidos, morosos y promesas de pago incumplidas. Una promesa se marca cumplida si entre su registro y la fecha prometida se pagó al menos el monto acordado.
- **Estado de cuenta** imprimible (o guardar como PDF desde el navegador) y en CSV. **Reportes** de ingresos por periodo y de antigüedad de cartera (1-30, 31-60, 61-90 y más de 90 días), en CSV para Excel. Cada descarga queda en la auditoría.
- **Cancelar venta:** solo el administrador, con motivo. El lote vuelve a estar disponible y los pagos se conservan en el historial; la devolución al cliente se gestiona por separado.

## Asistente interno y analítica (fase 7)

**Asistente IA** (`/admin/asistente`, todos los roles). Chat con Claude (`claude-opus-5-5`) para consultar información y preparar reportes en lenguaje natural:
- *"¿Qué prospectos no tienen seguimiento y a quién llamo primero?"*, *"Resume la conversación con el prospecto #18"*, *"Prepara el reporte comercial de la semana"*, *"¿Cómo está la cartera vencida?"*, *"¿Qué tendencias ves en los últimos 6 meses?"*.
- Trabaja **solo con lo que el usuario puede ver**: cada herramienta usa las mismas consultas con alcance por rol que el panel. Un asesor solo consulta sus prospectos y su cartera; finanzas no recibe herramientas del CRM; un asesor no ve el desempeño de otros. Aunque el modelo pidiera una herramienta no autorizada, el servidor la rechaza.
- Herramientas: buscar prospectos, ver la ficha (incluye conversaciones de WhatsApp para resumirlas), prospectos sin seguimiento, resumen comercial por periodo, tendencias mensuales, estado de proyectos e inventario, cartera (resumen, vencida, morosos) y movimientos financieros.
- **Única acción de escritura:** crear un recordatorio (programa el próximo contacto y deja una nota) cuando el usuario lo pide. No puede registrar ni anular pagos, cambiar saldos, precios o lotes, reasignar ni borrar; si se lo piden, indica en qué sección del panel hacerlo.
- Las conversaciones son privadas de cada usuario. Cada consulta que usa datos queda en la auditoría (herramientas usadas) y en `assistant_runs` con los tokens consumidos. Límite de 40 consultas por hora por usuario.

**Analítica** (`/admin/analitica`, gerencia y administración): prospectos, citas, ventas, conversión y tiempo de respuesta del periodo; gráficas de los últimos 12 meses (prospectos, conversiones, ventas registradas y cobranza por moneda); embudo; conversión por fuente de captación, por asesor y por desarrollo. Cada gráfica incluye su tabla de datos. El botón "Pedir análisis al asistente" abre el chat con la solicitud del periodo ya escrita.

## Chat del equipo y notificaciones (fase 8)

- **Mensajes directos** entre cualquier usuario activo (una sola conversación por pareja) y **grupos de trabajo** con nombre. Quien crea el grupo lo administra: agrega o quita integrantes y cambia el nombre; cualquiera puede salir, y si sale quien administra, el integrante más antiguo toma su lugar. Los cambios quedan como avisos dentro del grupo.
- **Tiempo real en todos los dispositivos:** los mensajes aparecen sin recargar; quien no tiene la conversación abierta recibe un aviso emergente y un contador en el menú. Leer en un dispositivo limpia el contador en los demás, y al reconectarse se recupera lo que llegó mientras tanto.
- **Compartir referencias con permisos:** desde la ficha de un prospecto, lote, proyecto o venta, el botón "Compartir en chat" adjunta la referencia. Solo se puede compartir lo que uno puede ver, y cada lector la ve según **sus** permisos: un asesor que no atiende a ese cliente ve "Prospecto restringido", sin nombre ni enlace.
- Solo los integrantes leen un canal; ni el administrador ve conversaciones ajenas. El autor puede eliminar su mensaje (queda la marca "Mensaje eliminado"). Límite de 30 mensajes por minuto por persona.
- **Notificaciones persistentes** (campana en la parte superior): prospecto asignado, prospecto sin asignar, escalamiento, transferencia del asistente de WhatsApp, solicitud de visita y apartado vencido. Se guardan para consultarlas después desde cualquier dispositivo; abrir una la marca como leída y lleva a la ficha correspondiente.

## Roles (mínimo privilegio)

| Permiso | Admin | Gerencia | Asesor | Finanzas |
|---|---|---|---|---|
| Tablero | ✔ | ✔ | Solo lo suyo | Tablero de cartera |
| Ver prospectos | Todos | Todos | **Solo los asignados** | ✘ |
| Reasignar / exportar | ✔ | ✔ | ✘ (puede escalar) | ✘ |
| Ver inventario | ✔ | ✔ | ✔ (sin datos de clientes ajenos) | ✘ |
| Apartar lote | ✔ | ✔ | Solo para sus prospectos | ✘ |
| Vender / liberar cualquier apartado | ✔ | ✔ | ✘ | ✘ |
| Cargar lotes, bloquear, cancelar ventas | ✔ | ✘ | ✘ | ✘ |
| Actividades y documentos de proyecto | ✔ | ✔ | ✘ | ✘ |
| Ver ventas y cartera | ✔ | ✔ | Solo de sus clientes | ✔ |
| Registrar ventas, pagos y promesas | ✔ | ✘ | ✘ | ✔ |
| Anular pagos, cancelar ventas | ✔ | ✘ | ✘ | ✘ |
| Chat del equipo y notificaciones | ✔ | ✔ | ✔ | ✔ |
| Asistente IA (con su alcance) | ✔ | ✔ | ✔ | ✔ |
| Analítica | ✔ | ✔ | ✘ | ✘ |
| Desarrollos, sitio, usuarios, auditoría | ✔ | ✘ | ✘ | ✘ |

El alcance se aplica en las consultas SQL, no solo en la interfaz. Si un asesor intenta abrir un prospecto ajeno, recibe un 404.

## Producción

- **Publicar en Render (recomendado para empezar):** [`docs/RENDER.md`](docs/RENDER.md). El archivo `render.yaml` crea el servidor, la base de datos y el disco, y publica solo cada cambio que se une a `main`.

- **Guía de operación:** [`docs/OPERACION.md`](docs/OPERACION.md) cubre instalación con Docker y Nginx, actualizaciones (respaldo → migración → verificación), respaldos diarios, simulacro de restauración, monitoreo e incidentes.
- **Seguridad:** [`docs/SEGURIDAD.md`](docs/SEGURIDAD.md) relaciona cada control de la sección 12 con su verificación y lista los riesgos residuales.
- **Pruebas y resultados:** [`docs/PRUEBAS.md`](docs/PRUEBAS.md) incluye 87 pruebas automatizadas, mediciones de rendimiento y pruebas de punta a punta.
- `npm run smoke` verifica un servidor en marcha después de cada despliegue; `npm run backup` genera un respaldo.

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
- La sesión se renueva al iniciar sesión. Cada usuario puede cambiar su contraseña (se cierran sus otros dispositivos) y cerrar sesión en los demás dispositivos desde *Mi cuenta*.
- Socket.IO solo acepta conexiones del propio dominio.
- En producción la aplicación usa un usuario de base de datos que no puede borrar la bitácora, los pagos ni las ventas (`deploy/db-roles.sql`), y no arranca sin HTTPS ni con migraciones pendientes.
- Derechos ARCO (acceso y cancelación de datos personales) y retención automática de datos operativos.

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

1. **Inteligencia artificial.** Crear una clave en console.anthropic.com y ponerla en `ANTHROPIC_API_KEY`. La usan el asistente de WhatsApp y el asistente interno. Cada respuesta consume tokens de la cuenta de Anthropic; el consumo queda registrado en `bot_runs` y `assistant_runs`.
2. **WhatsApp Business Platform (Meta).** Crear la app en developers.facebook.com, dar de alta el número y apuntar el webhook a `https://TU-DOMINIO/webhooks/whatsapp` con el campo `messages`. Después completar `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN` (token de usuario del sistema) y `WHATSAPP_PHONE_NUMBER_ID`. Mientras falten, el webhook responde 503 y el panel ofrece "Abrir WhatsApp" en lugar de enviar.
3. **Dominio y HTTPS.** Usar `NODE_ENV=production`, `PUBLIC_URL` y `TRUST_PROXY=1` si hay un proxy delante.
4. **Datos de la empresa** que el diseño dejó como marcadores: año de fundación, correo, dirección de oficina, zona y precio total de Hacienda Flor de Mayo, precio total de Los Pinos y URL de Facebook. Mientras estén vacíos no se muestran (o aparecen como "Por confirmar"). Se capturan en *Sitio público* y *Desarrollos*.
5. **Aviso de privacidad.** Hay un texto base. Debe revisarlo un abogado (LFPDPPP) y pegarse en *Sitio público → Legal*.
6. **Respaldos.** Programar `pg_dump` diario de la base y copia de las carpetas `uploads/` y `private-docs/` (o migrar a almacenamiento S3/R2 con acceso privado para los documentos).

## Estructura

```
migrations/      esquema SQL versionado
src/app.js       Express, seguridad y montaje de rutas
src/server.js    HTTP + Socket.IO (sesión autenticada)
src/security/    contraseñas, sesiones/CSRF, roles
src/services/    leads (Round Robin), WhatsApp, asistentes IA, analítica, inventario, finanzas, chat, notificaciones, auditoría, ajustes
src/routes/      público, autenticación, webhooks y panel
src/views/       plantillas HTML con escape automático
public/          CSS, JS del navegador y assets del diseño
test/            pruebas de integración (node:test)
```

Dependencias: express, pg, helmet, express-rate-limit, socket.io, multer, zod, @anthropic-ai/sdk.
