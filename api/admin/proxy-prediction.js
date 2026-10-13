import {randomUUID} from 'node:crypto';
import {db} from '../../server/db.js';
import {handle,method,body,send,fail,requireUser,requireAdmin,checkOrigin,now} from '../../server/http.js';
import {computeIssueScores} from '../../server/results.js';
export default async function(req,res){await handle(res,async()=>{
 const actor=await requireUser(req);requireAdmin(actor);const c=await db();
 const input=req.method==='GET'?Object.fromEntries(new URL(req.url,'https://local.invalid').searchParams.entries()):await body(req);
 const code=String(input.issue||''),username=String(input.username||'').trim();
 if(!/^\d{8}$/.test(code)||!username||username.length>40)fail(400,'対象号とユーザー名が必要です。');
 const user=(await c.execute({sql:'SELECT id,username FROM users WHERE username=? COLLATE NOCASE',args:[username]})).rows[0];
 if(!user)fail(404,'対象ユーザーが見つかりません。');
 const issue=(await c.execute({sql:'SELECT code,scores_confirmed_at,results_published_at FROM issues WHERE code=?',args:[code]})).rows[0];
 if(!issue)fail(404,'号が見つかりません。');
 const frozen=(await c.execute({sql:'SELECT work_id FROM issue_frozen_works WHERE issue_code=? ORDER BY initial_position',args:[code]})).rows.map(x=>x.work_id);
 if(!frozen.length)fail(409,'予想受付が開始されていない号です。');
 if(req.method==='GET'){
  const record=(await c.execute({sql:'SELECT id,first_submitted_at FROM predictions WHERE user_id=? AND issue_code=?',args:[user.id,code]})).rows[0];
  const order=record?(await c.execute({sql:'SELECT work_id FROM prediction_items WHERE prediction_id=? ORDER BY predicted_rank',args:[record.id]})).rows.map(x=>x.work_id):null;
  return send(res,200,{user,issue,frozen,formal:order,firstSubmittedAt:record?.first_submitted_at||null});
 }
 method(req,'POST');checkOrigin(req);
 const order=input.order;
 if(!Array.isArray(order)||order.length!==frozen.length||order.some(x=>typeof x!=='string'||!/^\d{4}$/.test(x))||new Set(order).size!==order.length||order.some(x=>!frozen.includes(x)))fail(400,'予想対象作品をすべて一度ずつ指定してください。');
 const stamp=now(),tx=await c.transaction('write');
 try{
  const previous=(await tx.execute({sql:'SELECT id FROM predictions WHERE user_id=? AND issue_code=?',args:[user.id,code]})).rows[0];
  const id=previous?.id||randomUUID();
  if(previous)await tx.execute({sql:'UPDATE predictions SET last_submitted_at=?,last_submitted_by=? WHERE id=?',args:[stamp,actor.id,id]});
  else await tx.execute({sql:'INSERT INTO predictions(id,issue_code,user_id,first_submitted_at,last_submitted_at,last_submitted_by) VALUES(?,?,?,?,?,?)',args:[id,code,user.id,stamp,stamp,actor.id]});
  await tx.execute({sql:'DELETE FROM prediction_items WHERE prediction_id=?',args:[id]});
  for(let i=0;i<order.length;i++)await tx.execute({sql:'INSERT INTO prediction_items(prediction_id,work_id,predicted_rank) VALUES(?,?,?)',args:[id,order[i],i+1]});
  let count=0;
  if(issue.scores_confirmed_at){
   const actual=(await tx.execute({sql:'SELECT work_id FROM actual_order_items WHERE issue_code=? ORDER BY actual_rank',args:[code]})).rows.map(x=>x.work_id);
   const hiatus=(await tx.execute({sql:'SELECT work_id FROM issue_sudden_hiatus WHERE issue_code=?',args:[code]})).rows.map(x=>x.work_id);
   const all=await computeIssueScores(tx,code,actual,hiatus);
   await tx.execute({sql:'DELETE FROM issue_scores WHERE issue_code=?',args:[code]});
   for(const sc of all)await tx.execute({sql:'INSERT INTO issue_scores(issue_code,user_id,total_error,place,calculated_at) VALUES(?,?,?,?,?)',args:[code,sc.user_id,sc.total_error,sc.place,stamp]});
   count=all.length;
  }
  await tx.commit();
  send(res,200,{ok:true,user:{id:user.id,username:user.username},recalculatedUsers:count,publicAlready:!!issue.results_published_at});
 }catch(e){await tx.rollback();throw e}
})}
