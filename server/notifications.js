import {randomUUID} from 'node:crypto';
import {now} from './http.js';
const in30Days=()=>new Date(Date.now()+30*86400000).toISOString();
const query=async(c,sql,args=[]) => (await c.execute({sql,args})).rows;
/** insert once per user, source, notification category; duplicates are harmless */
export async function enqueue(c,userId,kind,sourceId,payload={}){
 await c.execute({sql:`INSERT OR IGNORE INTO notifications(id,user_id,kind,source_id,payload_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?)`,args:[randomUUID(),userId,kind,sourceId,JSON.stringify(payload),now(),in30Days()]});
}
export async function notifyImportant(c,announcement){
 if(announcement.important_notified_at||announcement.status!=='published'||!announcement.pinned)return false;
 const stamp=now();
 const tx=await c.transaction('write');try{
  const result=await tx.execute({sql:`UPDATE announcements SET important_notified_at=? WHERE id=? AND important_notified_at IS NULL AND status='published' AND pinned=1`,args:[stamp,announcement.id]});
  if(!Number(result.rowsAffected??result.changes??0)){await tx.rollback();return false;}
  const people=await query(tx,'SELECT id FROM users');
  for(const u of people)await enqueue(tx,u.id,'important_announcement',announcement.id,{title:announcement.title});
  await tx.commit();return true;
 }catch(e){await tx.rollback();throw e}
}
/** Cron-safe. Any missing-submit reminder fires at most once and only in final 12h.
 * Use the user's formal submission, not the presence of a draft.
 */
export async function sendCutoffReminders(c,stamp=now()){
 const cutoff=new Date(Date.parse(stamp)+12*3600000).toISOString();
 const open=await query(c,`SELECT code,cutoff_at FROM issues WHERE status='open' AND julianday(cutoff_at)>julianday(?) AND julianday(cutoff_at)<=julianday(?)`,[stamp,cutoff]);
 let sent=0;
 for(const issue of open){
  const people=await query(c,'SELECT u.id FROM users u WHERE NOT EXISTS (SELECT 1 FROM predictions p WHERE p.user_id=u.id AND p.issue_code=?)',[issue.code]);
  for(const u of people){await enqueue(c,u.id,'cutoff_reminder',issue.code,{issue:issue.code,cutoff:issue.cutoff_at});sent++}
 }
 return {issues:open.length,attempted:sent};
}
export async function purgeExpired(c,stamp=now()){
 const r=await c.execute({sql:'DELETE FROM notifications WHERE expires_at<=?',args:[stamp]});
 return Number(r.rowsAffected??r.changes??0);
}
