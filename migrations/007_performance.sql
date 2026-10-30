-- Fase 9 · Rendimiento de cartera.

-- 1) El calendario es inmutable, así que el monto acumulado de las parcialidades anteriores se guarda
--    al crearlo; la vista ya no necesita una función de ventana sobre todas las parcialidades.
ALTER TABLE installments ADD COLUMN before_amount numeric(14, 2);
ALTER TABLE installments DISABLE TRIGGER installments_no_change;
UPDATE installments i SET before_amount = x.before
  FROM (SELECT id, COALESCE(sum(amount) OVER (PARTITION BY sale_id ORDER BY number ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS before
          FROM installments) x
 WHERE x.id = i.id;
ALTER TABLE installments ENABLE TRIGGER installments_no_change;
ALTER TABLE installments ALTER COLUMN before_amount SET NOT NULL;

DROP VIEW v_sales;
DROP VIEW v_installments;
CREATE VIEW v_installments AS
SELECT i.id, i.sale_id, i.number, i.due_date, i.amount, i.principal, i.interest,
       LEAST(GREATEST(COALESCE(p.total, 0) - i.before_amount, 0), i.amount) AS paid_amount,
       i.amount - LEAST(GREATEST(COALESCE(p.total, 0) - i.before_amount, 0), i.amount) AS pending_amount,
       GREATEST((now() AT TIME ZONE 'America/Tijuana')::date - i.due_date, 0) AS days_late
  FROM installments i
  LEFT JOIN (SELECT sale_id, sum(amount) AS total FROM payments WHERE status = 'confirmado' GROUP BY sale_id) p ON p.sale_id = i.sale_id;

-- 2) v_sales calculaba el "próximo pago" con una subconsulta LATERAL que recorría v_installments una vez
-- por venta. Ahora todo sale de una sola agregación por venta (y sigue filtrando por id cuando se pide una).
CREATE VIEW v_sales AS
SELECT s.*,
       COALESCE(i.total, 0) AS total_due,
       COALESCE(p.paid, 0) AS total_paid,
       COALESCE(i.total, 0) - COALESCE(p.paid, 0) AS balance,
       COALESCE(i.overdue_amount, 0) AS overdue_amount,
       COALESCE(i.overdue_count, 0) AS overdue_count,
       COALESCE(i.max_days_late, 0) AS max_days_late,
       n.due_date AS next_due_date,
       n.amount - LEAST(GREATEST(COALESCE(p.paid, 0) - n.before_amount, 0), n.amount) AS next_due_amount
  FROM sales s
  LEFT JOIN (
    SELECT sale_id,
           sum(amount) AS total,
           sum(pending_amount) FILTER (WHERE pending_amount > 0 AND days_late > 0) AS overdue_amount,
           count(*) FILTER (WHERE pending_amount > 0 AND days_late > 0) AS overdue_count,
           max(days_late) FILTER (WHERE pending_amount > 0 AND days_late > 0) AS max_days_late,
           min(number) FILTER (WHERE pending_amount > 0) AS next_number
      FROM v_installments GROUP BY sale_id
  ) i ON i.sale_id = s.id
  LEFT JOIN (SELECT sale_id, sum(amount) AS paid FROM payments WHERE status = 'confirmado' GROUP BY sale_id) p ON p.sale_id = s.id
  LEFT JOIN installments n ON n.sale_id = s.id AND n.number = i.next_number;

-- Índices para filtros frecuentes del CRM y la cartera.
CREATE INDEX IF NOT EXISTS leads_created_idx ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_dev_idx ON leads (development_id);
CREATE INDEX IF NOT EXISTS payments_paid_at_idx ON payments (paid_at) WHERE status = 'confirmado';
CREATE INDEX IF NOT EXISTS sales_status_idx ON sales (status);
CREATE INDEX IF NOT EXISTS notifications_unread_idx ON notifications (user_id) WHERE read_at IS NULL;
