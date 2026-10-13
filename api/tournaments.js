import {randomUUID} from 'node:crypto';
import {db} from '../server/db.js';
import {handle,body,method,send,fail,requireUser,requireAdmin,checkOrigin,now} from '../server/http.js';
import {announceEligibleTournaments,tournamentDetail,stageStandings,validStageIssues,overlapsMagazineIssue,finalCandidateGroups} from '../server/tournaments.js';
const query=async(c,sql,args=[]) => (await c.execute({sql,args})).rows;
export default async function(req,res){await handle(res,async()=>{
 const user=await requireUser(req),admin=['admin','owner'].includes(user.role),c=await db();
 if(req.method==='GET'){
  const qs=new URL(req.url,'https://example.invalid').searchParams;
  if(qs.get('finalCandidates')){requireAdmin(user);return send(res,200,await finalCandidateGroups(c,qs.get('finalCandidates')));}
  if(qs.get('stage'))return send(res,200,await stageStandings(c,qs.get('stage'),{admin,asOf:qs.get('asOf')}));
  if(qs.get('id'))return send(res,200,await tournamentDetail(c,qs.get('id'),admin));
  await announceEligibleTournaments(c);
  const list=await query(c,admin?'SELECT * FROM tournaments ORDER BY created_at DESC':`SELECT id,title,announced_at FROM tournaments WHERE announced_at IS NOT NULL AND archived_at IS NULL ORDER BY announced_at DESC`);
  return send(res,200,{tournaments:list});
 }
 method(req,'POST');checkOrigin(req);const v=await body(req);const action=String(v.action||'');
 if(action==='join'){
  const stage=(await query(c,`SELECT s.*,t.announced_at,t.archived_at FROM tournament_stages s JOIN tournaments t ON t.id=s.tournament_id WHERE s.id=?`,[v.stageId]))[0];
  if(!stage||stage.kind!=='qualifier'||!stage.announced_at||stage.archived_at)fail(404,'参加可能な予選がありません。');
  const first=(await query(c,`SELECT i.cutoff_at FROM stage_issues si JOIN issues i ON i.code=si.issue_code WHERE si.stage_id=? ORDER BY si.issue_code LIMIT 1`,[v.stageId]))[0];
  if(!first||Date.now()>=Date.parse(first.cutoff_at))fail(409,'参加登録の期限を過ぎています。');
  await c.execute({sql:`INSERT OR IGNORE INTO stage_participants(stage_id,user_id,joined_at,enrollment_source) VALUES(?,?,?,'self')`,args:[stage.id,user.id,now()]});
  return send(res,200,{ok:true});
 }
 requireAdmin(user);
 if(action==='create'){
  const title=String(v.title||'').trim(),phases=v.stages;
  if(!title||title.length>90||!Array.isArray(phases)||!phases.length||phases.length>2||new Set(phases.map(x=>x.kind)).size!==phases.length||phases.some(p=>!['qualifier','final'].includes(p.kind)||!validStageIssues(p.issues)))fail(400,'大会設定を確認してください。');
  const codes=phases.flatMap(p=>p.issues);
  if(codes.some((a,i)=>codes.slice(i+1).some(b=>overlapsMagazineIssue(a,b))))fail(409,'予選と本戦で対象号が重複しています。');
  const used=await query(c,`SELECT si.issue_code FROM stage_issues si JOIN tournament_stages s ON s.id=si.stage_id JOIN tournaments t ON t.id=s.tournament_id WHERE t.archived_at IS NULL`);
  if(codes.some(x=>used.some(y=>overlapsMagazineIssue(x,y.issue_code))))fail(409,'他の開催中の大会と対象号が重複しています。');
  const tx=await c.transaction('write');try{
   const id=randomUUID(),stamp=now();await tx.execute({sql:'INSERT INTO tournaments(id,title,created_at,updated_at) VALUES(?,?,?,?)',args:[id,title,stamp,stamp]});
   for(const phase of phases){const stage=randomUUID();await tx.execute({sql:'INSERT INTO tournament_stages(id,tournament_id,kind) VALUES(?,?,?)',args:[stage,id,phase.kind]});for(const code of phase.issues)await tx.execute({sql:'INSERT INTO stage_issues(stage_id,issue_code) VALUES(?,?)',args:[stage,code]});}
   await tx.commit();await announceEligibleTournaments(c);return send(res,201,{ok:true,id});
  }catch(e){await tx.rollback();throw e}
 }
 if(action==='update'){
  const id=String(v.id||''),title=String(v.title||'').trim(),phases=v.stages;
  if(!id||!title||title.length>90||!Array.isArray(phases)||!phases.length||phases.length>2||new Set(phases.map(x=>x.kind)).size!==phases.length||phases.some(p=>!['qualifier','final'].includes(p.kind)||!validStageIssues(p.issues)))fail(400,'大会設定を確認してください。');
  const codes=phases.flatMap(p=>p.issues);
  if(codes.some((a,i)=>codes.slice(i+1).some(b=>overlapsMagazineIssue(a,b))))fail(409,'予選と本戦で対象号が重複しています。');
  const tx=await c.transaction('write');
  try{
    const record=(await query(tx,'SELECT * FROM tournaments WHERE id=?',[id]))[0];
    if(!record)fail(404,'大会が見つかりません。');
    if(!record.archived_at){
      const other=await query(tx,`SELECT si.issue_code FROM stage_issues si JOIN tournament_stages s ON s.id=si.stage_id JOIN tournaments t ON t.id=s.tournament_id WHERE t.archived_at IS NULL AND t.id<>?`,[id]);
      if(codes.some(x=>other.some(y=>overlapsMagazineIssue(x,y.issue_code))))fail(409,'別の開催中の大会と対象号が重複しています。');
    }
    const previous=await query(tx,'SELECT id,kind FROM tournament_stages WHERE tournament_id=?',[id]);
    const removed=previous.filter(p=>!phases.some(x=>x.kind===p.kind));
    if(removed.length&&!v.confirmStageRemoval)fail(409,'予選・本戦の削除には確認が必要です。');
    // Keep IDs and enrolled users for stages retained during range changes.
    for(const phase of phases){
      const old=previous.find(x=>x.kind===phase.kind),stage=old?.id||randomUUID();
      if(!old)await tx.execute({sql:'INSERT INTO tournament_stages(id,tournament_id,kind) VALUES(?,?,?)',args:[stage,id,phase.kind]});
      else await tx.execute({sql:'DELETE FROM stage_issues WHERE stage_id=?',args:[stage]});
      for(const issue of phase.issues)await tx.execute({sql:'INSERT INTO stage_issues(stage_id,issue_code) VALUES(?,?)',args:[stage,issue]});
    }
    for(const old of removed){
      await tx.execute({sql:'DELETE FROM stage_participants WHERE stage_id=?',args:[old.id]});
      await tx.execute({sql:'DELETE FROM stage_issues WHERE stage_id=?',args:[old.id]});
      await tx.execute({sql:'DELETE FROM tournament_stages WHERE id=?',args:[old.id]});
    }
    await tx.execute({sql:'UPDATE tournaments SET title=?,updated_at=? WHERE id=?',args:[title,now(),id]});
    await tx.commit();
    // Published contests stay published; future announcements are evaluated normally.
    await announceEligibleTournaments(c);
    return send(res,200,{ok:true,id});
  }catch(e){await tx.rollback();throw e}
 }
 if(action==='enroll'||action==='remove'){
  if(action==='remove' && v.confirmed!==true)fail(400,'参加者の除外内容を確認してください。');
  const stage=(await query(c,'SELECT * FROM tournament_stages WHERE id=?',[v.stageId]))[0];
  if(!stage)fail(404,'大会区分がありません。');
  const target=(await query(c,'SELECT id FROM users WHERE id=?',[v.userId]))[0];if(!target)fail(404,'ユーザーがありません。');
  const tx=await c.transaction('write');try{
   if(action==='remove')await tx.execute({sql:'DELETE FROM stage_participants WHERE stage_id=? AND user_id=?',args:[stage.id,target.id]});
   else await tx.execute({sql:`INSERT OR IGNORE INTO stage_participants(stage_id,user_id,joined_at,enrollment_source) VALUES(?,?,?,'admin')`,args:[stage.id,target.id,now()]});
   if(stage.kind==='final'&&!stage.finalists_announced_at)await tx.execute({sql:'UPDATE tournament_stages SET finalists_saved_at=NULL WHERE id=?',args:[stage.id]});
   await tx.commit();
  }catch(e){await tx.rollback();throw e}
  return send(res,200,{ok:true});
 }
 if(action==='saveFinal'||action==='publishFinal'){
  const stage=(await query(c,'SELECT * FROM tournament_stages WHERE id=? AND kind=\'final\'',[v.stageId]))[0];if(!stage)fail(404,'本戦がありません。');
  if(action==='saveFinal'){
   const ids=v.userIds;if(!Array.isArray(ids)||ids.length>500||ids.some(x=>typeof x!=='string')||new Set(ids).size!==ids.length)fail(400,'選択ユーザーの指定が不正です。');
   const known=ids.length?await query(c,`SELECT id FROM users WHERE id IN (${ids.map(()=>'?').join(',')})`,ids):[];
   if(known.length!==ids.length)fail(404,'存在しないユーザーが含まれています。');
   const tx=await c.transaction('write');try{await tx.execute({sql:'DELETE FROM stage_participants WHERE stage_id=?',args:[stage.id]});for(const id of ids)await tx.execute({sql:`INSERT INTO stage_participants(stage_id,user_id,joined_at,enrollment_source) VALUES(?,?,?,'finalist_selection')`,args:[stage.id,id,now()]});await tx.execute({sql:'UPDATE tournament_stages SET finalists_saved_at=? WHERE id=?',args:[now(),stage.id]});await tx.commit()}catch(e){await tx.rollback();throw e}
   return send(res,200,{ok:true,saved:ids.length});
  }
  if(!v.confirmed)fail(400,'発表内容を確認してください。');
  if(!stage.finalists_saved_at)fail(409,'本戦進出者の選択内容を先に保存してください。');
  const count=(await query(c,'SELECT COUNT(*) AS n FROM stage_participants WHERE stage_id=?',[stage.id]))[0].n;
  if(!count)fail(409,'進出者を保存してから発表してください。');
  await c.execute({sql:'UPDATE tournament_stages SET finalists_announced_at=COALESCE(finalists_announced_at,?) WHERE id=?',args:[now(),stage.id]});
  return send(res,200,{ok:true,count});
 }
 if(action==='archive'||action==='restore'){
  const id=String(v.id||'');
  const tx=await c.transaction('write');try{
    const present=(await query(tx,'SELECT id,archived_at FROM tournaments WHERE id=?',[id]))[0];
    if(!present)fail(404,'大会が見つかりません。');
    if(action==='restore'){
      const thisCodes=await query(tx,`SELECT si.issue_code FROM stage_issues si JOIN tournament_stages s ON s.id=si.stage_id WHERE s.tournament_id=?`,[id]);
      const used=await query(tx,`SELECT si.issue_code FROM stage_issues si JOIN tournament_stages s ON s.id=si.stage_id JOIN tournaments t ON t.id=s.tournament_id WHERE t.id<>? AND t.archived_at IS NULL`,[id]);
      if(thisCodes.some(x=>used.some(y=>overlapsMagazineIssue(x.issue_code,y.issue_code))))fail(409,'復元すると別の大会と対象号が重複します。');
    }
    await tx.execute({sql:'UPDATE tournaments SET archived_at=?,updated_at=? WHERE id=?',args:[action==='archive'?now():null,now(),id]});
    await tx.commit();return send(res,200,{ok:true});
  }catch(e){await tx.rollback();throw e}
 }
 fail(400,'不明な大会操作です。');
})}
