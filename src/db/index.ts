import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 15000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    });

    // Handle idle client terminations gracefully without crashing process
    global._postgresPool.on('error', (err: any) => {
      // In serverless / scale-to-zero environments, idle sockets can be closed by the proxy
      if (err?.code === '57P01' || err?.message?.includes('Connection terminated') || err?.code === 'ECONNRESET') {
        // Idle socket terminated by proxy, pool creates fresh connection on next query
        return;
      }
      console.warn('SQL client pool notice:', err.message || err);
    });
  }
  return global._postgresPool;
};

const pool = createPool();

export const db = drizzle(pool, { schema });
