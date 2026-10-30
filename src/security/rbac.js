// Principio de mínimo privilegio: cada permiso lista explícitamente los roles que lo tienen.
export const ROLES = {
  admin: 'Administrador',
  gerencia: 'Gerencia',
  asesor: 'Asesor comercial',
  finanzas: 'Finanzas / Administración',
};

const PERMISSIONS = {
  'dashboard.view': ['admin', 'gerencia', 'asesor', 'finanzas'],
  'leads.view_all': ['admin', 'gerencia'],
  'leads.view_own': ['asesor'],
  'leads.create': ['admin', 'gerencia', 'asesor'],
  'leads.reassign': ['admin', 'gerencia'],
  'leads.export': ['admin', 'gerencia'],
  'developments.manage': ['admin'],
  'settings.manage': ['admin'],
  'users.manage': ['admin'],
  'audit.view': ['admin'],
  'reports.commercial': ['admin', 'gerencia'],
};

export function can(user, permission) {
  return Boolean(user && PERMISSIONS[permission]?.includes(user.role));
}

export const canSeeLeads = (user) => can(user, 'leads.view_all') || can(user, 'leads.view_own');

export function requireAuth(req, res, next) {
  if (!req.user) {
    if (req.accepts(['html', 'json']) === 'json') return res.status(401).json({ error: 'No autenticado' });
    return res.redirect(303, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
  }
  next();
}

export function requirePermission(...permissions) {
  return (req, res, next) => {
    if (permissions.some((p) => can(req.user, p))) return next();
    res.status(403).send('No tienes permiso para acceder a esta sección.');
  };
}
