-- Fase 4 · Asistente virtual de WhatsApp
-- bot_paused_at: el bot deja de responder a ese prospecto (lo atiende un humano).
ALTER TABLE leads ADD COLUMN bot_paused_at timestamptz;
ALTER TABLE leads ADD COLUMN bot_pause_reason text;
ALTER TABLE wa_messages ADD COLUMN sent_by_bot boolean NOT NULL DEFAULT false;
ALTER TABLE lead_activities DROP CONSTRAINT lead_activities_type_check;
ALTER TABLE lead_activities ADD CONSTRAINT lead_activities_type_check
  CHECK (type IN ('nota', 'llamada', 'whatsapp', 'email', 'cita', 'formulario', 'etapa', 'asignacion', 'sistema', 'bot'));

-- Registro de cada ejecución del asistente (costos, errores y transferencias).
CREATE TABLE bot_runs (
  id             bigserial PRIMARY KEY,
  lead_id        bigint REFERENCES leads(id) ON DELETE SET NULL,
  status         text NOT NULL CHECK (status IN ('respondio', 'transferido', 'rechazado', 'error', 'omitido')),
  model          text,
  input_tokens   integer,
  output_tokens  integer,
  detail         text,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bot_runs_lead_idx ON bot_runs (lead_id, created_at DESC);
