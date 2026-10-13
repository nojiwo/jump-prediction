import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {__setTestDb} from '../server/db.js';
import tournaments from '../api/tournaments.js';

function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON');
 for(const filename of ['001_initial.sql','002_appearance.sql','003_final_selection.sql'])sqlite.exec(readFileSync(new URL(`../migrations/${filename}`,import.meta.url),'utf8'));
 const execute=async param=>{
  const {sql,args=[]}=typeof param==='string'?{sql:param}:param;
  const statement=sqlite.prepare(sql);
  if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {rows:statement.all(...args)};
  const info=statement.run(...args);return {rows:[],rowsAffected:info.changes,changes:info.changes};
 };
 __setTestDb({execute,async transaction(){sqlite.exec('BEGIN IMMEDIATE');return {execute,async commit(){sqlite.exec('COMMIT')},async rollback(){sqlite.exec('ROLLBACK')}}}});
 const when='2026-01-01T00:00:00.000Z';
 for(const [id,username,role] of [['manager','manager','owner'],['mika','mika','user'],['sora','sora','user']]){
  sqlite.prepare('INSERT INTO users(id,username,role,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,username,role,'hash',when,when);
 }
 const tokens={manager:'a'.repeat(64),mika:'b'.repeat(64)};
 for(const [id,token] of Object.entries(tokens))sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,'2099-01-01T00:00:00Z',when);
 return {sqlite,tokens};
}
function request(token,method,body,url='/api/tournaments'){
 return new Promise((resolve,reject)=>{
  const req={method,url,body,headers:{host:'localhost',origin:'http://localhost',cookie:`jump_session=${token}`},socket:{remoteAddress:'127.0.0.1'}};
  const res={statusCode:200,setHeader(){},end(v){resolve({status:this.statusCode,data:JSON.parse(v)})}};
  Promise.resolve(tournaments(req,res)).catch(reject);
 });
}
test('qualifier removal demands confirmation, leaves enrolment untouched on rejection',async()=>{
 const {sqlite,tokens}=fixture();
 const created=await request(tokens.manager,'POST',{action:'create',title:'第1回大会',stages:[{kind:'qualifier',issues:['20264000']} ]});
 assert.equal(created.status,201);
 const detail=await request(tokens.manager,'GET',undefined,`/api/tournaments?id=${created.data.id}`);
 const stage=detail.data.stages[0].id;
 assert.equal((await request(tokens.manager,'POST',{action:'enroll',stageId:stage,userId:'mika'})).status,200);
 const count=()=>sqlite.prepare('SELECT COUNT(*) AS n FROM stage_participants WHERE stage_id=?').get(stage).n;
 assert.equal(count(),1);
 const without=await request(tokens.manager,'POST',{action:'remove',stageId:stage,userId:'mika'});
 assert.equal(without.status,400);assert.match(without.data.error,/確認/);assert.equal(count(),1);
 const explicitFalse=await request(tokens.manager,'POST',{action:'remove',stageId:stage,userId:'mika',confirmed:false});
 assert.equal(explicitFalse.status,400);assert.equal(count(),1);
 const confirmed=await request(tokens.manager,'POST',{action:'remove',stageId:stage,userId:'mika',confirmed:true});
 assert.equal(confirmed.status,200);assert.equal(count(),0);
 sqlite.close();
});
test('general user cannot proxy-enroll or remove another qualifier, and unaffected participants remain',async()=>{
 const {sqlite,tokens}=fixture();
 const created=await request(tokens.manager,'POST',{action:'create',title:'予選',stages:[{kind:'qualifier',issues:['20264200']} ]});
 const detail=await request(tokens.manager,'GET',undefined,`/api/tournaments?id=${created.data.id}`);
 const stage=detail.data.stages[0].id;
 assert.equal((await request(tokens.manager,'POST',{action:'enroll',stageId:stage,userId:'mika'})).status,200);
 assert.equal((await request(tokens.manager,'POST',{action:'enroll',stageId:stage,userId:'sora'})).status,200);
 assert.equal((await request(tokens.mika,'POST',{action:'remove',stageId:stage,userId:'sora',confirmed:true})).status,403);
 assert.equal((await request(tokens.mika,'POST',{action:'enroll',stageId:stage,userId:'sora'})).status,403);
 assert.equal((await request(tokens.manager,'POST',{action:'remove',stageId:stage,userId:'mika',confirmed:true})).status,200);
 assert.deepEqual(sqlite.prepare('SELECT user_id FROM stage_participants WHERE stage_id=?').all(stage).map(x=>x.user_id),['sora']);
 sqlite.close();
});
