import {db} from '../../server/db.js';
import {handle,method,body,send,fail,requireUser,requireAdmin,checkOrigin,now} from '../../server/http.js';
import {computeIssueScores,publishEligibleResults} from '../../server/results.js';
const goodOrder=(v)=>Array.isArray(v)&&v.length<=100&&v.every(id=>typeof id==='string'&&/^\d{4}$/.test(id))&&new Set(v).size===v.length;
const getRows=async(c,sql,args)=> (await c.execute({sql,args})).rows;
export default async function(req,res){await handle(res,async()=>{
 const user=await requireUser(req);requireAdmin(user);const c=await db();
 if(req.method==='GET'){
  const code=new URL(req.url,'https://local.invalid').searchParams.get('issue')||'';
  if(!/^\d{8}$/.test(code))fail(400,'号番号が正しくありません。');
  const issue=(await getRows(c,'SELECT * FROM issues WHERE code=?',[code]))[0];if(!issue)fail(404,'対象号がありません。');
  const frozen=await getRows(c,'SELECT f.work_id,w.title,f.color,f.initial_position FROM issue_frozen_works f JOIN works w ON w.id=f.work_id WHERE f.issue_code=? ORDER BY f.initial_position',[code]);
  const draft=await getRows(c,'SELECT work_id FROM actual_order_draft_items WHERE issue_code=? ORDER BY actual_rank',[code]);
  const actual=await getRows(c,'SELECT work_id FROM actual_order_items WHERE issue_code=? ORDER BY actual_rank',[code]);
  const hiatus=await getRows(c,'SELECT work_id FROM issue_sudden_hiatus WHERE issue_code=?',[code]);
  const scores=await getRows(c,'SELECT s.user_id,u.username,s.total_error,s.place FROM issue_scores s JOIN users u ON u.id=s.user_id WHERE s.issue_code=? ORDER BY s.place,u.id',[code]);
  return send(res,200,{issue,frozen,draft:draft.map(x=>x.work_id),actual:actual.map(x=>x.work_id),suddenHiatus:hiatus.map(x=>x.work_id),scores});
 }
 method(req,'POST');checkOrigin(req);const input=await body(req);
 const code=String(input.issue||''),action=String(input.action||''),order=input.order,sudden=input.suddenHiatus||[];
 if(!/^\d{8}$/.test(code)||!['draft','preview','confirm'].includes(action)||!goodOrder(order)||!goodOrder(sudden))fail(400,'登録内容の形式が正しくありません。');
 const tx=await c.transaction('write');
 try{
  const issue=(await getRows(tx,'SELECT status,cutoff_at FROM issues WHERE code=?',[code]))[0];
  if(!issue)fail(404,'対象号がありません。');
  if(issue.status==='open'&&Date.parse(issue.cutoff_at)>Date.now())fail(409,'受付中の号は採点できません。');
  if(Date.parse(issue.cutoff_at)>Date.now())fail(409,'締切前には実際の掲載順を登録できません。');
  const frozen=(await getRows(tx,'SELECT work_id FROM issue_frozen_works WHERE issue_code=?',[code])).map(x=>x.work_id);
  if(!frozen.length)fail(409,'受付開始時の対象作品がありません。');
  if(sudden.some(x=>!frozen.includes(x)))fail(400,'突発休載に対象外の作品が含まれています。');
  const ids=order.length?(await getRows(tx,`SELECT id FROM works WHERE id IN (${order.map(()=>'?').join(',')})`,order)).map(x=>x.id):[];
  if(ids.length!==order.length)fail(400,'未登録の作品が含まれています。');
  if(order.some(x=>sudden.includes(x)))fail(400,'突発休載作品を掲載順に含めることはできません。');
  if(action!=='draft'){
    const present=new Set(order);for(const x of frozen)if(!sudden.includes(x)&&!present.has(x))fail(409,'実際の掲載順に必要な作品が不足しています。');
  }
  const stamp=now();
  if(action==='draft'){
   await tx.execute({sql:'DELETE FROM actual_order_draft_items WHERE issue_code=?',args:[code]});
   for(const [i,id] of order.entries())await tx.execute({sql:'INSERT INTO actual_order_draft_items(issue_code,work_id,actual_rank) VALUES(?,?,?)',args:[code,id,i+1]});
   await tx.commit();return send(res,200,{ok:true,action});
  }
  const scores=await computeIssueScores(tx,code,order,sudden);
  if(action==='preview'){await tx.rollback();return send(res,200,{ok:true,action,scores});}
  // All writes (raw order, hiatus, all scores and confirmation) are atomic.
  await tx.execute({sql:'DELETE FROM actual_order_items WHERE issue_code=?',args:[code]});
  for(const [i,id] of order.entries())await tx.execute({sql:'INSERT INTO actual_order_items(issue_code,work_id,actual_rank) VALUES(?,?,?)',args:[code,id,i+1]});
  await tx.execute({sql:'DELETE FROM issue_sudden_hiatus WHERE issue_code=?',args:[code]});
  for(const id of sudden)await tx.execute({sql:'INSERT INTO issue_sudden_hiatus(issue_code,work_id,reported_at) VALUES(?,?,?)',args:[code,id,stamp]});
  await tx.execute({sql:'DELETE FROM issue_scores WHERE issue_code=?',args:[code]});
  for(const score of scores)await tx.execute({sql:'INSERT INTO issue_scores(issue_code,user_id,total_error,place,calculated_at) VALUES(?,?,?,?,?)',args:[code,score.user_id,score.total_error,score.place,stamp]});
  await tx.execute({sql:"UPDATE issues SET scores_confirmed_at=?,updated_at=?,status='closed',closed_at=COALESCE(closed_at,?) WHERE code=?",args:[stamp,stamp,stamp,code]});
  await tx.commit();
  await publishEligibleResults(c);
  return send(res,200,{ok:true,action,usersScored:scores.length,scores});
 }catch(e){await tx.rollback();throw e}
})}
