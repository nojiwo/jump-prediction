import {db} from '../../server/db.js';
import {handle,method,send,fail,requireUser,requireAdmin} from '../../server/http.js';
import {calculateScore} from '../../server/results.js';
import {stageStandings} from '../../server/tournaments.js';
const rows=async(c,sql,args=[]) => (await c.execute({sql,args})).rows;
export default async function(req,res){await handle(res,async()=>{
 method(req,'GET');requireAdmin(await requireUser(req));const c=await db();
 const query=new URL(req.url,'https://example.invalid').searchParams,type=query.get('type'),code=query.get('issue'),stageId=query.get('stage');
 const scope=query.get('scope')||'all',tournamentId=query.get('tournament');
 if(!['all','qualifier','final','nonfinal'].includes(scope))fail(400,'出力範囲が正しくありません。');
 if(type==='tournament'&&scope!=='all')fail(400,'大会帳票の対象者は参加者のみです。');
 if(type==='tournament'){
  if(!stageId)fail(400,'大会の予選または本戦を選択してください。');
  const standing=await stageStandings(c,stageId,{admin:true,asOf:query.get('asOf')});
  const stage=(await rows(c,'SELECT s.kind,t.title FROM tournament_stages s JOIN tournaments t ON t.id=s.tournament_id WHERE s.id=?',[stageId]))[0];
  if(!stage)fail(404,'対象大会がありません。');
  return send(res,200,{type:'tournament',title:`${stage.title}（${stage.kind==='qualifier'?'予選':'本戦'}）`,...standing});
 }
 if(!['works','issue'].includes(type)||!/^\d{8}$/.test(code||''))fail(400,'出力条件を指定してください。');
 const issue=(await rows(c,'SELECT code,scores_confirmed_at FROM issues WHERE code=?',[code]))[0];
 if(!issue||!issue.scores_confirmed_at)fail(409,'この号の採点はまだ確定していません。');
 let scores=await rows(c,`SELECT sc.user_id,u.username,sc.total_error,sc.place FROM issue_scores sc JOIN users u ON u.id=sc.user_id WHERE sc.issue_code=? ORDER BY sc.total_error,sc.user_id`,[code]);
 let scopeLabel='全参加者';
 if(scope!=='all'){
  if(!tournamentId||tournamentId.length>100)fail(400,'大会を選択してください。');
  const stages=await rows(c,`SELECT s.id,s.kind,t.title FROM tournament_stages s JOIN tournaments t ON t.id=s.tournament_id WHERE t.id=?`,[tournamentId]);
  if(!stages.length)fail(404,'対象大会がありません。');
  const qualifier=stages.find(x=>x.kind==='qualifier'),final=stages.find(x=>x.kind==='final');
  if(scope==='qualifier'&&!qualifier||scope==='final'&&!final||scope==='nonfinal'&&(!qualifier||!final))fail(400,'選択された大会に必要な区分がありません。');
  const involved=await rows(c,`SELECT p.user_id,s.kind FROM stage_participants p JOIN tournament_stages s ON s.id=p.stage_id WHERE s.tournament_id=?`,[tournamentId]);
  const qs=new Set(involved.filter(x=>x.kind==='qualifier').map(x=>x.user_id));
  const fs=new Set(involved.filter(x=>x.kind==='final').map(x=>x.user_id));
  const chosen=scope==='qualifier'?qs:scope==='final'?fs:new Set([...qs].filter(x=>!fs.has(x)));
  scores=scores.filter(x=>chosen.has(x.user_id)).map((x,i,all)=>({...x,place:1+all.filter(u=>Number(u.total_error)<Number(x.total_error)).length}));
  scopeLabel=`${stages[0].title}・${{qualifier:'予選参加者',final:'本戦参加者',nonfinal:'本戦非進出者'}[scope]}`;
 }
 if(type==='issue')return send(res,200,{type:'issue',issue:code,rankings:scores,scopeLabel});
 const actual=(await rows(c,'SELECT work_id FROM actual_order_items WHERE issue_code=? ORDER BY actual_rank',[code])).map(x=>x.work_id);
 const frozen=(await rows(c,`SELECT f.work_id,w.title FROM issue_frozen_works f JOIN works w ON w.id=f.work_id WHERE f.issue_code=? ORDER BY f.initial_position`,[code]));
 const absent=(await rows(c,'SELECT work_id FROM issue_sudden_hiatus WHERE issue_code=?',[code])).map(x=>x.work_id);
 const relevant=new Set(frozen.map(x=>x.work_id).filter(id=>!absent.includes(id)));
 const scored=actual.filter(id=>relevant.has(id));
 const works=scored.map((id,i)=>({id,title:frozen.find(w=>w.work_id===id)?.title,actualRank:i+1}));
 const users=[];
 for(const u of scores){
  const prediction=(await rows(c,`SELECT pi.work_id FROM predictions p JOIN prediction_items pi ON pi.prediction_id=p.id
   WHERE p.issue_code=? AND p.user_id=? ORDER BY pi.predicted_rank`,[code,u.user_id])).map(x=>x.work_id);
  const result=calculateScore(prediction,actual,frozen.map(w=>w.work_id),absent);
  users.push({...u,errors:Object.fromEntries(result.perWork.map(x=>[x.workId,x.error]))});
 }
 return send(res,200,{type:'works',issue:code,works,users,scopeLabel});
})}
