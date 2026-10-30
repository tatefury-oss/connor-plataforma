import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const N = 32768, R = 8, P = 1, KEYLEN = 64;
const MAXMEM = 128 * N * R * 2;

export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [alg, n, r, p, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2,
  });
  return timingSafeEqual(key, expected);
}

export function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`;
  }
  if (password.length > 200) return 'La contraseña es demasiado larga.';
  return null;
}

// Hash ficticio para igualar tiempos cuando el usuario no existe.
export const DUMMY_HASH = await hashPassword(randomBytes(12).toString('hex'));
