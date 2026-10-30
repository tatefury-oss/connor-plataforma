-- Fase 5 · Inventario de lotes y administración de proyectos

ALTER TABLE developments ADD COLUMN manager_id bigint REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE lots (
  id              bigserial PRIMARY KEY,
  development_id  bigint NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  code            text NOT NULL,
  block           text NOT NULL DEFAULT '',
  number          text NOT NULL DEFAULT '',
  area_m2         numeric(10, 2),
  front_m         numeric(8, 2),
  depth_m         numeric(8, 2),
  price           numeric(14, 2),
  currency        text NOT NULL DEFAULT 'MXN' CHECK (currency IN ('MXN', 'USD')),
  status          text NOT NULL DEFAULT 'disponible' CHECK (status IN ('disponible', 'apartado', 'vendido', 'bloqueado')),
  lead_id         bigint REFERENCES leads(id) ON DELETE RESTRICT,
  reserved_by     bigint REFERENCES users(id) ON DELETE SET NULL,
  reserved_until  date,
  notes           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (development_id, code),
  -- Un lote apartado o vendido siempre está ligado a un prospecto/cliente.
  CHECK ((status IN ('apartado', 'vendido')) = (lead_id IS NOT NULL))
);
CREATE INDEX lots_dev_status_idx ON lots (development_id, status);
CREATE INDEX lots_lead_idx ON lots (lead_id) WHERE lead_id IS NOT NULL;

CREATE TABLE lot_events (
  id          bigserial PRIMARY KEY,
  lot_id      bigint NOT NULL REFERENCES lots(id) ON DELETE CASCADE,
  from_status text,
  to_status   text NOT NULL,
  lead_id     bigint REFERENCES leads(id) ON DELETE SET NULL,
  user_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  note        text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lot_events_lot_idx ON lot_events (lot_id, created_at);

-- Avances y actividades de obra / proyecto.
CREATE TABLE project_tasks (
  id              bigserial PRIMARY KEY,
  development_id  bigint NOT NULL REFERENCES developments(id) ON DELETE CASCADE,
  title           text NOT NULL,
  detail          text NOT NULL DEFAULT '',
  status          text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'en_proceso', 'completada')),
  assignee_id     bigint REFERENCES users(id) ON DELETE SET NULL,
  due_date        date,
  completed_at    timestamptz,
  created_by      bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_tasks_dev_idx ON project_tasks (development_id, status);

-- Documentación privada (planos, permisos, escrituras). No se sirve como archivo público.
CREATE TABLE project_documents (
  id              bigserial PRIMARY KEY,
  development_id  bigint NOT NULL REFERENCES developments(id) ON DELETE CASCADE,
  title           text NOT NULL,
  filename        text NOT NULL,
  stored_name     text NOT NULL UNIQUE,
  mime            text NOT NULL,
  size_bytes      integer NOT NULL,
  uploaded_by     bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
