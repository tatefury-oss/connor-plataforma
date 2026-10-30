# Pruebas y resultados

Registro del ciclo de validación de la fase 9 (sección 13 del documento del proyecto): construir, probar, corregir, volver a probar y documentar.

## Pruebas automatizadas

`npm test` usa una base de datos separada (`*_test`) que se reconstruye en cada ejecución. GitHub Actions las corre en cada solicitud de cambios (`.github/workflows/ci.yml`), junto con `npm audit`.

| Archivo | Pruebas | Qué cubre |
|---|---:|---|
| `platform.test.js` | 20 | Sitio público, formulario, XSS, cabeceras, Round Robin, duplicados y concurrencia, permisos por rol, CSRF, bloqueo de cuenta, auditoría inmutable, webhook de WhatsApp, filtros por fecha en hora de Tijuana |
| `bot.test.js` | 8 | Asistente de WhatsApp: catálogo autorizado, herramientas, transferencia, rechazos y errores, retiro cuando responde un humano, mensajes simultáneos |
| `inventory.test.js` | 12 | Importación de lotes, apartados simultáneos, permisos por rol, ventas, cancelación, vencimientos, ficha pública sin datos de clientes, documentos privados |
| `finance.test.js` | 14 | Cálculos al centavo (con y sin interés), aplicación de pagos, atrasos y morosos, pagos inmutables, anulaciones, promesas, liquidación, cancelación, permisos, CSV |
| `assistant.test.js` | 11 | Herramientas del asistente interno por rol, alcance de datos, recordatorios, historial sin alterar, privacidad de conversaciones, analítica |
| `chat.test.js` | 9 | Mensajes directos y grupos, no leídos, privacidad, referencias según permisos, notificaciones persistentes, redirecciones seguras |
| `security.test.js` | 13 | Todas las rutas del panel sin sesión, rotación de sesión, cambio de contraseña, inyección SQL, recorrido de directorios, origen de WebSocket, derechos ARCO, retención, integridad del calendario |
| **Total** | **87** | **87 aprobadas, 0 fallidas** (≈14 s) |

## Errores encontrados y corregidos durante el ciclo

| Fase | Error | Corrección |
|---|---|---|
| 6 | Las fechas sin hora (vencimientos, apartados) se mostraban un día antes por la zona horaria | Las fechas se manejan como día de calendario |
| 7 | Los filtros por fecha del tablero recorrían el día 7 horas (los prospectos de la noche no contaban en su día) | Límites calculados en hora de Tijuana, con prueba de regresión |
| 7 | En celular, varias pantallas del panel se desbordaban a lo ancho | Las tablas se desplazan dentro de su tarjeta (revisadas 8 pantallas a 390 px) |
| 8 | La conversación abierta seguía marcando mensajes sin leer | Se marca como leída antes de calcular los contadores |
| 9 | Una sesión anterior del mismo navegador seguía siendo válida tras un nuevo inicio de sesión | Rotación de sesión al iniciar |
| 9 | Las vistas de cartera tardaban hasta 0.6 s con 1,500 ventas | Acumulado guardado en el calendario y vista en una sola pasada |

## Rendimiento

Base de carga: 30,000 prospectos, 90,000 actividades, 3,000 lotes, 1,500 ventas, 109,500 parcialidades y 10,080 pagos (PostgreSQL 16 local; mediana de 3 ejecuciones).

| Consulta | Antes | Después |
|---|---:|---:|
| Listado de prospectos (página 1) | 28 ms | 6 ms |
| Búsqueda de prospectos | 38 ms | 39–57 ms |
| Resumen comercial (90 días) | 12 ms | 6–11 ms |
| Tendencias (12 meses) | 43 ms | 31–42 ms |
| Tablero de cartera | 592 ms | 339 ms |
| Listado de ventas | 535 ms | 170 ms |
| Antigüedad de cartera | 489 ms | 106–128 ms |
| Ficha de venta / calendario | 3 ms | 2–4 ms |

Con un volumen mucho mayor (más de 10,000 ventas vigentes), el siguiente paso sería guardar un resumen diario de cartera.

## Pruebas de punta a punta

- **Modo producción con el usuario restringido de la base** (`connor_app`) detrás de HTTPS: formulario público, inicio de sesión, cookie `__Host-` segura, conexión en tiempo real, registro y anulación de un pago, y chat. Sin errores de JavaScript.
- **Permisos de la base:** con `connor_app`, `DELETE` sobre la bitácora y los pagos, `TRUNCATE` y `DROP` son rechazados.
- **WebSocket desde otro origen:** rechazado (403).
- **Chat entre dos navegadores** con usuarios distintos: avisos, contadores y mensajes en ambos sentidos sin recargar.
- **Prueba de humo** (`npm run smoke`): 11 de 11 verificaciones correctas en modo producción.
- **Respaldo y restauración:** la base restaurada tiene los mismos conteos y conserva la protección de la bitácora.

## No probado (requiere el entorno real)

- La imagen de Docker y `docker-compose.yml`: este entorno no tiene Docker. Deben construirse y probarse en el servidor final siguiendo `docs/OPERACION.md`.
- WhatsApp Business y Claude con cuentas reales: solo con simulaciones.
- Carga concurrente sostenida (muchos usuarios a la vez) y una prueba de penetración externa.
