import { drizzle } from 'drizzle-orm/node-postgres';

import { database } from '../services/database.js';

import * as schema from './schema/index.js';

export const db = drizzle(database, {
  schema,
});