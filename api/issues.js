import {publishEligibleResults} from '../server/results.js';
import {announceEligibleTournaments} from '../server/tournaments.js';
import {closeExpiredIssues} from '../server/lifecycle.js';
import {db} from '../server/db.js';
import {planIssueChange,parseInstant} from '../server/issue-edit.js';
import {handle,method,body,send,fail,requireUser,requireAdmin,checkOrigin,now} from '../server/http.js';
const goodCode=s=>/^\d{8}$/.test(s)&&+s.slice(0,4)>=2021&&+s.slice(4,6)>=1&&+s.slice(4,6)<=55&&(s.slice(6)==='00'||(+s.slice(6)===+s.slice(4,6)+1&&+s.slice(6)<=55));
export default async function(req,res){await handle(res,async()=>{
 const user=await requireUser(req),c=await db();
 await closeExpiredIssues(c);
 if(req.method==='GET'){
   const result=await c.execute({sql:['admin','owner'].includes(user.role)?'SELECT * FROM issues ORDER BY release_at DESC':'SELECT code,release_at,cutoff_at,status,opened_at FROM issues WHERE status IN (\'open\',\'closed\') ORDER BY release_at DESC'});
   return send(res,200,{issues:result.rows});
 }
 if(req.method==='PATCH'){
   checkOrigin(req);requireAdmin(user);
   const v=await body(req);const id=String(v.code||'');
   if(!goodCode(id))fail(400,'号番号が正しくありません。');
   const tx=await c.transaction('write');
   try{
     const prior=(await tx.execute({sql:'SELECT * FROM issues WHERE code=?',args:[id]})).rows[0];
     if(!prior)fail(404,'ジャンプ号が見つかりません。');
     const update=planIssueChange(prior,v);
     const stamp=now();
     await tx.execute({sql:`UPDATE issues SET release_at=?,cutoff_at=?,cutoff_manually_edited=?,plan_reviewed_at=?,updated_at=? WHERE code=?`,args:[update.release,update.cutoff,update.manuallyEdited,update.planReviewedAt,stamp,id]});
     await tx.commit();
     // Once made public, earlier issue scores and tournaments are never hidden again.
     await publishEligibleResults(c);await announceEligibleTournaments(c);
     return send(res,200,{ok:true,code:id,release_at:update.release,cutoff_at:update.cutoff,status:prior.status});
   }catch(e){await tx.rollback();throw e}
 }
 method(req,'POST');checkOrigin(req);requireAdmin(user);const v=await body(req);
 const code=String(v.code||'');if(!goodCode(code))fail(400,'号番号が正しくありません。');
 const release=String(v.release_at||''),cutoff=String(v.cutoff_at||'');
 const releaseIso=parseInstant(release,'発売日時'),cutoffIso=parseInstant(cutoff,'締切日時');
 if(Date.parse(cutoffIso)>=Date.parse(releaseIso))fail(400,'発売日時と締切日時を確認してください。');
 const stamp=now();
 try{await c.execute({sql:'INSERT INTO issues(code,release_at,cutoff_at,status,created_at,updated_at) VALUES(?,?,?,?,?,?)',args:[code,releaseIso,cutoffIso,'planned',stamp,stamp]})}
 catch(e){if(String(e.message).includes('overlapping')||String(e.message).includes('UNIQUE'))fail(409,'同じ年の通常号・合併号が重複しています。');throw e}
 await publishEligibleResults(c);
 await announceEligibleTournaments(c);
 send(res,201,{ok:true,code});
})}
