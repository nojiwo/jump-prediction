// Apply initial schema to a completely empty Turso/libSQL-compatible database.
// This command intentionally refuses databases already holding the users table.
import {createClient} from '@libsql/client';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const url=process.env.TURSO_DATABASE_URL;
if(!url)throw new Error('TURSO_DATABASE_URL is required');
const client=createClient({url,authToken:process.env.TURSO_AUTH_TOKEN});
try{
  const before=(await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")).rows;
  if(before.length)throw new Error('Database already contains users table. Refusing to reapply initial schema.');
  for(const filename of ['../migrations/001_initial.sql','../migrations/002_appearance.sql','../migrations/003_final_selection.sql']){
    const sql=readFileSync(new URL(filename,import.meta.url),'utf8');
    // Unlike manual splitting, executeMultiple safely supports triggers containing semicolons.
    await client.executeMultiple(sql);
    console.log('Applied:',filename);
  }
  const after=(await client.execute('SELECT count(*) AS amount FROM security_questions')).rows[0];
  console.log('Database initialization complete. Security questions:',after.amount);
}catch(e){console.error('Migration failed:',e.message,'\nIf the DB was partially created, inspect it before retrying. Do not rerun on a production database.');process.exitCode=1}
finally{client.close()}
