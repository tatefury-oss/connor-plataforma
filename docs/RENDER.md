# Publicar en Render (paso a paso)

Render toma el código directamente de GitHub. Cada vez que se une una solicitud de cambios a `main`, la página se vuelve a publicar sola.

> El archivo `render.yaml` se escribió sin poder consultar la documentación de Render desde el entorno de desarrollo. Render lo revisa al importarlo; si marca algún campo, copia el mensaje y lo corregimos.

## Antes de empezar

- Una cuenta de GitHub con acceso a `tatefury-oss/connor-plataforma` (la que ya usas).
- Una tarjeta para los planes de pago de Render. El servidor necesita un plan de pago para tener disco permanente (fotos y documentos) y para preparar la base antes de cada publicación; la base de datos también es de pago. Revisa los precios vigentes en render.com/pricing antes de confirmar.

## 1. Crear la cuenta y conectar GitHub

1. Entra a **render.com** y elige **Get Started** → **GitHub** (inicia sesión con tu cuenta de GitHub).
2. Cuando GitHub pregunte a qué repositorios dar acceso, elige **Only select repositories** → `connor-plataforma`.

## 2. Crear todo con el Blueprint

1. En el panel de Render: **New +** → **Blueprint**.
2. Elige el repositorio `connor-plataforma`, rama `main`.
3. Render lee `render.yaml` y muestra lo que va a crear: el servidor **connor-plataforma**, la base de datos **connor-db** y el disco **connor-data**.
4. Te pedirá las variables secretas (`ANTHROPIC_API_KEY` y las de `WHATSAPP_…`). **Puedes dejarlas vacías por ahora**: la página y el panel funcionan sin ellas, y solo los asistentes de IA y WhatsApp quedan apagados.
5. Pulsa **Apply**. La primera vez tarda unos minutos: crea la base, instala, aplica las migraciones y arranca.

Cuando termine, en el servicio **connor-plataforma** verás una dirección como `https://connor-plataforma-xxxx.onrender.com`. Esa es tu página.

## 3. Crear tu usuario administrador

1. En Render abre el servicio **connor-plataforma** → pestaña **Shell**.
2. Escribe (con tu correo y nombre):

   ```bash
   node scripts/create-user.js --email tu@correo.com --name "Tu Nombre" --role admin
   ```

3. Te pedirá una contraseña de al menos 12 caracteres.
4. Entra a `https://tu-direccion.onrender.com/admin` con ese correo y contraseña.

Desde **Usuarios** en el panel puedes crear después a los asesores, a gerencia y a finanzas.

## 4. Subir las fotos y el logotipo del diseño

Las imágenes del diseño van en `public/assets/` dentro del repositorio, con los mismos nombres que exportó la herramienta de diseño. Hay dos formas:

- Mandárselas a Claude en la siguiente sesión para que las agregue y abra la solicitud de cambios.
- En GitHub: carpeta `public/assets` → **Add file** → **Upload files** → arrastrar las imágenes → **Commit changes**. Render publica solo.

Las fotos de los desarrollos también se pueden cambiar desde el panel: **Desarrollos** → editar → foto de portada y galería. Esas se guardan en el disco de Render.

## 5. (Opcional) Usar tu dominio

1. En el servicio: **Settings** → **Custom Domains** → **Add**, por ejemplo `connor.mx` y `www.connor.mx`.
2. Render te indica los registros DNS que debes crear donde compraste el dominio. El certificado HTTPS se genera solo.
3. Agrega la variable `PUBLIC_URL` con `https://connor.mx` en **Environment** y guarda (se reinicia).

## 6. Activar después la IA y WhatsApp

En el servicio: **Environment** → llena `ANTHROPIC_API_KEY` y las variables `WHATSAPP_…` → **Save Changes**. Para WhatsApp, el webhook en Meta debe apuntar a `https://tu-direccion/webhooks/whatsapp` (ver el README).

## 7. Respaldos

Render hace copias automáticas de la base de datos según el plan. Además conviene descargar un respaldo propio cada cierto tiempo; ver `docs/OPERACION.md`.

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| El despliegue falla en "Pre-Deploy" | Revisar **Logs**: una migración no se pudo aplicar. Copiar el error y revisarlo con Claude. |
| El servidor no arranca: "PUBLIC_URL debe usar https://" | Agregar la variable `PUBLIC_URL` con la dirección `https://…onrender.com` del servicio. |
| La página carga pero sin fotos | Faltan las imágenes en `public/assets/` (paso 4). |
| El chat no se actualiza en vivo | Confirmar que entras por la dirección `https://` del servicio (o tu dominio configurado en `PUBLIC_URL`). |

## Diferencia con la instalación en servidor propio

En Render la aplicación usa el usuario dueño de la base de datos, no el usuario restringido de `deploy/db-roles.sql`. La bitácora, los pagos y las ventas siguen protegidos por los disparadores de la base, que impiden editarlos o borrarlos. Si más adelante se quiere ese segundo nivel de protección, se puede crear el usuario restringido desde la consola de la base de datos de Render.
