import pg from 'pg';
export interface QueryResult { rows: Record<string, any>[] }
export interface Database {
  query(sql: string, params?: any[]): Promise<QueryResult>;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
}
export function postgres(url: string) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const db: Database = {
    query: (sql, params) => pool.query(sql, params),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: (sql, params) => client.query(sql, params), transaction: () => { throw new Error('Nested transaction'); } });
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      finally { client.release(); }
    },
  };
  return { db, close: () => pool.end() };
}
