-- Fase 8 · Chat interno, grupos de trabajo y notificaciones persistentes

CREATE TABLE chat_channels (
  id          bigserial PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('direct', 'group')),
  name        text,
  -- Para mensajes directos: "idMenor:idMayor", evita duplicar la conversación entre dos personas.
  direct_key  text UNIQUE,
  created_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_message_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'direct') = (direct_key IS NOT NULL)),
  CHECK (kind = 'direct' OR name IS NOT NULL)
);

CREATE TABLE chat_members (
  channel_id     bigint NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id        bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role           text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  last_read_id   bigint NOT NULL DEFAULT 0,
  joined_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX chat_members_user_idx ON chat_members (user_id);

CREATE TABLE chat_messages (
  id          bigserial PRIMARY KEY,
  channel_id  bigint NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
  user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  body        text NOT NULL DEFAULT '',
  -- Referencia compartida (prospecto, lote, venta o desarrollo). Cada lector la ve según sus permisos.
  ref_type    text CHECK (ref_type IN ('lead', 'lot', 'sale', 'development')),
  ref_id      bigint,
  system      boolean NOT NULL DEFAULT false,
  deleted_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((ref_type IS NULL) = (ref_id IS NULL))
);
CREATE INDEX chat_messages_channel_idx ON chat_messages (channel_id, id);

CREATE TABLE notifications (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        text NOT NULL,
  title       text NOT NULL,
  body        text NOT NULL DEFAULT '',
  url         text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, read_at, created_at DESC);
