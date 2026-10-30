# Seguridad y protección de datos

Cómo cubre la plataforma cada punto de la sección 12 del documento del proyecto, qué se verificó y qué riesgos quedan.

## Controles

| Requisito | Implementación | Verificación |
|---|---|---|
| Autenticación robusta | Contraseñas con scrypt (mínimo 12 caracteres). Bloqueo de 15 minutos tras 5 intentos fallidos, más límite de intentos por IP. Cambio de contraseña propia con la actual. | `platform.test.js`, `security.test.js` |
| Gestión segura de sesiones | Token aleatorio de 256 bits en cookie `__Host-` (`Secure`, `HttpOnly`, `SameSite=Strict`); en la base solo el hash SHA-256. Se renueva al iniciar sesión (la anterior se invalida). Cerrar otras sesiones, y cierre automático al desactivar a un usuario o cambiar su rol o contraseña. | `security.test.js` y prueba en navegador en modo producción |
| Control de acceso por roles | Permisos explícitos por rol (mínimo privilegio). El alcance se aplica en las consultas SQL, no solo en la interfaz: un asesor recibe 404 en registros ajenos. | Prueba automática que recorre **todas** las rutas del panel sin sesión, más pruebas por módulo |
| Inyección SQL | Solo consultas parametrizadas; los nombres de columna vienen de listas fijas. | Pruebas con cargas de inyección en todos los filtros |
| XSS | Plantillas con escape automático, Markdown del asistente saneado y CSP estricta (`script-src 'self'`, sin scripts en línea, `frame-ancestors 'none'`). | Pruebas con nombres y mensajes maliciosos |
| CSRF | Token por sesión en todas las operaciones del panel, doble envío en el formulario de acceso y `SameSite=Strict`. | `platform.test.js` |
| WebSocket | Autenticación con la cookie de sesión y verificación de origen: solo se aceptan conexiones del propio dominio. | `security.test.js` y prueba real (otro origen → 403) |
| Archivos | Se valida la firma real del archivo (no solo la extensión), nombres aleatorios y límite de tamaño. Los documentos privados quedan fuera de la carpeta pública y su descarga se audita. | `inventory.test.js`, prueba de recorrido de directorios |
| Auditoría | Bitácora de solo inserción (un disparador de la base impide editarla o borrarla) y usuario de aplicación sin permiso de `DELETE` sobre ella. | `platform.test.js` y prueba con el usuario restringido |
| Trazabilidad financiera | Los pagos no se editan ni se borran (disparador + permisos); la anulación exige motivo y responsable. Ventas y calendarios no se borran. | `finance.test.js` |
| Secretos y tokens de Meta | Solo en variables de entorno del servidor; nunca llegan al navegador. El webhook de Meta valida la firma HMAC. | `platform.test.js` (firmas inválidas rechazadas) |
| Separación de datos públicos y privados | El sitio público solo consulta desarrollos publicados y lotes disponibles; nunca nombres de clientes. Los asistentes de IA solo ven lo que el rol permite. | `inventory.test.js`, `bot.test.js`, `assistant.test.js` |
| Limitación de intentos | Acceso, formulario público, cambio de contraseña, chat, asistente IA y escrituras del panel. | Pruebas de bloqueo de cuenta |
| Cifrado | HTTPS obligatorio en producción (el servidor no arranca sin él), HSTS, TLS hacia bases remotas (`DATABASE_SSL=1`). El cifrado en reposo depende del disco del servidor o de la base administrada (ver riesgos). | Arranque en modo producción |
| Copias de seguridad y recuperación | `scripts/backup.sh` (verifica que el respaldo se pueda leer) y `scripts/restore.sh`. | Respaldo y restauración en una base nueva con conteos idénticos |
| Privacidad y retención | Aviso de privacidad y consentimiento en el formulario. Derechos ARCO: descarga de datos (acceso) y eliminación (cancelación), o bloqueo comercial si hay ventas que deben conservarse. Retención automática de datos operativos. | `security.test.js` |

## Riesgos residuales y recomendaciones

1. **Cifrado en reposo:** usar un disco cifrado en el servidor o una base administrada con cifrado activado. Los respaldos deben copiarse a un almacenamiento cifrado.
2. **Bloqueo de cuentas:** como cualquier bloqueo por intentos, alguien que conozca un correo puede bloquear esa cuenta 15 minutos. Se mitiga con el límite por IP; si se vuelve un problema, agregar un segundo factor de autenticación.
3. **Segundo factor (2FA):** no está implementado. Se recomienda para administración y finanzas en una siguiente iteración.
4. **Revisión externa:** las pruebas son automatizadas e internas. Antes de manejar volumen real conviene una prueba de penetración independiente.
5. **Aviso de privacidad:** el texto base debe revisarlo un abogado (LFPDPPP).
6. **Servicios externos:** WhatsApp Business y Claude se probaron con simulaciones; falta probarlos con las cuentas reales.
7. **Una sola instancia:** el chat en tiempo real y los límites de envío del bot funcionan en memoria por proceso. Para correr varias instancias detrás de un balanceador habría que agregar el adaptador Redis de Socket.IO.

Ninguna prueba exitosa garantiza seguridad absoluta. Los cambios críticos deben pasar por revisión humana (solicitudes de cambio en GitHub) y por respaldo antes de migrar.
