-- Fase 6 · Ventas, planes de pago, abonos y cartera.
-- Los saldos no se guardan: se calculan siempre a partir del calendario y los pagos confirmados,
-- así nunca pueden quedar desincronizados.

CREATE TABLE sales (
  id                 bigserial PRIMARY KEY,
  lot_id             bigint NOT NULL REFERENCES lots(id) ON DELETE RESTRICT,
  lead_id            bigint NOT NULL REFERENCES leads(id) ON DELETE RESTRICT,
  development_id     bigint NOT NULL REFERENCES developments(id) ON DELETE RESTRICT,
  advisor_id         bigint REFERENCES users(id) ON DELETE SET NULL,
  sale_date          date NOT NULL,
  currency           text NOT NULL CHECK (currency IN ('MXN', 'USD')),
  list_price         numeric(14, 2),
  agreed_price       numeric(14, 2) NOT NULL CHECK (agreed_price > 0),
  down_payment       numeric(14, 2) NOT NULL DEFAULT 0 CHECK (down_payment >= 0),
  installments_count integer NOT NULL CHECK (installments_count BETWEEN 0 AND 360),
  annual_rate        numeric(6, 3) NOT NULL DEFAULT 0 CHECK (annual_rate BETWEEN 0 AND 60),
  first_due_date     date,
  status             text NOT NULL DEFAULT 'activa' CHECK (status IN ('activa', 'liquidada', 'cancelada')),
  notes              text NOT NULL DEFAULT '',
  created_by         bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  cancelled_at       timestamptz,
  cancelled_by       bigint REFERENCES users(id) ON DELETE SET NULL,
  cancel_reason      text,
  CHECK (down_payment <= agreed_price),
  CHECK ((status = 'cancelada') = (cancelled_at IS NOT NULL))
);
-- Un lote solo puede tener una venta vigente.
CREATE UNIQUE INDEX sales_lot_active_key ON sales (lot_id) WHERE status <> 'cancelada';
CREATE INDEX sales_lead_idx ON sales (lead_id);

-- Calendario de pagos. number 0 = enganche.
CREATE TABLE installments (
  id         bigserial PRIMARY KEY,
  sale_id    bigint NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  number     integer NOT NULL,
  due_date   date NOT NULL,
  amount     numeric(14, 2) NOT NULL CHECK (amount >= 0),
  principal  numeric(14, 2) NOT NULL,
  interest   numeric(14, 2) NOT NULL DEFAULT 0,
  UNIQUE (sale_id, number)
);

CREATE TABLE payments (
  id           bigserial PRIMARY KEY,
  sale_id      bigint NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  amount       numeric(14, 2) NOT NULL CHECK (amount > 0),
  paid_at      date NOT NULL,
  method       text NOT NULL CHECK (method IN ('efectivo', 'transferencia', 'deposito', 'tarjeta', 'cheque', 'otro')),
  concept      text NOT NULL DEFAULT 'abono' CHECK (concept IN ('anticipo', 'enganche', 'mensualidad', 'abono', 'liquidacion')),
  reference    text NOT NULL DEFAULT '',
  received_by  bigint REFERENCES users(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'confirmado' CHECK (status IN ('confirmado', 'anulado')),
  voided_at    timestamptz,
  voided_by    bigint REFERENCES users(id) ON DELETE SET NULL,
  void_reason  text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payments_sale_idx ON payments (sale_id, paid_at);

CREATE TABLE payment_promises (
  id             bigserial PRIMARY KEY,
  sale_id        bigint NOT NULL REFERENCES sales(id) ON DELETE RESTRICT,
  promised_date  date NOT NULL,
  amount         numeric(14, 2) NOT NULL CHECK (amount > 0),
  note           text NOT NULL DEFAULT '',
  created_by     bigint REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_promises_sale_idx ON payment_promises (sale_id, promised_date);

-- Trazabilidad: un pago confirmado no se borra ni se edita; solo se anula con motivo y responsable.
CREATE FUNCTION payments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los pagos no se eliminan; se anulan con motivo';
  END IF;
  IF OLD.status = 'anulado' THEN
    RAISE EXCEPTION 'Un pago anulado no se puede modificar';
  END IF;
  IF NEW.amount <> OLD.amount OR NEW.sale_id <> OLD.sale_id OR NEW.paid_at <> OLD.paid_at
     OR NEW.method <> OLD.method OR NEW.concept <> OLD.concept OR NEW.reference <> OLD.reference
     OR NEW.received_by IS DISTINCT FROM OLD.received_by OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Los datos de un pago confirmado no se modifican; anúlalo y registra uno nuevo';
  END IF;
  IF NEW.status = 'anulado' AND (NEW.void_reason IS NULL OR btrim(NEW.void_reason) = '' OR NEW.voided_by IS NULL OR NEW.voided_at IS NULL) THEN
    RAISE EXCEPTION 'La anulación requiere motivo y responsable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payments_guard BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- El calendario pactado y las ventas no se borran.
CREATE FUNCTION finance_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% no se puede eliminar', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER sales_no_delete BEFORE DELETE ON sales FOR EACH ROW EXECUTE FUNCTION finance_no_delete();
CREATE TRIGGER installments_no_change BEFORE UPDATE OR DELETE ON installments FOR EACH ROW EXECUTE FUNCTION finance_no_delete();

-- Estado de cada parcialidad: los pagos confirmados se aplican en orden (enganche primero).
CREATE VIEW v_installments AS
WITH paid AS (
  SELECT sale_id, sum(amount) AS total FROM payments WHERE status = 'confirmado' GROUP BY sale_id
), sched AS (
  SELECT i.*, COALESCE(sum(i.amount) OVER (PARTITION BY i.sale_id ORDER BY i.number ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before_amount
    FROM installments i
)
SELECT s.id, s.sale_id, s.number, s.due_date, s.amount, s.principal, s.interest,
       LEAST(GREATEST(COALESCE(p.total, 0) - s.before_amount, 0), s.amount) AS paid_amount,
       s.amount - LEAST(GREATEST(COALESCE(p.total, 0) - s.before_amount, 0), s.amount) AS pending_amount,
       GREATEST((now() AT TIME ZONE 'America/Tijuana')::date - s.due_date, 0) AS days_late
  FROM sched s LEFT JOIN paid p ON p.sale_id = s.sale_id;

CREATE VIEW v_sales AS
SELECT s.*,
       COALESCE(t.total, 0) AS total_due,
       COALESCE(p.paid, 0) AS total_paid,
       COALESCE(t.total, 0) - COALESCE(p.paid, 0) AS balance,
       COALESCE(o.overdue_amount, 0) AS overdue_amount,
       COALESCE(o.overdue_count, 0) AS overdue_count,
       COALESCE(o.max_days_late, 0) AS max_days_late,
       n.next_due_date, n.next_due_amount
  FROM sales s
  LEFT JOIN (SELECT sale_id, sum(amount) AS total FROM installments GROUP BY sale_id) t ON t.sale_id = s.id
  LEFT JOIN (SELECT sale_id, sum(amount) AS paid FROM payments WHERE status = 'confirmado' GROUP BY sale_id) p ON p.sale_id = s.id
  LEFT JOIN (SELECT sale_id, sum(pending_amount) AS overdue_amount, count(*) AS overdue_count, max(days_late) AS max_days_late
               FROM v_installments WHERE pending_amount > 0 AND days_late > 0 GROUP BY sale_id) o ON o.sale_id = s.id
  LEFT JOIN LATERAL (SELECT due_date AS next_due_date, pending_amount AS next_due_amount FROM v_installments v
                      WHERE v.sale_id = s.id AND v.pending_amount > 0 ORDER BY v.number LIMIT 1) n ON true;
