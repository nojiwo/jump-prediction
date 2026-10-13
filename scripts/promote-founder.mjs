// One-off deployment administration, run ONLY after creating your own account.
// Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/promote-founder.mjs <username>
import {createClient} from '@libsql/client';
const username=process.argv[2];
if(!username||!process.env.TURSO_DATABASE_URL)throw new Error('username and TURSO_DATABASE_URL required');
const client=createClient({url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN});
const account=(await client.execute({sql:'SELECT id,username FROM users WHERE username=? COLLATE NOCASE',args:[username]})).rows[0];
if(!account)throw new Error('User not found. Register normally first.');
const prior=(await client.execute('SELECT username FROM users WHERE is_founder=1')).rows;
if(prior.length)throw new Error('Founder already exists; will not replace it');
await client.execute({sql:"UPDATE users SET role='owner',is_founder=1,updated_at=? WHERE id=?",args:[new Date().toISOString(),account.id]});
console.log(`Founder set: ${account.username}. Keep this command limited to private administrator terminals.`);
client.close();
