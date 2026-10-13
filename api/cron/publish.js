import {timingSafeEqual} from 'node:crypto';
import {db} from '../../server/db.js';
import {handle,method,send,fail} from '../../server/http.js';
import {publishEligibleResults} from '../../server/results.js';
import {announceEligibleTournaments} from '../../server/tournaments.js';
import {sendCutoffReminders,purgeExpired} from '../../server/notifications.js';
import {closeExpiredIssues} from '../../server/lifecycle.js';
/** Optional Cloudflare Cron -> HTTPS GET; never accept a credential via URL. */
export default async function(req,res){await handle(res,async()=>{
 method(req,'GET');
 const secret=process.env.CRON_SHARED_SECRET;
 if(!secret||secret.length<32)fail(503,'定期処理の認証情報が未設定です。');
 const given=String(req.headers.authorization||'').replace(/^Bearer /,'');
 const a=Buffer.from(secret),b=Buffer.from(given);
 if(a.length!==b.length||!timingSafeEqual(a,b))fail(401,'認証できません。');
 const client=await db();
 const closed=await closeExpiredIssues(client);
 const published=await publishEligibleResults(client);
 const announced=await announceEligibleTournaments(client);
 const reminded=await sendCutoffReminders(client);
 const purged=await purgeExpired(client);
 send(res,200,{ok:true,closed,published,announced,reminded,purged});
})}
