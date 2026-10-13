import {now,fail} from './http.js';
import {isConsecutiveIssue,issueParts} from './results.js';

const query=async(c,sql,args=[]) => (await c.execute({sql,args})).rows;
const unique=a=>Array.isArray(a)&&new Set(a).size===a.length;
export function validStageIssues(value){return Array.isArray(value)&&value.length>0&&value.length<=65&&unique(value)&&value.every(x=>{try{issueParts(x);return true}catch{return false}});}
export function overlapsMagazineIssue(a,b){const x=issueParts(a),y=issueParts(b);return x.year===y.year&&x.first<=y.end&&y.first<=x.end;}

/** Announce a competition when the *immediately preceding* magazine issue is known and released.
 * Idempotent, including late registration of the predecessor.
 */
export async function announceEligibleTournaments(c,at=now()){
 const issues=await query(c,'SELECT code,release_at FROM issues ORDER BY code');
 const competitions=await query(c,`SELECT t.id,MIN(si.issue_code) AS first_issue FROM tournaments t
 JOIN tournament_stages s ON s.tournament_id=t.id JOIN stage_issues si ON si.stage_id=s.id
 WHERE t.announced_at IS NULL AND t.archived_at IS NULL GROUP BY t.id`);
 const announced=[];
 for(const t of competitions){
  const predecessors=issues.filter(x=>x.code<t.first_issue);
  const prev=predecessors.at(-1);
  if(!prev||!isConsecutiveIssue(prev.code,t.first_issue)||Date.parse(prev.release_at)>Date.parse(at))continue;
  const r=await c.execute({sql:'UPDATE tournaments SET announced_at=?,updated_at=? WHERE id=? AND announced_at IS NULL',args:[at,at,t.id]});
  if(Number(r.rowsAffected??r.changes??0))announced.push(t.id);
 }
 return announced;
}
export async function tournamentDetail(c,id,admin=false){
 const t=(await query(c,'SELECT * FROM tournaments WHERE id=?',[id]))[0];
 if(!t||(!admin&&(!t.announced_at||t.archived_at)))fail(404,'大会がありません。');
 const stages=await query(c,'SELECT * FROM tournament_stages WHERE tournament_id=? ORDER BY CASE kind WHEN \'qualifier\' THEN 0 ELSE 1 END',[id]);
 for(const s of stages){
  // Do not disclose final stage ID, issues or enrolment before final announcement.
  if(!admin && s.kind==='final' && !s.finalists_announced_at)continue;
  s.issues=(await query(c,'SELECT issue_code FROM stage_issues WHERE stage_id=? ORDER BY issue_code',[s.id])).map(r=>r.issue_code);
  if(admin || s.kind==='qualifier'||s.finalists_announced_at){s.participants=await query(c,'SELECT p.user_id,u.username,p.joined_at FROM stage_participants p JOIN users u ON u.id=p.user_id WHERE p.stage_id=? ORDER BY p.joined_at,p.user_id',[s.id]);}
  else delete s.participants;
 }
 return {tournament:t,stages:admin?stages:stages.filter(s=>s.kind!=='final'||s.finalists_announced_at)};
}
/** Standings compute live from corrected issue scores and formal submissions.
 * Disqualification is determined as of the selected issue, never by future events.
 * Only publicly released issue scores are included for non-admin readers.
 */
export async function stageStandings(c,stageId,{admin=false,asOf=null,at=now()}={}){
 const stage=(await query(c,`SELECT s.*,t.title,t.announced_at,t.archived_at FROM tournament_stages s
 JOIN tournaments t ON t.id=s.tournament_id WHERE s.id=?`,[stageId]))[0];
 if(!stage||(!admin&&(!stage.announced_at||stage.archived_at||stage.kind==='final'&&!stage.finalists_announced_at)))fail(404,'大会成績は公開されていません。');
 const codes=(await query(c,'SELECT issue_code FROM stage_issues WHERE stage_id=? ORDER BY issue_code',[stageId])).map(r=>r.issue_code);
 if(!codes.length)return {stage:stage.kind,codes:[],availableAsOf:[],asOf:null,rows:[]};
 if(asOf && !codes.includes(asOf))fail(400,'指定した集計時点は大会対象外です。');
 const issueRows=await query(c,'SELECT code,release_at,results_published_at,scores_confirmed_at FROM issues ORDER BY code');
 const issueMap=new Map(issueRows.map(x=>[x.code,x]));
 const atMillis=Date.parse(at);
 if(!Number.isFinite(atMillis))throw new TypeError('invalid snapshot timestamp');
 // Normal readers can see only published scores. Admins may inspect confirmed,
 // still-unpublished scores; incomplete input must never become a score column.
 const availableAsOf=codes.filter(code=>{
  const issue=issueMap.get(code);
  if(!issue)return false;
  const moment=admin?issue.scores_confirmed_at:issue.results_published_at;
  return Boolean(moment)&&Date.parse(moment)<=atMillis;
 });
 if(asOf&&!admin&&!availableAsOf.includes(asOf))fail(403,'未公開の号は集計対象にできません。');
 const cutoff=asOf||availableAsOf.at(-1)||null;
 // The selection represents an issue-wise cumulative snapshot. It does not
 // include future contest issues, even if their submissions are missing today.
 const included=cutoff?codes.filter(code=>code<=cutoff):[];
 const ppl=await query(c,'SELECT p.user_id,u.username,p.joined_at FROM stage_participants p JOIN users u ON u.id=p.user_id WHERE p.stage_id=? ORDER BY p.joined_at,p.user_id',[stageId]);
 if(!included.length)return {stage:stage.kind,codes:[],availableAsOf,asOf:null,
  rows:ppl.map(u=>({user_id:u.user_id,username:u.username,cells:{},total:null,disqualified:false,missingIssues:[],unsubmittedIssues:[],disqualificationIssue:null,place:null}))};
 const submissions=await query(c,`SELECT issue_code,user_id FROM predictions WHERE issue_code IN (${included.map(()=>'?').join(',')})`,included);
 const submitted=new Set(submissions.map(x=>`${x.issue_code}/${x.user_id}`));
 const released=included.filter(code=>availableAsOf.includes(code));
 const scoreRows=released.length?await query(c,`SELECT issue_code,user_id,total_error FROM issue_scores WHERE issue_code IN (${released.map(()=>'?').join(',')})`,released):[];
 const scoreMap=new Map(scoreRows.map(x=>[`${x.issue_code}/${x.user_id}`,Number(x.total_error)]));
 // An issue's missing prediction becomes a DQ only at its immediate magazine
 // successor's release at 00:00 JST (stored as an absolute UTC timestamp).
 // This includes the selected final contest issue once its next issue releases;
 // comparing to the *selected issue's own* release date would miss that DQ.
 const successorReleased=new Set();
 for(const code of included){
  const idx=issueRows.findIndex(x=>x.code===code);
  const successor=idx<0?null:issueRows[idx+1];
  if(successor&&isConsecutiveIssue(code,successor.code)&&Date.parse(successor.release_at)<=atMillis){
   successorReleased.add(code);
  }
 }
 const rows=ppl.map(u=>{
  const cells={};let total=0,hasScore=false;
  const missingIssues=[],unsubmittedIssues=[];
  const disqualificationIssue=included.find(code=>
   !submitted.has(`${code}/${u.user_id}`)&&successorReleased.has(code))||null;
  for(const code of included){
   // After the first disqualifying omission, later contest issues are shown
   // as dashes and contribute nothing to the earned total, even if submitted.
   if(disqualificationIssue&&code>disqualificationIssue){cells[code]=null;continue;}
   const key=`${code}/${u.user_id}`,formal=submitted.has(key);
   const score=formal?scoreMap.get(key):undefined;
   cells[code]=score===undefined?null:score;
   if(!formal){unsubmittedIssues.push(code);if(successorReleased.has(code))missingIssues.push(code);}
   if(score!==undefined){total+=score;hasScore=true;}
  }
  return {user_id:u.user_id,username:u.username,cells,total:hasScore?total:null,
   disqualified:!!disqualificationIssue,disqualificationIssue,missingIssues,unsubmittedIssues,place:null};
 });
 // Active participants lead; DQed participants follow in earned-score order,
 // with a stable user ID tie-breaker. DQed users do not have a public rank.
 rows.sort((a,b)=>Number(a.disqualified)-Number(b.disqualified)||(a.total??Infinity)-(b.total??Infinity)||a.user_id.localeCompare(b.user_id));
 let previousTotal=null,previousPlace=null;
 rows.forEach((r,i)=>{
  if(r.disqualified||r.total===null)return;
  r.place=previousTotal===r.total?previousPlace:i+1;
  previousTotal=r.total;previousPlace=r.place;
 });
 return {stage:stage.kind,codes:included,availableAsOf,asOf:cutoff,rows};
}

/** Return the three candidate groups in admin selection order. The same user can be
 * present in the previous finalists and the current qualifier; UI uses shared IDs.
 * A final stage never exposes its unpublished entrants through public APIs.
 */
export async function finalCandidateGroups(c,finalStageId){
 const target=(await query(c,`SELECT s.id,s.tournament_id,s.kind FROM tournament_stages s WHERE s.id=?`,[finalStageId]))[0];
 if(!target||target.kind!=='final')fail(404,'本戦がありません。');
 const qualifier=(await query(c,`SELECT id FROM tournament_stages WHERE tournament_id=? AND kind='qualifier'`,[target.tournament_id]))[0];
 const tournaments=await query(c,`SELECT t.id, MIN(si.issue_code) AS first_code FROM tournaments t
 JOIN tournament_stages st ON st.tournament_id=t.id JOIN stage_issues si ON si.stage_id=st.id
 GROUP BY t.id`);
 const current=tournaments.find(x=>x.id===target.tournament_id);
 const previous=tournaments.filter(x=>x.id!==target.tournament_id&&current&&x.first_code<current.first_code)
  .sort((a,b)=>b.first_code.localeCompare(a.first_code))[0];
 const priorFinal=previous?(await query(c,`SELECT id FROM tournament_stages WHERE tournament_id=? AND kind='final'`,[previous.id]))[0]:null;
 const priorRows=priorFinal?(await stageStandings(c,priorFinal.id,{admin:true})).rows:[];
 const qualifierRows=qualifier?(await stageStandings(c,qualifier.id,{admin:true})).rows:[];
 // Membership comes from the stage itself even if rankings are not yet available.
 const members=async(stageId)=>stageId?await query(c,`SELECT p.user_id,u.username FROM stage_participants p JOIN users u ON u.id=p.user_id WHERE p.stage_id=? ORDER BY p.joined_at,p.user_id`,[stageId]):[];
 const ordered=(rows,participants)=>{
  const byId=new Map(participants.map(p=>[p.user_id,p]));const placed=new Set();const data=[];
  for(const r of rows){if(byId.has(r.user_id)){data.push({id:r.user_id,username:r.username,rank:r.place});placed.add(r.user_id)}}
  for(const p of participants){if(!placed.has(p.user_id))data.push({id:p.user_id,username:p.username,rank:null})}
  return data;
 };
 const first=ordered(priorRows,await members(priorFinal?.id));
 const second=ordered(qualifierRows,await members(qualifier?.id));
 const seen=new Set([...first,...second].map(x=>x.id));
 const all=await query(c,'SELECT id,username FROM users ORDER BY username COLLATE NOCASE,id');
 return {groups:[
  {key:'previous',label:'前回大会の本戦参加者',users:first},
  {key:'qualifier',label:'今大会の予選参加者',users:second},
  {key:'other',label:'その他のユーザー',users:all.filter(x=>!seen.has(x.id))}
 ]};
}
