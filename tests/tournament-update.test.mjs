import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {readFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {__setTestDb} from '../server/db.js';import tournaments from '../api/tournaments.js';
function mockDb(sqlite){const execute=async x=>{const sql=typeof x==='string'?x:x.sql,args=typeof x==='string'?[]:x.args||[];const st=sqlite.prepare(sql);if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {rows:st.all(...args)};const r=st.run(...args);return {rows:[],rowsAffected:r.changes,changes:r.changes}};return {execute,async transaction(){sqlite.exec('BEGIN IMMEDIATE');return {execute,async commit(){sqlite.exec('COMMIT')},async rollback(){sqlite.exec('ROLLBACK')}}}}}
function setup(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../migrations/002_appearance.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../migrations/003_final_selection.sql',import.meta.url),'utf8'));__setTestDb(mockDb(sqlite));const token='a'.repeat(64),ts='2026-01-01T00:00:00Z';for(const [id,role] of [['owner','owner'],['participant','user']])sqlite.prepare('INSERT INTO users(id,username,role,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,id,role,'fake',ts,ts);sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),'owner','2099-01-01T00:00:00Z',ts);return {sqlite,token}}
function invoke(token,method='POST',body,url='/api/tournaments'){return new Promise((resolve,reject)=>{const req={method,url,body,headers:{host:'localhost',origin:'http://localhost',cookie:`jump_session=${token}`},socket:{remoteAddress:'127.0.0.1'}};const res={statusCode:200,setHeader(){},end(v){resolve({status:this.statusCode,json:JSON.parse(v)})}};Promise.resolve(tournaments(req,res)).catch(reject)})}
test('changing tournament stage issue ranges preserves enrolled user and stage identity',async()=>{
 const {sqlite,token}=setup();const one=await invoke(token,'POST',{action:'create',title:'第1回大会',stages:[{kind:'qualifier',issues:['20264000','20264100']}]});assert.equal(one.status,201,JSON.stringify(one.json));
 const id=one.json.id;const detail=(await invoke(token,'GET',undefined,`/api/tournaments?id=${id}`)).json;
 const stage=detail.stages[0].id;assert.equal((await invoke(token,'POST',{action:'enroll',stageId:stage,userId:'participant'})).status,200);
 const updated=await invoke(token,'POST',{action:'update',id,title:'第1回大会',stages:[{kind:'qualifier',issues:['20263900','20264000']},{kind:'final',issues:['20264300']}]});assert.equal(updated.status,200,JSON.stringify(updated.json));
 const next=(await invoke(token,'GET',undefined,`/api/tournaments?id=${id}`)).json;
 const qual=next.stages.find(s=>s.kind==='qualifier');assert.equal(qual.id,stage);assert.deepEqual(qual.issues,['20263900','20264000']);assert.deepEqual(qual.participants.map(x=>x.user_id),['participant']);
 const final=next.stages.find(s=>s.kind==='final');assert.equal(final.kind,'final');sqlite.close();
});
test('tournament edit rejects overlapping stages and archiving does not permit conflicting restore',async()=>{
 const {sqlite,token}=setup();let a=await invoke(token,'POST',{action:'create',title:'第1回大会',stages:[{kind:'qualifier',issues:['20264000']}]});let b=await invoke(token,'POST',{action:'create',title:'第2回大会',stages:[{kind:'qualifier',issues:['20264300']}]});
 assert.equal(a.status,201);assert.equal(b.status,201);
 const overlap=await invoke(token,'POST',{action:'update',id:a.json.id,title:'第1回大会',stages:[{kind:'qualifier',issues:['20264300']}]});assert.equal(overlap.status,409);
 assert.equal((await invoke(token,'POST',{action:'archive',id:a.json.id})).status,200);
 const c=await invoke(token,'POST',{action:'create',title:'第3回大会',stages:[{kind:'qualifier',issues:['20264000']}]});assert.equal(c.status,201);
 const blocked=await invoke(token,'POST',{action:'restore',id:a.json.id});assert.equal(blocked.status,409);
 assert.equal((await invoke(token,'POST',{action:'archive',id:c.json.id})).status,200);
 assert.equal((await invoke(token,'POST',{action:'restore',id:a.json.id})).status,200);
 sqlite.close();
});
