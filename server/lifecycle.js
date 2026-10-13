import {now} from './http.js';
/** Close accepting issue once its exact cutoff instant has elapsed. Never reopens it. */
export async function closeExpiredIssues(c,at=now()){
 const r=await c.execute({sql:`UPDATE issues SET status='closed',closed_at=COALESCE(closed_at,?),updated_at=? WHERE status='open' AND julianday(cutoff_at)<=julianday(?)`,args:[at,at,at]});
 return Number(r.rowsAffected??r.changes??0);
}
