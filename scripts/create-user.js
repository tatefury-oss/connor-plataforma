// Crea un usuario desde la terminal (el primer administrador se da de alta así).
// Uso: npm run create-user -- --email admin@empresa.com --name "Nombre" --role admin
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { pool } from '../src/db.js';
import { migrate } from '../src/migrate.js';
import { hashPassword, passwordProblem } from '../src/security/passwords.js';
import { ROLES } from '../src/security/rbac.js';
import { audit } from '../src/services/audit.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, name: { type: 'string' }, role: { type: 'string', default: 'admin' } } });
if (!values.email || !values.name || !ROLES[values.role]) {
  console.error(`Uso: npm run create-user -- --email correo --name "Nombre" --role ${Object.keys(ROLES).join('|')}`);
  process.exit(1);
}

// La contraseña se pide de forma interactiva o por la variable NEW_USER_PASSWORD; nunca por argumento.
let password = process.env.NEW_USER_PASSWORD;
if (!password) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  password = await rl.question('Contraseña (mín. 12 caracteres): ');
  rl.close();
}
const problem = passwordProblem(password);
if (problem) { console.error(problem); process.exit(1); }

await migrate({ log: () => {} });
try {
  const { rows: [u] } = await pool.query(
    'INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4) RETURNING id',
    [values.email.toLowerCase(), values.name, values.role, await hashPassword(password)],
  );
  await audit({ userId: null, action: 'user.create_cli', entity: 'user', entityId: u.id, details: { email: values.email, role: values.role } });
  console.log(`Usuario creado (#${u.id}) con rol ${ROLES[values.role]}.`);
} catch (err) {
  console.error(err.code === '23505' ? 'Ya existe un usuario con ese correo.' : err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
