-- Fase 7 · Asistente interno con IA
-- Cada conversación es privada de su usuario. El contenido se guarda tal como lo devuelve la API
-- (incluidas llamadas a herramientas) para reenviar el historial sin alterarlo.
CREATE TABLE assistant_conversations (
  id          bigserial PRIMARY KEY,
  user_id     bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       text NOT NULL DEFAULT 'Nueva conversación',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_conversations_user_idx ON assistant_conversations (user_id, updated_at DESC);

CREATE TABLE assistant_messages (
  id               bigserial PRIMARY KEY,
  conversation_id  bigint NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('user', 'assistant')),
  content          jsonb NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_messages_conv_idx ON assistant_messages (conversation_id, id);

CREATE TABLE assistant_runs (
  id               bigserial PRIMARY KEY,
  user_id          bigint REFERENCES users(id) ON DELETE SET NULL,
  conversation_id  bigint REFERENCES assistant_conversations(id) ON DELETE SET NULL,
  status           text NOT NULL CHECK (status IN ('ok', 'error', 'rechazado', 'limite')),
  tools            text[] NOT NULL DEFAULT '{}',
  input_tokens     integer NOT NULL DEFAULT 0,
  output_tokens    integer NOT NULL DEFAULT 0,
  detail           text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX assistant_runs_user_idx ON assistant_runs (user_id, created_at DESC);
