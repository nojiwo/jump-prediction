// Only Vercel Functions import this module. Never expose auth tokens to Vite.
let instance;
/** For local integration tests only; never called by HTTP handlers. */
export function __setTestDb(testClient){ instance=testClient; }
export async function db(){
  if (instance) return instance;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('TURSO_DATABASE_URL is not configured');
  if (!instance) {
    const { createClient } = await import('@libsql/client');
    instance = createClient({url, authToken: process.env.TURSO_AUTH_TOKEN || undefined});
  }
  return instance;
}
export async function rows(sql, args=[]){const c=await db(); return (await c.execute({sql,args})).rows}
export async function row(sql,args=[]){return (await rows(sql,args))[0] ?? null}
