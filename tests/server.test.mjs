import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {hashSecret, verifySecret} from '../server/password.js';
import {__setTestDb} from '../server/db.js';
import register from '../api/auth/register.js';
import login from '../api/auth/login.js';
import session from '../api/session.js';
import preferences from '../api/preferences.js';
import workApi from '../api/works.js';
import issueApi from '../api/issues.js';
import issueSetup from '../api/admin/issue-setup.js';
import prediction from '../api/prediction.js';

function makeAdapter(sqlite){
 function execute({sql,args=[]}){
   const trimmed=sql.trim().toUpperCase();
   const statement=sqlite.prepare(sql);
   if(trimmed.startsWith('SELECT')||trimmed.startsWith('PRAGMA')||trimmed.startsWith('WITH'))return Promise.resolve({rows:statement.all(...args)});
   return Promise.resolve({rows:[],...statement.run(...args)});
 }
 function exec(x){return typeof x==='string'?execute({sql:x}):execute(x)}
 return {execute:exec,async batch(items){sqlite.exec('BEGIN IMMEDIATE');try{for(const it of items)await exec(it);sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}},async transaction(){sqlite.exec('BEGIN IMMEDIATE');let open=true;return {execute:exec,async commit(){if(open){sqlite.exec('COMMIT');open=false}},async rollback(){if(open){sqlite.exec('ROLLBACK');open=false}}}}};
}
function invoke(handler,{method='GET',url='/api/session',json,token}={}){
 return new Promise(async(resolve,reject)=>{
  const header={host:'localhost',origin:'http://localhost'};
  if(token)header.cookie=`jump_session=${token}`;
  const req={method,url,headers:header,body:json,socket:{remoteAddress:'127.0.0.1'}};
  const res={statusCode:200,headers:{},setHeader(name,value){this.headers[name.toLowerCase()]=value},end(txt){try{resolve({status:this.statusCode,body:JSON.parse(txt),cookie:this.headers['set-cookie']})}catch(e){reject(e)}}};
  try{await handler(req,res)}catch(e){reject(e)}
 });
}

test('salted password hashing verifies and rejects wrong passwords',async()=>{
 const hash=await hashSecret('安全なpassword2026!');
 assert.ok(hash.startsWith('scrypt$'));
 assert.ok(await verifySecret('安全なpassword2026!',hash));
 assert.equal(await verifySecret('違う',hash),false);
 assert.notEqual(hash,await hashSecret('安全なpassword2026!'));
});

test('registration, sessions, role authorization, works/issues and prediction persistence',async()=>{
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));
 sqlite.exec(readFileSync(new URL('../migrations/002_appearance.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../migrations/003_final_selection.sql',import.meta.url),'utf8'));
 __setTestDb(makeAdapter(sqlite));
 const u={username:'tester',password:'long-secret-password',question1:1,question2:2,answer1:'favorite green tea',answer2:'favorite city'};
 const reg=await invoke(register,{method:'POST',json:u,url:'/api/auth/register'});
 assert.equal(reg.status,201,JSON.stringify(reg.body));
 const token=reg.cookie.match(/jump_session=([0-9a-f]{64})/)[1];
 assert.equal((await invoke(session,{token})).body.user.username,'tester');
 assert.equal((await invoke(login,{method:'POST',json:{username:'tester',password:'wrong'}})).status,401);
 assert.equal((await invoke(login,{method:'POST',json:u})).status,200);
 // No unprivileged ability to write works.
 assert.equal((await invoke(workApi,{method:'POST',token,json:{title:'Sample',kind:'serial',periods:[{start:'20260100',end:null}]}})).status,403);
 const prefs=await invoke(preferences,{method:'PATCH',token,json:{theme_mode:'dark',accent_color:'purple'}});
 assert.equal(prefs.status,200);assert.equal(prefs.body.preferences.theme_mode,'dark');
 const id=reg.body.user.id;
 sqlite.prepare('UPDATE users SET role=? WHERE id=?').run('owner',id);
 const added=await invoke(workApi,{method:'POST',token,json:{title:'連載テスト',kind:'serial',periods:[{start:'20260100',end:null}]}});
 assert.equal(added.status,200,JSON.stringify(added.body));const workid=added.body.id;
 const issue={code:'20264200',release_at:'2026-10-19T00:00:00+09:00',cutoff_at:'2026-10-15T00:00:00+09:00'};
 const issueRes=await invoke(issueApi,{method:'POST',token,json:issue});assert.equal(issueRes.status,201,JSON.stringify(issueRes.body));
 const overlapping=await invoke(issueApi,{method:'POST',token,json:{...issue,code:'20264142'}});
 assert.equal(overlapping.status,409,JSON.stringify(overlapping.body));
 const configured=await invoke(issueSetup,{method:'POST',url:'/api/admin/issue-setup',token,json:{action:'save',code:issue.code,confirmed:true,colors:[{workId:workid,color:'lead'}],plannedHiatus:[]}});
 assert.equal(configured.status,200,JSON.stringify(configured.body));
 const opened=await invoke(issueSetup,{method:'POST',url:'/api/admin/issue-setup',token,json:{action:'open',code:issue.code}});
 assert.equal(opened.status,200,JSON.stringify(opened.body));
 const d=await invoke(prediction,{method:'POST',token,json:{issue:issue.code,mode:'draft',order:[workid],inputMode:'drag'}});
 assert.equal(d.status,200,JSON.stringify(d.body));
 const submit=await invoke(prediction,{method:'POST',token,json:{issue:issue.code,mode:'submit',order:[workid]}});
 assert.equal(submit.status,200,JSON.stringify(submit.body));
 const pred=await invoke(prediction,{token,url:'/api/prediction?issue=20264200'});
 assert.deepEqual(pred.body.formal,[workid]);assert.ok(pred.body.first_submitted_at);
 const initial=pred.body.first_submitted_at;
 const resubmit=await invoke(prediction,{method:'POST',token,json:{issue:issue.code,mode:'submit',order:[workid]}});
 assert.equal(resubmit.status,200,JSON.stringify(resubmit.body));
 const pred2=await invoke(prediction,{token,url:'/api/prediction?issue=20264200'});
 assert.equal(pred2.body.first_submitted_at,initial);
 sqlite.close();
});

// Full scoring lifecycle: admin-only writes, surprise work filtering, hiatus compaction,
// preview without publication, delayed successor registration, visibility and tie-safe ranking.
test('actual order -> preview -> confirm -> late next issue -> public ranking',async()=>{
 const {randomUUID,createHash}=await import('node:crypto');
 const scoring=(await import('../api/admin/scoring.js')).default;
 const ranking=(await import('../api/rankings.js')).default;
 const compare=(await import('../api/prediction-comparison.js')).default;
 const issueHandler=(await import('../api/issues.js')).default;
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));
 sqlite.exec(readFileSync(new URL('../migrations/002_appearance.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../migrations/003_final_selection.sql',import.meta.url),'utf8'));
 __setTestDb(makeAdapter(sqlite));
 const ts='2025-01-01T00:00:00.000Z', token='a'.repeat(64), tokenUser='b'.repeat(64);
 for (const [id,username,role] of [['u1','testadmin','owner'],['u2','testuser','user']]){
  sqlite.prepare('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,username,'unused',role,ts,ts);
 }
 const hash=t=>createHash('sha256').update(t).digest('hex');
 sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hash(token),'u1','2099-01-01T00:00:00.000Z',ts);
 sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(hash(tokenUser),'u2','2099-01-01T00:00:00.000Z',ts);
 const workAdd=sqlite.prepare('INSERT INTO works(id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?)');
 for(let i=1;i<=4;i++)workAdd.run(String(i).padStart(4,'0'),`連載${i}`,'serial',ts,ts);
 workAdd.run('0099','予想対象外の読み切り','oneshot',ts,ts);
 sqlite.prepare("INSERT INTO issues(code,release_at,cutoff_at,status,created_at,updated_at) VALUES(?,?,?,'closed',?,?)").run('20260100','2025-01-06T00:00:00.000Z','2025-01-02T00:00:00.000Z',ts,ts);
 for(let i=1;i<=4;i++)sqlite.prepare('INSERT INTO issue_frozen_works(issue_code,work_id,initial_position) VALUES(?,?,?)').run('20260100',String(i).padStart(4,'0'),i);
 for(const [id,userId,guesses] of [['p1','u1',['0001','0002','0003','0004']],['p2','u2',['0004','0002','0001','0003']]]){
  sqlite.prepare('INSERT INTO predictions(id,issue_code,user_id,first_submitted_at,last_submitted_at) VALUES(?,?,?,?,?)').run(id,'20260100',userId,ts,ts);
  for(const [i,w] of guesses.entries())sqlite.prepare('INSERT INTO prediction_items(prediction_id,work_id,predicted_rank) VALUES(?,?,?)').run(id,w,i+1);
 }
 const order=['0002','0099','0001','0004'],sudden=['0003'];
 assert.equal((await invoke(scoring,{method:'POST',url:'/api/admin/scoring',token:tokenUser,json:{issue:'20260100',action:'confirm',order,suddenHiatus:sudden}})).status,403);
 const draft=await invoke(scoring,{method:'POST',url:'/api/admin/scoring',token,json:{issue:'20260100',action:'draft',order:['0001','0099']}});
 assert.equal(draft.status,200,JSON.stringify(draft.body));
 const preview=await invoke(scoring,{method:'POST',url:'/api/admin/scoring',token,json:{issue:'20260100',action:'preview',order,suddenHiatus:sudden}});
 assert.equal(preview.status,200,JSON.stringify(preview.body));
 assert.deepEqual(preview.body.scores.map(x=>x.total_error),[2,4]);
 assert.equal(sqlite.prepare('SELECT count(*) AS n FROM issue_scores').get().n,0);
 const incomplete=await invoke(scoring,{method:'POST',url:'/api/admin/scoring',token,json:{issue:'20260100',action:'confirm',order:['0001'],suddenHiatus:sudden}});
 assert.equal(incomplete.status,409,JSON.stringify(incomplete.body));
 const confirm=await invoke(scoring,{method:'POST',url:'/api/admin/scoring',token,json:{issue:'20260100',action:'confirm',order,suddenHiatus:sudden}});
 assert.equal(confirm.status,200,JSON.stringify(confirm.body));
 assert.equal(sqlite.prepare('SELECT results_published_at FROM issues WHERE code=?').get('20260100').results_published_at,null);
 const hidden=await invoke(ranking,{token:tokenUser,url:'/api/rankings?issue=20260100'});
 assert.equal(hidden.status,404);
 const compared=await invoke(compare,{token:tokenUser,url:'/api/prediction-comparison?issue=20260100'});
 assert.equal(compared.status,200);assert.equal(compared.body.participants.length,2);
 // Register later (after next issue's release): prior scores must become public now.
 const inserted=await invoke(issueHandler,{method:'POST',url:'/api/issues',token,json:{code:'20260200',release_at:'2025-01-13T00:00:00.000Z',cutoff_at:'2025-01-09T00:00:00.000Z'}});
 assert.equal(inserted.status,201,JSON.stringify(inserted.body));
 const result=await invoke(ranking,{token:tokenUser,url:'/api/rankings?issue=20260100'});
 assert.equal(result.status,200,JSON.stringify(result.body));
 assert.deepEqual(result.body.ranking.map(x=>[x.username,x.total_error,x.place]),[['testadmin',2,1],['testuser',4,2]]);
 const proxy=(await import('../api/admin/proxy-prediction.js')).default;
 const rejected=await invoke(proxy,{method:'POST',url:'/api/admin/proxy-prediction',token:tokenUser,json:{issue:'20260100',username:'testuser',order:['0001','0002','0003','0004']}});
 assert.equal(rejected.status,403);
 const corrected=await invoke(proxy,{method:'POST',url:'/api/admin/proxy-prediction',token,json:{issue:'20260100',username:'testuser',order:['0001','0002','0003','0004']}});
 assert.equal(corrected.status,200,JSON.stringify(corrected.body));
 assert.equal(corrected.body.recalculatedUsers,2);
 const afterCorrection=await invoke(ranking,{token:tokenUser,url:'/api/rankings?issue=20260100'});
 assert.equal(afterCorrection.status,200);
 assert.deepEqual(afterCorrection.body.ranking.map(x=>x.place),[1,1]);
 const oldDate=sqlite.prepare('SELECT results_published_at FROM issues WHERE code=?').get('20260100').results_published_at;
 assert.ok(oldDate);
 await invoke(ranking,{token:tokenUser,url:'/api/rankings?issue=20260100'});
 assert.equal(sqlite.prepare('SELECT results_published_at FROM issues WHERE code=?').get('20260100').results_published_at,oldDate);
 sqlite.close();
});
