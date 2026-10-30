export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k) continue;
    try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* cookie mal formada */ }
  }
  return out;
}

export function cookieMiddleware(req, _res, next) {
  req.cookies = parseCookies(req.headers.cookie);
  next();
}
