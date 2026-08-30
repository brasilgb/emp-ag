import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

export const database = new Pool({
  connectionString: env.DATABASE_URL,
});

export async function checkDatabase(): Promise<boolean> {
  try {
    const result = await database.query('SELECT 1 AS ok');

    return result.rows[0]?.ok === 1;
  } catch {
    return false;
  }
}