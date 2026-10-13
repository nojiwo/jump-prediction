import {db} from '../../server/db.js';
import {handle,method,send,requireUser,requireAdmin} from '../../server/http.js';
import {publishEligibleResults} from '../../server/results.js';
export default async function(req,res){await handle(res,async()=>{
 method(req,'GET');const u=await requireUser(req);requireAdmin(u);
 const c=await db();const published=await publishEligibleResults(c);
 const issues=(await c.execute({sql:'SELECT code,scores_confirmed_at,results_published_at FROM issues ORDER BY code DESC'})).rows;
 send(res,200,{published,issues});
})}
