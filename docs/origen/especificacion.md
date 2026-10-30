# PROYECTO: PLATAFORMA INMOBILIARIA INTEGRAL
## Sitio público + CRM + ERP Lite + Inteligencia Artificial + WhatsApp Business API

### 1. ROL Y OBJETIVO

Actúa como un equipo multidisciplinario de desarrollo de software integrado por:
- Arquitecto de software senior.
- Desarrollador Full Stack.
- Especialista en UX/UI.
- Especialista en ciberseguridad.
- Ingeniero de inteligencia artificial.
- Especialista en CRM, ERP y automatización de procesos.
- Especialista en integraciones con Meta y WhatsApp Business API.

Partiremos del diseño corporativo, identidad visual, logotipo y línea gráfica desarrollados en la primera etapa.

El objetivo es convertir ese diseño en una plataforma inmobiliaria integral, funcional, escalable, segura y multiusuario.

No se trata de desarrollar únicamente una página web. Se debe construir un ecosistema digital donde convivan dos entornos conectados:

**A. ENTORNO PÚBLICO:** página comercial, catálogo de terrenos, fraccionamientos, proyectos, información corporativa y captación de prospectos.

**B. ENTORNO PRIVADO:** CRM Lite, administración, asesores comerciales, proyectos, cartera de clientes, finanzas, inteligencia artificial, reportes y control operativo.

Ambos entornos deben compartir una misma base de datos y trabajar sincronizadamente.

---

### 2. IDENTIDAD Y DISEÑO

Conservar la identidad visual del diseño original:
- Logotipo y colores corporativos.
- Tipografías.
- Estilo arquitectónico y visual.
- Fotografías y recursos gráficos de alta calidad.
- Diseño adaptable a computadoras, tablets y celulares.

La plataforma debe transmitir confianza, solidez, profesionalismo y modernidad.

Crear una experiencia visual premium, intuitiva y fácil de utilizar.

---

### 3. ENTORNO PÚBLICO – SITIO WEB COMERCIAL

Desarrollar una página pública dinámica que permita:

- Presentación de la empresa.
- Historia, misión, visión y filosofía.
- Catálogo de terrenos disponibles.
- Catálogo de fraccionamientos y desarrollos.
- Fichas individuales de cada proyecto.
- Galerías de fotografías y videos.
- Ubicación geográfica mediante mapas.
- Superficies, precios, disponibilidad y características.
- Formularios de contacto.
- Botones de contacto mediante WhatsApp.
- Solicitud de información y citas.
- Registro automático de cada prospecto en el CRM.

Los administradores podrán modificar desde el panel privado toda la información pública sin necesidad de modificar código.

Esto incluye precios, fotografías, videos, descripciones, teléfonos, ubicaciones, promociones, disponibilidad y proyectos.

---

### 4. WHATSAPP BUSINESS API Y BOT COMERCIAL

Integrar WhatsApp Business Platform mediante la API oficial de Meta.

Desarrollar un asistente virtual con inteligencia artificial que pueda:

- Atender consultas iniciales.
- Identificar qué terreno o desarrollo interesa al prospecto.
- Proporcionar información autorizada sobre precios y disponibilidad.
- Recopilar nombre, teléfono, presupuesto e intereses.
- Registrar automáticamente al prospecto en el CRM.
- Identificar si es cliente nuevo o existente.
- Consultar información actualizada de los proyectos.
- Transferir la conversación a un asesor cuando sea necesario.

**Sistema de distribución de prospectos (Lead Routing):**

Crear un mecanismo de asignación equitativa de prospectos entre los asesores comerciales.

Características:
- Distribución automática mediante algoritmo Round Robin.
- Considerar asesores activos y disponibles.
- Evitar asignaciones duplicadas.
- Registrar fecha, hora y asesor responsable.
- Permitir reasignaciones autorizadas.
- Medir tiempos de respuesta y conversión.
- Mantener historial de cada transferencia.
- Permitir escalamiento a un administrador.

La distribución debe ser transparente y auditable.

---

### 5. ENTORNO PRIVADO – CONTROL DE ACCESO

Crear un sistema de autenticación con roles y permisos.

**Administrador:**
Acceso completo a la operación, configuración, usuarios, finanzas, reportes, proyectos, clientes y configuración del sitio público.

**Gerencia:**
Acceso a indicadores, desempeño comercial, proyectos, cartera y reportes autorizados.

**Asesor comercial:**
Acceso únicamente a sus prospectos, clientes, conversaciones, oportunidades, operaciones y cartera asignada.

**Finanzas / Administración:**
Acceso a operaciones financieras, pagos, vencimientos, cuentas por cobrar y reportes financieros autorizados.

Aplicar el principio de mínimo privilegio.

Cada usuario debe visualizar exclusivamente la información que corresponde a su nivel de autorización.

Los administradores podrán consultar la actividad general del sistema y sus registros de auditoría.

---

### 6. CRM LITE – GESTIÓN DE CLIENTES

Construir un CRM funcional que permita:

- Registro de prospectos y clientes.
- Datos personales y medios de contacto.
- Fuente de captación.
- Proyecto de interés.
- Asesor asignado.
- Etapa comercial.
- Historial de llamadas y conversaciones.
- Seguimiento de actividades.
- Próxima fecha de contacto.
- Notas internas.
- Documentación relacionada.
- Historial de operaciones.
- Conversión de prospecto a cliente.

Crear un embudo comercial configurable:

Nuevo prospecto → Contactado → Interesado → Cita → Negociación → Venta → Cliente.

Incluir filtros, búsquedas, etiquetas y segmentación.

---

### 7. ADMINISTRACIÓN DE PROYECTOS

Desarrollar un módulo para crear y administrar diferentes desarrollos inmobiliarios.

Cada proyecto deberá permitir:

- Nombre y descripción.
- Ubicación.
- Fotografías y videos.
- Mapa y coordenadas.
- Superficie total.
- Número de lotes.
- Inventario de terrenos.
- Precio por lote.
- Disponibilidad.
- Estatus del proyecto.
- Servicios e infraestructura.
- Documentación.
- Responsables.
- Avances y actividades.

Incluir un tablero de control general que permita visualizar el estado de todos los proyectos.

---

### 8. MÓDULO FINANCIERO Y CARTERA

Desarrollar un módulo administrativo para gestionar las operaciones financieras relacionadas con los clientes y terrenos.

Funciones:

- Registro de ventas.
- Precios pactados.
- Anticipos.
- Enganches.
- Planes de financiamiento.
- Calendarios de pago.
- Registro de abonos.
- Saldos pendientes.
- Cuentas por cobrar.
- Historial de movimientos.
- Estados de cuenta.
- Cálculo de vencimientos.
- Identificación de clientes morosos.
- Reportes de ingresos y cartera.

Crear un sistema automático de alertas:

- Próximos vencimientos.
- Pagos vencidos.
- Clientes morosos.
- Saldos pendientes.
- Promesas de pago incumplidas.

Permitir generar estados de cuenta y reportes descargables.

Todas las operaciones financieras deben tener trazabilidad. Los registros de pagos confirmados no deben poder eliminarse silenciosamente; cualquier corrección deberá quedar auditada.

---

### 9. INTELIGENCIA ARTIFICIAL

Integrar un asistente de IA dentro del sistema que funcione como apoyo administrativo y comercial.

Debe ayudar a:

- Consultar información de clientes.
- Resumir conversaciones.
- Identificar prospectos sin seguimiento.
- Generar recordatorios.
- Preparar reportes comerciales.
- Analizar desempeño de asesores.
- Detectar tendencias de ventas.
- Identificar cartera vencida.
- Resumir movimientos financieros.
- Generar recomendaciones operativas.
- Consultar información de proyectos.

La IA deberá trabajar exclusivamente con información a la que el usuario tenga permiso de acceder.

No podrá autorizar pagos, modificar saldos, borrar clientes ni ejecutar operaciones sensibles sin autorización humana.

---

### 10. DASHBOARD Y ANALÍTICA

Crear un panel ejecutivo con indicadores y gráficas dinámicas.

Indicadores sugeridos:

**Comerciales:**
- Prospectos recibidos.
- Prospectos por asesor.
- Tiempo promedio de respuesta.
- Citas generadas.
- Ventas cerradas.
- Tasa de conversión.
- Ventas por proyecto.

**Financieros:**
- Ingresos.
- Cuentas por cobrar.
- Cartera vencida.
- Clientes morosos.
- Pagos recibidos.
- Proyección de cobranza.

**Operativos:**
- Proyectos activos.
- Terrenos disponibles.
- Terrenos vendidos.
- Inventario por desarrollo.
- Actividades pendientes.

Permitir filtrar por fechas, proyectos y asesores.

---

### 11. COMUNICACIÓN INTERNA Y MULTIUSUARIO

Desarrollar un mini chat interno para la comunicación entre administradores, gerencia y asesores.

Debe incluir:
- Mensajes individuales.
- Grupos de trabajo.
- Notificaciones.
- Indicadores de mensajes no leídos.
- Historial de conversaciones.
- Compartir referencias de clientes y proyectos mediante permisos.

La plataforma debe funcionar simultáneamente en varias computadoras y dispositivos.

**REQUISITO FUNDAMENTAL:**

No utilizar almacenamiento local del navegador como fuente principal de información compartida.

Implementar una base de datos centralizada, autenticación multiusuario y sincronización en tiempo real mediante tecnologías como WebSockets o mecanismos equivalentes.

Todos los usuarios autorizados deben visualizar información actualizada sin necesidad de recargar constantemente la página.

---

### 12. ARQUITECTURA, SEGURIDAD Y PROTECCIÓN DE INFORMACIÓN

Diseñar una arquitectura profesional y escalable.

Considerar:
- Frontend moderno y adaptable.
- Backend con API segura.
- Base de datos centralizada.
- Almacenamiento seguro de imágenes y documentos.
- Autenticación robusta.
- Control de acceso por roles.
- Cifrado de información sensible.
- Gestión segura de sesiones.
- Protección contra inyecciones SQL, XSS y CSRF.
- Protección contra accesos no autorizados.
- Registro de auditoría.
- Copias de seguridad.
- Recuperación ante fallos.
- Protección de credenciales y tokens de Meta.
- Variables de entorno y secretos fuera del frontend.
- Limitación de intentos de acceso.
- Políticas de privacidad y retención de datos.

No exponer información financiera, datos personales, credenciales, conversaciones privadas ni información de clientes en interfaces públicas.

Implementar separación estricta entre datos públicos y privados.

---

### 13. PRUEBAS, VALIDACIÓN Y CORRECCIÓN AUTOMÁTICA

Establecer un ciclo continuo de validación.

El sistema deberá ejecutar pruebas para identificar:

- Errores funcionales.
- Errores de navegación.
- Problemas de permisos.
- Accesos indebidos.
- Fugas de información.
- Errores de sincronización.
- Registros duplicados.
- Fallos en integraciones.
- Errores de cálculos financieros.
- Problemas de rendimiento.

Implementar pruebas automatizadas, pruebas de integración y pruebas de seguridad.

Crear un proceso iterativo:

1. Construir.
2. Probar.
3. Identificar errores.
4. Corregir.
5. Ejecutar nuevamente las pruebas.
6. Documentar resultados.
7. Repetir hasta cumplir los criterios de aceptación.

IMPORTANTE: No asumir que una prueba exitosa garantiza seguridad absoluta. Los cambios críticos deberán requerir revisión y autorización humana. No realizar modificaciones automáticas en producción sin respaldo y aprobación.

---

### 14. METODOLOGÍA DE DESARROLLO POR FASES

No intentar construir todo simultáneamente.

Desarrollar en fases independientes, funcionales y conectadas:

**FASE 1.** Arquitectura, diseño, base de datos y autenticación.

**FASE 2.** Página pública y administrador de contenidos.

**FASE 3.** CRM Lite y gestión de prospectos.

**FASE 4.** Integración con WhatsApp Business API y distribución automática de prospectos.

**FASE 5.** Administración de proyectos e inventarios.

**FASE 6.** Módulo financiero y cartera de clientes.

**FASE 7.** Inteligencia artificial, reportes y analítica.

**FASE 8.** Chat interno, notificaciones y sincronización multiusuario.

**FASE 9.** Pruebas integrales, seguridad, optimización y puesta en producción.

Cada fase debe entregar módulos funcionales, documentados y probados antes de avanzar.

---

### 15. REGLAS DE EJECUCIÓN

- No entregar únicamente prototipos visuales.
- No simular integraciones como si estuvieran conectadas.
- No utilizar datos ficticios como información real.
- No dejar botones sin funcionalidad.
- No almacenar información crítica únicamente en el navegador.
- No exponer credenciales ni información sensible.
- No sacrificar seguridad por rapidez.
- Mantener consistencia visual con el diseño original.
- Documentar las tecnologías utilizadas y las dependencias.
- Mantener una arquitectura preparada para crecer.

Cuando falten credenciales, configuraciones de Meta, dominios o servicios externos, preparar la integración y señalar claramente qué requiere configuración o autorización.

### RESULTADO FINAL ESPERADO

Una plataforma inmobiliaria integral que permita administrar desde un solo sitio:

1. La presencia comercial de la empresa.
2. La captación y atención de prospectos.
3. La distribución de oportunidades entre asesores.
4. La administración de clientes y ventas.
5. El control de proyectos y terrenos.
6. La cartera financiera y cobranza.
7. El desempeño comercial y operativo.
8. La comunicación interna.
9. La automatización mediante inteligencia artificial.

El resultado debe ser un sistema empresarial real, centralizado, multiusuario, seguro, escalable y preparado para operar en una empresa inmobiliaria con múltiples desarrollos y asesores comerciales.