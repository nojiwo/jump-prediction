import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {__setTestDb} from '../server/db.js';
import tournaments from '../api/tournaments.js';

function setup(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const migration of ['001_initial.sql','002_appearance.sql','003_final_selection.sql'])sqlite.exec(readFileSync(new URL(`../migrations/${migration}`,import.meta.url),'utf8'));
 async function execute(param){const {sql,args=[]}=typeof param==='string'?{sql:param}:param;const st=sqlite.prepare(sql);if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {rows:st.all(...args)};const result=st.run(...args);return {rows:[],rowsAffected:result.changes,changes:result.changes};}
 __setTestDb({execute,async transaction(){sqlite.exec('BEGIN IMMEDIATE');return {execute,async commit(){sqlite.exec('COMMIT')},async rollback(){sqlite.exec('ROLLBACK')}}}});
 const ts='2025-01-01T00:00:00.000Z';
 for(const [id,username,role] of [['admin','manager','owner'],['a','akira','user'],['b','ben','user'],['c','chika','user'],['d','daisuke','user']])sqlite.prepare('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,username,'dummy',role,ts,ts);
 const owner='a'.repeat(64),reader='b'.repeat(64);
 for(const [user,token] of [['admin',owner],['a',reader]])sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),user,'2099-01-01T00:00:00.000Z',ts);
 return {sqlite,owner,reader};
}
const call=(method,url,token,json)=>new Promise((resolve,reject)=>{
 const req={method,url,body:json,headers:{host:'localhost',origin:'http://localhost',cookie:`jump_session=${token}`},socket:{remoteAddress:'127.0.0.1'}};
 const res={statusCode:200,setHeader(){},end(result){resolve({status:this.statusCode,body:JSON.parse(result)})}};
 Promise.resolve(tournaments(req,res)).catch(reject);
});

// Candidate groups are never retrievable through an unprivileged session.
test('finalist selection requires explicit save, hides unreleased final and groups candidates by source',async()=>{
 const {sqlite,owner,reader}=setup();
 const p=await call('POST','/api/tournaments',owner,{action:'create',title:'第1回大会',stages:[{kind:'final',issues:['20261100']}]});
 assert.equal(p.status,201,JSON.stringify(p.body));
 const prior=(await call('GET',`/api/tournaments?id=${p.body.id}`,owner)).body.stages[0].id;
 const c=await call('POST','/api/tournaments',owner,{action:'create',title:'第2回大会',stages:[{kind:'qualifier',issues:['20262000']},{kind:'final',issues:['20262200']}]});
 assert.equal(c.status,201,JSON.stringify(c.body));
 const selected=(await call('GET',`/api/tournaments?id=${c.body.id}`,owner)).body.stages;
 const qualifier=selected.find(s=>s.kind==='qualifier').id,final=selected.find(s=>s.kind==='final').id;
 // Previously a final could be published without first saving the selection.
 const noSave=await call('POST','/api/tournaments',owner,{action:'publishFinal',stageId:final,confirmed:true});
 assert.equal(noSave.status,409,noSave.body.error);
 await call('POST','/api/tournaments',owner,{action:'enroll',stageId:prior,userId:'a'});
 await call('POST','/api/tournaments',owner,{action:'enroll',stageId:prior,userId:'b'});
 await call('POST','/api/tournaments',owner,{action:'enroll',stageId:qualifier,userId:'b'});
 await call('POST','/api/tournaments',owner,{action:'enroll',stageId:qualifier,userId:'c'});
 const groups=await call('GET',`/api/tournaments?finalCandidates=${final}`,owner);
 assert.equal(groups.status,200,JSON.stringify(groups.body));
 assert.deepEqual(groups.body.groups.map(x=>x.key),['previous','qualifier','other']);
 assert.deepEqual(groups.body.groups[0].users.map(x=>x.id),['a','b']);
 assert.deepEqual(groups.body.groups[1].users.map(x=>x.id),['b','c']);
 assert.ok(groups.body.groups[2].users.some(x=>x.id==='d'));
 assert.ok(!groups.body.groups[2].users.some(x=>x.id==='b'));
 assert.equal((await call('GET',`/api/tournaments?finalCandidates=${final}`,reader)).status,403);
 const save=await call('POST','/api/tournaments',owner,{action:'saveFinal',stageId:final,userIds:['a','b']});
 assert.equal(save.status,200,save.body.error);
 assert.ok(sqlite.prepare('SELECT finalists_saved_at FROM tournament_stages WHERE id=?').get(final).finalists_saved_at);
 // Last-minute changes made through enrolment must invalidate a draft selection.
 await call('POST','/api/tournaments',owner,{action:'enroll',stageId:final,userId:'c'});
 assert.equal(sqlite.prepare('SELECT finalists_saved_at FROM tournament_stages WHERE id=?').get(final).finalists_saved_at,null);
 assert.equal((await call('POST','/api/tournaments',owner,{action:'publishFinal',stageId:final,confirmed:true})).status,409);
 assert.equal((await call('POST','/api/tournaments',owner,{action:'saveFinal',stageId:final,userIds:['a','b','c']})).status,200);
 assert.equal((await call('POST','/api/tournaments',owner,{action:'publishFinal',stageId:final,confirmed:true})).status,200);
 // After release the selection remains editable and publication timestamp stays intact.
 const published=sqlite.prepare('SELECT finalists_announced_at FROM tournament_stages WHERE id=?').get(final).finalists_announced_at;
 assert.ok(published);
 assert.equal((await call('POST','/api/tournaments',owner,{action:'saveFinal',stageId:final,userIds:['b']})).status,200);
 assert.equal(sqlite.prepare('SELECT finalists_announced_at FROM tournament_stages WHERE id=?').get(final).finalists_announced_at,published);
 sqlite.close();
});

test('unannounced final stage ID, issue numbers, and entrants are not exposed in published tournament detail',async()=>{
 const {sqlite,owner,reader}=setup();
 const r=await call('POST','/api/tournaments',owner,{action:'create',title:'告知済み大会',stages:[{kind:'qualifier',issues:['20263000']},{kind:'final',issues:['20263100']}]});
 const initial=(await call('GET',`/api/tournaments?id=${r.body.id}`,owner)).body;
 const final=initial.stages.find(x=>x.kind==='final');
 sqlite.prepare('UPDATE tournaments SET announced_at=? WHERE id=?').run('2025-01-01T00:00:00.000Z',r.body.id);
 assert.equal((await call('POST','/api/tournaments',owner,{action:'saveFinal',stageId:final.id,userIds:['a']})).status,200);
 const publicDetail=await call('GET',`/api/tournaments?id=${r.body.id}`,reader);
 assert.equal(publicDetail.status,200);
 assert.equal(publicDetail.body.stages.length,1);
 assert.ok(!JSON.stringify(publicDetail.body).includes('20263100'));
 assert.ok(!JSON.stringify(publicDetail.body).includes(final.id));
 assert.ok(!JSON.stringify(publicDetail.body).includes('akira'));
 assert.equal((await call('GET',`/api/tournaments?stage=${final.id}`,reader)).status,404);
 assert.equal((await call('POST','/api/tournaments',owner,{action:'publishFinal',stageId:final.id,confirmed:true})).status,200);
 const released=await call('GET',`/api/tournaments?id=${r.body.id}`,reader);
 assert.equal(released.body.stages.length,2);
 assert.deepEqual(released.body.stages.find(x=>x.kind==='final').participants.map(x=>x.user_id),['a']);
 sqlite.close();
});
