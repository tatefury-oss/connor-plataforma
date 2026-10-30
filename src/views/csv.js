// CSV compatible con Excel (BOM UTF-8) y protegido contra inyección de fórmulas.
export function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function csvResponse(res, filename, rows) {
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  res.send('\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
}
