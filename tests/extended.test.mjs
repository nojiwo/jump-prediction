import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {__setTestDb} from '../server/db.js';
import tournaments from '../api/tournaments.js';
import announcements from '../api/announcements.js';
import notifications from '../api/notifications.js';
import inquiries from '../api/inquiries.js';
import {announceEligibleTournaments,stageStandings} from '../server/tournaments.js';
import {sendCutoffReminders,purgeExpired} from '../server/notifications.js';

function adapter(sqlite){
 async function exec(x){let {sql,args=[]}=typeof x==='string'?{sql:x}:x;const st=sqlite.prepare(sql);if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {rows:st.all(...args)};let r=st.run(...args);return {rows:[],rowsAffected:r.changes,changes:r.changes};}
 return {execute:exec,async transaction(){sqlite.exec('BEGIN IMMEDIATE');return {execute:exec,async commit(){sqlite.exec('COMMIT')},async rollback(){sqlite.exec('ROLLBACK')}}},async batch(items){sqlite.exec('BEGIN IMMEDIATE');try{for(const x of items)await exec(x);sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}}};
}
async function invoke(handler,method='GET',url='/',token,body){
 return await new Promise((resolve,reject)=>{
 const req={method,url,body,headers:{host:'localhost',origin:'http://localhost',cookie:token?`jump_session=${token}`:''},socket:{remoteAddress:'127.0.0.1'}};
 const res={statusCode:200,setHeader(){},end(x){try{resolve({status:this.statusCode,json:JSON.parse(x)})}catch(e){reject(e)}}};
 Promise.resolve(handler(req,res)).catch(reject);
 });
}
function setup(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 sqlite.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));
 sqlite.exec(readFileSync(new URL('../migrations/002_appearance.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../migrations/003_final_selection.sql',import.meta.url),'utf8'));
 const c=adapter(sqlite);__setTestDb(c);
 const ts='2025-01-01T00:00:00Z';
 const people=[['u1','owner','owner','a'.repeat(64)],['u2','participant','user','b'.repeat(64)],['u3','absent','user','c'.repeat(64)]];
 for(const [id,name,role,token] of people){
  sqlite.prepare('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,name,'not-a-real-password',role,ts,ts);
  sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,'2099-01-01T00:00:00Z',ts);
 }
 return {sqlite,c,owner:'a'.repeat(64),regular:'b'.repeat(64),other:'c'.repeat(64),ts};
}

test('late predecessor registration announces tournaments with unregistered future stage issue',async()=>{
 const {sqlite,c,owner,regular,ts}=setup();
 const created=await invoke(tournaments,'POST','/api/tournaments',owner,{action:'create',title:'第1回大会',stages:[{kind:'qualifier',issues:['20264200','20264300']},{kind:'final',issues:['20264400']}]});
 assert.equal(created.status,201,JSON.stringify(created.json));
 const id=created.json.id;
 assert.equal((await invoke(tournaments,'GET','/api/tournaments',regular)).json.tournaments.length,0);
 sqlite.prepare("INSERT INTO issues(code,release_at,cutoff_at,status,created_at,updated_at) VALUES(?,?,?,'closed',?,?)").run('20264100','2025-01-06T00:00:00.000Z','2025-01-02T00:00:00.000Z',ts,ts);
 assert.deepEqual(await announceEligibleTournaments(c),[id]);
 assert.deepEqual(await announceEligibleTournaments(c),[]);
 const result=(await invoke(tournaments,'GET','/api/tournaments',regular));assert.equal(result.json.tournaments.length,1);
 const detail=await invoke(tournaments,'GET',`/api/tournaments?id=${id}`,regular);
 assert.equal(detail.status,200);assert.equal(detail.json.stages.some(s=>s.kind==='final'),false);
 sqlite.close();
});

test('qualified entrant enrolment deadline and DQ only after immediate successor release',async()=>{
 const {sqlite,c,owner,regular,ts}=setup();
 const create=await invoke(tournaments,'POST','/',owner,{action:'create',title:'第2回大会',stages:[{kind:'qualifier',issues:['20260200','20260300']}]});
 const id=create.json.id;let stage=(await invoke(tournaments,'GET',`/?id=${id}`,owner)).json.stages[0];
 const stmt=sqlite.prepare("INSERT INTO issues(code,release_at,cutoff_at,status,created_at,updated_at) VALUES(?,?,?,'closed',?,?)");
 stmt.run('20260100','2025-01-01T00:00:00Z','2024-12-28T00:00:00Z',ts,ts);
 stmt.run('20260200','2098-01-01T00:00:00Z','2097-12-30T00:00:00Z',ts,ts);
 await announceEligibleTournaments(c);
 assert.equal((await invoke(tournaments,'POST','/',regular,{action:'join',stageId:stage.id})).status,200);
 assert.equal((await invoke(tournaments,'POST','/',owner,{action:'enroll',stageId:stage.id,userId:'u3'})).status,200);
 const preliminary=await stageStandings(c,stage.id,{asOf:'20260200',admin:true});
 assert.equal(preliminary.rows.length,2);assert.equal(preliminary.rows.find(x=>x.user_id==='u3').disqualified,false);
 // A successor launch causes DQ, and only after as-of progresses to issue 3.
 stmt.run('20260300','2025-02-01T00:00:00Z','2025-01-28T00:00:00Z',ts,ts);
 const later=await stageStandings(c,stage.id,{asOf:'20260300',admin:true});
 assert.equal(later.rows.find(x=>x.user_id==='u3').disqualified,true);
 sqlite.close();
});

test('important pinned notification fires only once after both public and pinned; user privacy',async()=>{
 const {sqlite,c,owner,regular,ts}=setup();
 const draft=await invoke(announcements,'POST','/',owner,{title:'お知らせ',body:'本文',status:'draft',pinned:true});
 assert.equal(draft.status,200);const id=draft.json.id;
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM notifications').get().n,0);
 const pub=await invoke(announcements,'POST','/',owner,{id,title:'お知らせ',body:'本文',status:'published',pinned:true});
 assert.equal(pub.json.notified,true);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM notifications').get().n,3);
 const repeat=await invoke(announcements,'POST','/',owner,{id,title:'お知らせ',body:'本文',status:'published',pinned:true});
 assert.equal(repeat.json.notified,false);
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM notifications').get().n,3);
 const list=await invoke(notifications,'GET','/',regular);assert.equal(list.json.notifications.length,1);
 assert.equal((await invoke(notifications,'POST','/',regular,{action:'readAll'})).status,200);
 assert.ok((await invoke(notifications,'GET','/',regular)).json.notifications[0].read_at);
 assert.equal((await invoke(announcements,'POST','/',regular,{title:'spoof',status:'published'})).status,403);
 sqlite.close();
});

test('inquiry messages are private and replies reopen completed thread',async()=>{
 const {sqlite,owner,regular,other}=setup();
 const created=await invoke(inquiries,'POST','/',regular,{action:'create',title:'質問',message:'教えてください'});
 assert.equal(created.status,201,JSON.stringify(created.json));
 const id=created.json.id;
 assert.equal((await invoke(inquiries,'GET',`/?id=${id}`,other)).status,404);
 assert.equal((await invoke(inquiries,'POST','/',owner,{action:'reply',id,message:'可能です'})).status,200);
 assert.equal((await invoke(inquiries,'POST','/',owner,{action:'status',id,status:'done'})).status,200);
 assert.equal((await invoke(inquiries,'POST','/',regular,{action:'reply',id,message:'追加質問'})).status,200);
 const thread=(await invoke(inquiries,'GET',`/?id=${id}`,regular)).json;
 assert.equal(thread.inquiry.status,'in_progress');assert.equal(thread.messages.length,3);
 sqlite.close();
});

test('missing-submission reminder idempotence and 30-day expiration',async()=>{
 const {sqlite,c,ts}=setup();
 sqlite.prepare("INSERT INTO issues(code,release_at,cutoff_at,status,created_at,updated_at) VALUES(?,?,?,'open',?,?)").run('20264900','2026-10-20T00:00:00Z','2026-10-14T04:00:00Z',ts,ts);
 const reminder=await sendCutoffReminders(c,'2026-10-13T16:00:00Z');
 assert.equal(reminder.attempted,3);
 await sendCutoffReminders(c,'2026-10-13T16:00:00Z');
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM notifications').get().n,3);
 assert.equal(await purgeExpired(c,'2100-01-01T00:00:00Z'),3);
 sqlite.close();
});

test('account changes require password and username modification keeps stable user ID',async()=>{
 const {sqlite,owner,ts}=setup();
 const {hashSecret}=await import('../server/password.js');
 const account=(await import('../api/account.js')).default;
 sqlite.prepare('UPDATE users SET password_hash=? WHERE id=?').run(await hashSecret('this-is-a-strong-password'),'u1');
 const bad=await invoke(account,'POST','/',owner,{action:'username',username:'newowner',currentPassword:'wrong'});
 assert.equal(bad.status,403);
 const good=await invoke(account,'POST','/',owner,{action:'username',username:'newowner',currentPassword:'this-is-a-strong-password'});
 assert.equal(good.status,200,JSON.stringify(good.json));
 assert.equal(sqlite.prepare('SELECT username FROM users WHERE id=?').get('u1').username,'newowner');
 const changed=await invoke(account,'POST','/',owner,{action:'password',currentPassword:'this-is-a-strong-password',newPassword:'a-different-long-password'});
 assert.equal(changed.status,200,JSON.stringify(changed.json));
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').get('u1').n,0);
 sqlite.close();
});

test('closing expired intake never reopens and frees next intake',async()=>{
 const {sqlite,c,ts}=setup();
 const {closeExpiredIssues}=await import('../server/lifecycle.js');
 sqlite.prepare("INSERT INTO issues(code,release_at,cutoff_at,status,created_at,updated_at) VALUES(?,?,?,'open',?,?)").run('20265000','2026-11-01T00:00:00Z','2026-10-13T03:00:00Z',ts,ts);
 assert.equal(await closeExpiredIssues(c,'2026-10-13T02:59:59Z'),0);
 assert.equal(await closeExpiredIssues(c,'2026-10-13T03:00:00Z'),1);
 assert.equal(await closeExpiredIssues(c,'2026-10-13T03:00:10Z'),0);
 assert.equal(sqlite.prepare('SELECT status FROM issues WHERE code=?').get('20265000').status,'closed');
 sqlite.close();
});

test('admin username search returns IDs without secrets and rejects unprivileged access',async()=>{
 const {sqlite,owner,regular}=setup();const finder=(await import('../api/admin/users.js')).default;
 const ok=await invoke(finder,'GET','/api/admin/users?q=ow',owner);
 assert.equal(ok.status,200,JSON.stringify(ok.json));
 assert.equal(ok.json.users.length,1);assert.deepEqual(Object.keys(ok.json.users[0]).sort(),['id','role','username']);
 const no=await invoke(finder,'GET','/api/admin/users?q=ow',regular);assert.equal(no.status,403);
 sqlite.close();
});
