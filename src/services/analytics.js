// Fase 7 · Indicadores comerciales y tendencias, siempre con el alcance del usuario que consulta.
import { many, one } from '../db.js';
import { can } from '../security/rbac.js';
import { SOURCES, STAGES } from './leads.js';

const TZ = `'America/Tijuana'`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Gerencia y administración ven todo; un asesor solo sus prospectos; finanzas no ve el CRM.
function leadScope(user, params, alias = 'l') {
  if (can(user, 'leads.view_all')) return 'TRUE';
  if (can(user, 'leads.view_own')) { params.push(user.id); return `${alias}.assigned_to = $${params.length}`; }
  return 'FALSE';
}

function financeScope(user, params, alias = 's') {
  if (can(user, 'finance.view_all')) return 'TRUE';
  if (can(user, 'finance.view_own')) {
    params.push(user.id);
    return `EXISTS (SELECT 1 FROM leads l2 WHERE l2.id = ${alias}.lead_id AND l2.assigned_to = $${params.length})`;
  }
  return 'FALSE';
}

export function normalizeRange(from, to, defaultDays = 30) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tijuana' }).format(new Date());
  const end = ISO.test(to ?? '') ? to : today;
  const start = ISO.test(from ?? '') ? from : new Date(Date.parse(`${end}T12:00:00Z`) - defaultDays * 86400000).toISOString().slice(0, 10);
  return start <= end ? [start, end] : [end, start];
}

/** Embudo, fuentes, desempeño por asesor y por desarrollo en un periodo. */
export async function commercialSummary(user, fromDate, toDate) {
  const [from, to] = normalizeRange(fromDate, toDate);
  const params = [from, to];
  const w = `${leadScope(user, params)} AND l.created_at >= ($1::date::timestamp AT TIME ZONE ${TZ}) AND l.created_at < (($2::date + 1)::timestamp AT TIME ZONE ${TZ})`;
  const [totals, byStage, bySource, byAdvisor, byDevelopment] = await Promise.all([
    one(`SELECT count(*)::int AS prospectos,
                count(*) FILTER (WHERE l.stage IN ('venta','cliente'))::int AS ventas,
                count(*) FILTER (WHERE l.stage = 'cita')::int AS citas,
                count(*) FILTER (WHERE l.assigned_to IS NULL)::int AS sin_asignar,
                count(*) FILTER (WHERE l.first_response_at IS NULL AND l.stage = 'nuevo')::int AS sin_contactar,
                round(avg(extract(epoch FROM l.first_response_at - l.assigned_at) / 60)::numeric, 1) AS respuesta_promedio_min
           FROM leads l WHERE ${w}`, params),
    many(`SELECT l.stage, count(*)::int AS n FROM leads l WHERE ${w} GROUP BY l.stage`, params),
    many(`SELECT l.source, count(*)::int AS n, count(*) FILTER (WHERE l.stage IN ('venta','cliente'))::int AS ventas
            FROM leads l WHERE ${w} GROUP BY l.source ORDER BY n DESC`, params),
    can(user, 'leads.view_all')
      ? many(`SELECT u.name AS asesor, count(l.id)::int AS prospectos,
                     count(l.id) FILTER (WHERE l.stage IN ('venta','cliente'))::int AS ventas,
                     count(l.id) FILTER (WHERE l.stage = 'nuevo')::int AS sin_contactar,
                     round(avg(extract(epoch FROM l.first_response_at - l.assigned_at) / 60)::numeric, 1) AS respuesta_promedio_min
                FROM users u LEFT JOIN leads l ON l.assigned_to = u.id AND ${w}
               WHERE u.role = 'asesor' AND u.active GROUP BY u.id ORDER BY ventas DESC, prospectos DESC`, params)
      : [],
    many(`SELECT COALESCE(d.name, 'Sin desarrollo') AS desarrollo, count(*)::int AS prospectos,
                 count(*) FILTER (WHERE l.stage IN ('venta','cliente'))::int AS ventas
            FROM leads l LEFT JOIN developments d ON d.id = l.development_id WHERE ${w}
           GROUP BY d.name ORDER BY prospectos DESC`, params),
  ]);
  const conversion = totals.prospectos ? Number(((totals.ventas / totals.prospectos) * 100).toFixed(1)) : null;
  return {
    periodo: { desde: from, hasta: to },
    totales: { ...totals, conversion_pct: conversion },
    embudo: Object.fromEntries(Object.entries(STAGES).map(([k, label]) => [label, byStage.find((r) => r.stage === k)?.n ?? 0])),
    por_fuente: bySource.map((r) => ({ fuente: SOURCES[r.source], prospectos: r.n, ventas: r.ventas })),
    por_asesor: byAdvisor,
    por_desarrollo: byDevelopment,
  };
}

/** Series mensuales de los últimos N meses (prospectos, ventas registradas, cobranza). */
export async function trends(user, months = 6) {
  const n = Math.min(Math.max(Number(months) || 6, 1), 24);
  const lp = [n];
  const fp = [n];
  const lw = leadScope(user, lp);
  const fw = financeScope(user, fp);
  const seeFinance = can(user, 'finance.view_all') || can(user, 'finance.view_own');
  const monthsSql = `SELECT to_char(m, 'YYYY-MM') AS mes FROM generate_series(
      date_trunc('month', (now() AT TIME ZONE ${TZ})::date) - (($1::int - 1) || ' months')::interval,
      date_trunc('month', (now() AT TIME ZONE ${TZ})::date), interval '1 month') m`;
  const [leads, sales, income] = await Promise.all([
    many(`WITH meses AS (${monthsSql})
          SELECT meses.mes, count(l.id)::int AS prospectos,
                 count(l.id) FILTER (WHERE l.stage IN ('venta','cliente'))::int AS convertidos
            FROM meses LEFT JOIN leads l ON to_char(l.created_at AT TIME ZONE ${TZ}, 'YYYY-MM') = meses.mes AND ${lw}
           GROUP BY meses.mes ORDER BY meses.mes`, lp),
    seeFinance ? many(`WITH meses AS (${monthsSql})
          SELECT meses.mes, s.currency AS moneda, count(s.id)::int AS ventas, COALESCE(sum(s.agreed_price), 0) AS monto
            FROM meses LEFT JOIN sales s ON to_char(s.sale_date, 'YYYY-MM') = meses.mes AND s.status <> 'cancelada' AND ${fw}
           GROUP BY meses.mes, s.currency ORDER BY meses.mes`, fp) : [],
    seeFinance ? many(`WITH meses AS (${monthsSql})
          SELECT meses.mes, s.currency AS moneda, COALESCE(sum(p.amount), 0) AS cobrado
            FROM meses LEFT JOIN payments p ON to_char(p.paid_at, 'YYYY-MM') = meses.mes AND p.status = 'confirmado'
            LEFT JOIN sales s ON s.id = p.sale_id AND ${fw}
           WHERE p.id IS NULL OR s.id IS NOT NULL
           GROUP BY meses.mes, s.currency ORDER BY meses.mes`, fp) : [],
  ]);
  return {
    meses: n,
    prospectos_por_mes: leads,
    ventas_por_mes: sales.filter((r) => r.moneda),
    cobranza_por_mes: income.filter((r) => r.moneda),
    nota: seeFinance ? undefined : 'Sin acceso a información financiera con este rol.',
  };
}

/** Prospectos activos con seguimiento vencido o sin próxima fecha, del más urgente al menos. */
export function staleLeads(user, limit = 30) {
  const params = [];
  const w = leadScope(user, params);
  params.push(Math.min(Number(limit) || 30, 100));
  return many(
    `SELECT l.id, l.name AS nombre, l.stage AS etapa, l.next_contact_at AS proximo_contacto, u.name AS asesor, d.name AS desarrollo,
            (SELECT max(a.created_at) FROM lead_activities a WHERE a.lead_id = l.id AND a.user_id IS NOT NULL) AS ultima_actividad_humana,
            l.created_at AS alta
       FROM leads l LEFT JOIN users u ON u.id = l.assigned_to LEFT JOIN developments d ON d.id = l.development_id
      WHERE ${w} AND l.stage NOT IN ('cliente', 'perdido')
        AND (l.next_contact_at < now() OR l.next_contact_at IS NULL)
      ORDER BY l.next_contact_at NULLS FIRST, l.created_at
      LIMIT $${params.length}`, params);
}
