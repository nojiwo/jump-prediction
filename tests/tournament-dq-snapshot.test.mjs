import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {__setTestDb} from '../server/db.js';
import {stageStandings} from '../server/tournaments.js';
import proxyPrediction from '../api/admin/proxy-prediction.js';

const TS='2026-09-01T00:00:00.000Z';
const weeks=[
 ['20264000','2026-10-05T00:00:00.000Z'],
 ['20264100','2026-10-12T00:00:00.000Z'],
 ['20264200','2026-10-19T00:00:00.000Z'],
 ['20264300','2026-10-26T00:00:00.000Z']
];
function createFixture({successor=true,third=false}={}){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const f of ['001_initial.sql','002_appearance.sql','003_final_selection.sql'])sqlite.exec(readFileSync(new URL(`../migrations/${f}`,import.meta.url),'utf8'));
 const execute=async x=>{
  const {sql,args=[]}=typeof x==='string'?{sql:x}:x;
  const stmt=sqlite.prepare(sql);
  if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {rows:stmt.all(...args)};
  const r=stmt.run(...args);return {rows:[],rowsAffected:r.changes,changes:r.changes};
 };
 const c={execute,async transaction(){sqlite.exec('BEGIN IMMEDIATE');return {execute,async commit(){sqlite.exec('COMMIT')},async rollback(){sqlite.exec('ROLLBACK')}}}};
 __setTestDb(c);
 for(const [id,username,role] of [['admin','admin','owner'],['u1','alpha','user'],['u2','beta','user'],['u3','gamma','user'],['u4','delta','user']]){
  sqlite.prepare('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,username,'hash',role,TS,TS);
 }
 const token='a'.repeat(64);
 sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),'admin','2099-01-01T00:00:00Z',TS);
 for(const [i,[code,release]] of weeks.entries()){
  if(i===1&&!successor||i>=2&&!third)continue;
  const confirmed=i===0?'2026-10-06T00:00:00.000Z':i===1?'2026-10-13T00:00:00.000Z':null;
  const publicAt=i===0?'2026-10-12T00:00:00.000Z':i===1?'2026-10-19T00:00:00.000Z':null;
  sqlite.prepare(`INSERT INTO issues(code,release_at,cutoff_at,status,scores_confirmed_at,results_published_at,created_at,updated_at)
   VALUES(?,?,?,'closed',?,?,?,?)`).run(code,release,'2026-10-01T00:00:00.000Z',confirmed,publicAt,TS,TS);
 }
 sqlite.prepare('INSERT INTO tournaments(id,title,announced_at,created_at,updated_at) VALUES(?,?,?,?,?)').run('t','Test','2026-09-30T00:00:00.000Z',TS,TS);
 sqlite.prepare("INSERT INTO tournament_stages(id,tournament_id,kind) VALUES('s','t','qualifier')").run();
 for(const [code] of weeks.slice(0,2))sqlite.prepare('INSERT INTO stage_issues(stage_id,issue_code) VALUES(?,?)').run('s',code);
 for(const id of ['u1','u2','u3','u4'])sqlite.prepare("INSERT INTO stage_participants(stage_id,user_id,joined_at,enrollment_source) VALUES('s',?,?,'admin')").run(id,TS);
 const scores=[['20264000','u1',4],['20264000','u2',4],['20264000','u3',8],['20264100','u1',2],['20264100','u2',2]];
 for(const [issue,id,total] of scores){if(issue==='20264100'&&!successor)continue;
 sqlite.prepare('INSERT INTO issue_scores(issue_code,user_id,total_error,place,calculated_at) VALUES(?,?,?,?,?)').run(issue,id,total,1,TS)}
 const submit=(id,code,order=null)=>{
  const p=`prediction:${code}:${id}`;
  sqlite.prepare('INSERT INTO predictions(id,issue_code,user_id,first_submitted_at,last_submitted_at,last_submitted_by) VALUES(?,?,?,?,?,?)').run(p,code,id,TS,TS,id);
  if(order)order.forEach((wid,index)=>sqlite.prepare('INSERT INTO prediction_items(prediction_id,work_id,predicted_rank) VALUES(?,?,?)').run(p,wid,index+1));
 };
 submit('u1','20264000');submit('u2','20264000');submit('u3','20264000');
 if(successor)submit('u1','20264100');
 return {sqlite,c,submit,token};
}
const find=(standing,id)=>standing.rows.find(r=>r.user_id===id);

test('missing the selected last contest issue causes DQ at successor release, not at its own release',async()=>{
 const {sqlite,c}=createFixture();
 const before=await stageStandings(c,'s',{admin:true,asOf:'20264000',at:'2026-10-11T23:59:59.999Z'});
 assert.deepEqual(before.availableAsOf,['20264000']);
 assert.equal(find(before,'u4').disqualified,false);
 const atRelease=await stageStandings(c,'s',{admin:true,asOf:'20264000',at:'2026-10-12T00:00:00.000Z'});
 assert.equal(find(atRelease,'u4').disqualified,true);
 assert.deepEqual(find(atRelease,'u4').missingIssues,['20264000']);
 assert.equal(find(atRelease,'u4').place,null);
 assert.equal(find(atRelease,'u3').disqualified,false);
 assert.equal(find(atRelease,'u1').place,1);
 assert.equal(find(atRelease,'u2').place,1);
 sqlite.close();
});

test('future contest issue missing submissions never affect an earlier as-of ranking, and past proxy submission reverses DQ',async()=>{
 const {sqlite,c,submit}=createFixture({third:true});
 const date='2026-10-20T00:00:00.000Z';
 const historical=await stageStandings(c,'s',{admin:false,asOf:'20264000',at:date});
 assert.deepEqual(historical.codes,['20264000']);
 assert.equal(find(historical,'u3').disqualified,false); // 41 is absent but outside snapshot
 const current=await stageStandings(c,'s',{admin:false,asOf:'20264100',at:date});
 assert.equal(find(current,'u3').disqualified,true);
 assert.deepEqual(find(current,'u3').missingIssues,['20264100']);
 assert.equal(find(current,'u2').disqualified,true);
 assert.equal(find(current,'u1').disqualified,false);
 // Admin inserts a late formal prediction. Scoring data is live and DQ is derived,
 // rather than permanently written to a separate disqualification table.
 submit('u3','20264100');
 const corrected=await stageStandings(c,'s',{admin:false,asOf:'20264100',at:date});
 assert.equal(find(corrected,'u3').disqualified,false);
 assert.equal(find(corrected,'u2').disqualified,true);
 assert.deepEqual(find(corrected,'u3').missingIssues,[]);
 sqlite.close();
});

test('public cannot access unannounced future score snapshots and defaults to latest published issue',async()=>{
 const {sqlite,c}=createFixture();
 const early=await stageStandings(c,'s',{admin:false,at:'2026-10-12T00:00:00.000Z'});
 assert.equal(early.asOf,'20264000');
 assert.deepEqual(early.availableAsOf,['20264000']);
 await assert.rejects(stageStandings(c,'s',{admin:false,asOf:'20264100',at:'2026-10-12T00:00:00.000Z'}),e=>e.status===403);
 const after=await stageStandings(c,'s',{admin:false,at:'2026-10-19T00:00:00.000Z'});
 assert.equal(after.asOf,'20264100');
 assert.deepEqual(after.availableAsOf,['20264000','20264100']);
 sqlite.close();
});

test('no registered next issue means no DQ even when the predicted next release date has passed',async()=>{
 const {sqlite,c}=createFixture({successor:false});
 const before=await stageStandings(c,'s',{admin:true,at:'2026-10-31T00:00:00.000Z'});
 assert.equal(before.asOf,'20264000');
 assert.equal(find(before,'u4').disqualified,false);
 // Late successor registration is sufficient to trigger a DQ in a subsequent read.
 sqlite.prepare(`INSERT INTO issues(code,release_at,cutoff_at,status,created_at,updated_at) VALUES(?,?,?,'closed',?,?)`).run('20264100','2026-10-12T00:00:00.000Z','2026-10-08T00:00:00.000Z',TS,TS);
 const after=await stageStandings(c,'s',{admin:true,at:'2026-10-31T00:00:00.000Z'});
 assert.equal(find(after,'u4').disqualified,true);
 sqlite.close();
});

test('DQ contestants are sorted after qualified users by earned points, then stable user ID; qualified ties skip ranks',async()=>{
 const {sqlite,c}=createFixture({third:true});
 const res=await stageStandings(c,'s',{admin:false,asOf:'20264100',at:'2026-10-20T00:00:00.000Z'});
 assert.deepEqual(res.rows.map(r=>r.user_id),['u1','u2','u3','u4']);
 assert.equal(find(res,'u1').place,1);
 assert.equal(find(res,'u2').disqualified,true);
 assert.equal(find(res,'u3').disqualified,true);
 assert.equal(find(res,'u4').disqualified,true);
 assert.equal(find(res,'u4').total,null);
 sqlite.close();
});

test('actual administrator proxy submission after cutoff reverses DQ and recalculates issue scores',async()=>{
 const {sqlite,c,token}=createFixture({third:true});
 const issue='20264100';
 // Two eligible works, both frozen at prediction intake. The initial formal
 // prediction of alpha is completed so the recalculation can score every user.
 for(const id of ['0001','0002'])sqlite.prepare('INSERT INTO works(id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?)')
  .run(id,`Title ${id}`,'serial',TS,TS);
 for(const [i,id] of ['0001','0002'].entries()){
  sqlite.prepare('INSERT INTO issue_frozen_works(issue_code,work_id,initial_position,color) VALUES(?,?,?,?)')
   .run(issue,id,i+1,'none');
  sqlite.prepare('INSERT INTO actual_order_items(issue_code,work_id,actual_rank) VALUES(?,?,?)')
   .run(issue,id,i+1);
  sqlite.prepare('INSERT INTO prediction_items(prediction_id,work_id,predicted_rank) VALUES(?,?,?)')
   .run(`prediction:${issue}:u1`,id,i+1);
 }
 const date='2026-10-20T00:00:00.000Z';
 let standing=await stageStandings(c,'s',{admin:false,asOf:issue,at:date});
 assert.equal(find(standing,'u2').disqualified,true);
 let result=await new Promise((resolve,reject)=>{
  const req={method:'POST',url:'/api/admin/proxy-prediction',body:{issue,username:'beta',order:['0002','0001']},headers:{host:'localhost',origin:'http://localhost',cookie:`jump_session=${token}`}};
  const res={statusCode:200,setHeader(){},end(payload){resolve({status:this.statusCode,body:JSON.parse(payload)})}};
  Promise.resolve(proxyPrediction(req,res)).catch(reject);
 });
 assert.equal(result.status,200,JSON.stringify(result.body));
 assert.equal(result.body.recalculatedUsers,2);
 const rec=sqlite.prepare('SELECT total_error FROM issue_scores WHERE issue_code=? AND user_id=?').get(issue,'u2');
 assert.equal(rec.total_error,2);
 standing=await stageStandings(c,'s',{admin:false,asOf:issue,at:date});
 assert.equal(find(standing,'u2').disqualified,false);
 assert.equal(find(standing,'u2').total,6); // 4 points from 40 + 2 from corrected 41
 assert.equal(find(standing,'u3').disqualified,true);
 sqlite.close();
});

test('a later submitted issue does not award points after an earlier DQ; row retains 未提出 marker',async()=>{
 const {sqlite,c,submit}=createFixture({third:true});
 submit('u4','20264100');
 sqlite.prepare('INSERT INTO issue_scores(issue_code,user_id,total_error,place,calculated_at) VALUES(?,?,?,?,?)').run('20264100','u4',12,4,TS);
 const result=await stageStandings(c,'s',{admin:false,asOf:'20264100',at:'2026-10-20T00:00:00.000Z'});
 const row=find(result,'u4');
 assert.equal(row.disqualified,true);
 assert.equal(row.disqualificationIssue,'20264000');
 assert.deepEqual(row.unsubmittedIssues,['20264000']);
 assert.equal(row.cells['20264000'],null);
 assert.equal(row.cells['20264100'],null); // later earned score must not appear after DQ
 assert.equal(row.total,null);
 sqlite.close();
});
