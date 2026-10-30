import pg from 'pg';
import { config } from './config.js';

// Los ids bigserial caben en un Number; evita comparar cadenas con números.
pg.types.setTypeParser(20, Number);
// Las columnas DATE se manejan como texto 'AAAA-MM-DD' para que no se desplacen por zona horaria.
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export const query = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

// Ejecuta fn dentro de una transacción; fn recibe el cliente.
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
