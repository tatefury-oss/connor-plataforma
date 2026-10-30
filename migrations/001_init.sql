-- CONNOR · Esquema inicial (Fase 1-3)
-- Usuarios, sesiones, contenido público, CRM, enrutamiento de prospectos,
-- WhatsApp y bitácora de auditoría inmutable.

CREATE TABLE users (
  id             bigserial PRIMARY KEY,
  email          text NOT NULL,
  name           text NOT NULL,
  phone          text,
  role           text NOT NULL CHECK (role IN ('admin', 'gerencia', 'asesor', 'finanzas')),
  password_hash  text NOT NULL,
  active         boolean NOT NULL DEFAULT true,
  available      boolean NOT NULL DEFAULT true,
  failed_logins  integer NOT NULL DEFAULT 0,
  locked_until   timestamptz,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Solo se guarda el hash SHA-256 del token; el token en claro vive en la cookie.
CREATE TABLE sessions (
  id            text PRIMARY KEY,
  user_id       bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token    text NOT NULL,
  ip            text,
  user_agent    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Configuración pública editable desde el panel (teléfonos, redes, textos).
CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  bigint REFERENCES users(id)
);

CREATE TABLE developments (
  id              bigserial PRIMARY KEY,
  slug            text NOT NULL UNIQUE,
  number          smallint NOT NULL,
  name            text NOT NULL,
  zone            text,
  location        text NOT NULL DEFAULT '',
  map_label       text NOT NULL DEFAULT '',
  description     text NOT NULL DEFAULT '',
  badge           text,
  cover_image     text,
  cover_alt       text NOT NULL DEFAULT '',
  -- Tres recuadros de la ficha: [{label, value, detail}]
  stats           jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_price     text,
  currency        text NOT NULL DEFAULT 'MXN' CHECK (currency IN ('MXN', 'USD')),
  features        text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'venta' CHECK (status IN ('preventa', 'venta', 'agotado')),
  published       boolean NOT NULL DEFAULT true,
  latitude        numeric(9, 6),
  longitude       numeric(9, 6),
  total_area_m2   numeric(12, 2),
  total_lots      integer,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE development_media (
  id              bigserial PRIMARY KEY,
  development_id  bigint NOT NULL REFERENCES developments(id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('image', 'video')),
  url             text NOT NULL,
  alt             text NOT NULL DEFAULT '',
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_media_dev_idx ON development_media (development_id, sort_order);

CREATE TABLE leads (
  id                 bigserial PRIMARY KEY,
  name               text NOT NULL,
  phone              text,
  phone_normalized   text,
  email              text,
  source             text NOT NULL CHECK (source IN ('web', 'whatsapp', 'telefono', 'referido', 'redes', 'visita', 'otro')),
  development_id     bigint REFERENCES developments(id) ON DELETE SET NULL,
  assigned_to        bigint REFERENCES users(id) ON DELETE SET NULL,
  stage              text NOT NULL DEFAULT 'nuevo'
                       CHECK (stage IN ('nuevo', 'contactado', 'interesado', 'cita', 'negociacion', 'venta', 'cliente', 'perdido')),
  budget             text,
  tags               text[] NOT NULL DEFAULT '{}',
  next_contact_at    timestamptz,
  first_response_at  timestamptz,
  assigned_at        timestamptz,
  escalated_at       timestamptz,
  privacy_consent_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
-- Un teléfono = un prospecto. Evita registros duplicados entre web y WhatsApp.
CREATE UNIQUE INDEX leads_phone_key ON leads (phone_normalized) WHERE phone_normalized IS NOT NULL;
CREATE INDEX leads_assigned_idx ON leads (assigned_to, stage);
CREATE INDEX leads_stage_idx ON leads (stage);
CREATE INDEX leads_next_contact_idx ON leads (next_contact_at) WHERE next_contact_at IS NOT NULL;

CREATE TABLE lead_activities (
  id          bigserial PRIMARY KEY,
  lead_id     bigint NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  type        text NOT NULL CHECK (type IN ('nota', 'llamada', 'whatsapp', 'email', 'cita', 'formulario', 'etapa', 'asignacion', 'sistema')),
  body        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_activities_lead_idx ON lead_activities (lead_id, created_at DESC);

-- Historial auditable de cada asignación / transferencia.
CREATE TABLE lead_assignments (
  id           bigserial PRIMARY KEY,
  lead_id      bigint NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  from_user    bigint REFERENCES users(id) ON DELETE SET NULL,
  to_user      bigint REFERENCES users(id) ON DELETE SET NULL,
  reason       text NOT NULL CHECK (reason IN ('round_robin', 'manual', 'reasignacion', 'escalamiento', 'sin_asesores')),
  assigned_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lead_assignments_lead_idx ON lead_assignments (lead_id, created_at);

-- Puntero del Round Robin (una sola fila, se bloquea con FOR UPDATE).
CREATE TABLE routing_state (
  id            smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_user_id  bigint REFERENCES users(id) ON DELETE SET NULL
);
INSERT INTO routing_state (id) VALUES (1);

CREATE TABLE wa_messages (
  id             bigserial PRIMARY KEY,
  wa_message_id  text UNIQUE,
  lead_id        bigint REFERENCES leads(id) ON DELETE SET NULL,
  direction      text NOT NULL CHECK (direction IN ('in', 'out')),
  phone          text NOT NULL,
  body           text NOT NULL DEFAULT '',
  status         text,
  sent_by        bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wa_messages_lead_idx ON wa_messages (lead_id, created_at);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  entity      text NOT NULL,
  entity_id   text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

-- La bitácora es de solo inserción: no se puede editar ni borrar en silencio.
CREATE FUNCTION audit_log_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log es inmutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();
