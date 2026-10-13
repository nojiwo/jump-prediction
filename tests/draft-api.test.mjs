import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {__setTestDb} from '../server/db.js';
import predictionHandler from '../api/prediction.js';

function database(sqlite) {
 const execute=async (value)=>{
  const sql=typeof value==='string'?value:value.sql;
  const args=typeof value==='string'?[]:value.args||[];
  const statement=sqlite.prepare(sql);
  if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {rows:statement.all(...args)};
  const response=statement.run(...args);
  return {rows:[],rowsAffected:response.changes,changes:response.changes};
 };
 return {execute,async transaction(){sqlite.exec('BEGIN IMMEDIATE');return {execute,async commit(){sqlite.exec('COMMIT')},async rollback(){sqlite.exec('ROLLBACK')}}}};
}
function fixture() {
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON');
 for(const migration of ['001_initial.sql','002_appearance.sql','003_final_selection.sql']){
  sqlite.exec(readFileSync(new URL('../migrations/'+migration,import.meta.url),'utf8'));
 }
 __setTestDb(database(sqlite));
 const at='2026-01-01T00:00:00.000Z',cookieToken='a'.repeat(64);
 sqlite.prepare('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('u-1','user-a','unused','user',at,at);
 sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(cookieToken).digest('hex'),'u-1','2099-01-01T00:00:00Z',at);
 sqlite.prepare("INSERT INTO issues(code,release_at,cutoff_at,status,created_at,updated_at) VALUES(?,?,?,'open',?,?)").run('20900100','2090-05-16T15:00:00.000Z','2090-05-10T15:00:00.000Z',at,at);
 for(let i=1;i<=4;i++){
  const id=String(i).padStart(4,'0');
  sqlite.prepare('INSERT INTO works(id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,'work '+i,'serial',at,at);
  sqlite.prepare('INSERT INTO issue_frozen_works(issue_code,work_id,initial_position,color) VALUES(?,?,?,?)').run('20900100',id,i,'none');
 }
 return {sqlite,cookieToken};
}
async function send(method,token,params,url='/api/prediction?issue=20900100'){
 return new Promise((resolve,reject)=>{
  const req={method,url,body:params,headers:{host:'localhost',origin:'http://localhost',cookie:`jump_session=${token}`},socket:{remoteAddress:'127.0.0.1'}};
  const res={statusCode:200,setHeader(){},end(v){resolve({status:this.statusCode,body:JSON.parse(v)})}};
  Promise.resolve(predictionHandler(req,res)).catch(reject);
 });
}
test('sequential partial draft round-trip returns prefix and input mode without replacing formal submission',async()=>{
 const {sqlite,cookieToken}=fixture();
 try{
  let r=await send('POST',cookieToken,{issue:'20900100',mode:'submit',order:['0004','0002','0003','0001']});
  assert.equal(r.status,200,JSON.stringify(r.body));
  const pred=sqlite.prepare('SELECT first_submitted_at FROM predictions WHERE user_id=?').get('u-1');
  r=await send('POST',cookieToken,{issue:'20900100',mode:'draft',inputMode:'sequential',order:['0003','0001']});
  assert.equal(r.status,200,JSON.stringify(r.body));
  r=await send('GET',cookieToken);
  assert.equal(r.status,200,JSON.stringify(r.body));
  assert.deepEqual(r.body.draft,['0003','0001']);
  assert.equal(r.body.draft_input_mode,'sequential');
  assert.deepEqual(r.body.formal,['0004','0002','0003','0001']);
  assert.equal(r.body.first_submitted_at,pred.first_submitted_at);
 } finally {sqlite.close()}
});
test('a different user cannot access the saved draft',async()=>{
 const {sqlite,cookieToken}=fixture();
 try{
  const r=await send('POST',cookieToken,{issue:'20900100',mode:'draft',inputMode:'sequential',order:['0002']});
  assert.equal(r.status,200);
  const anon=await send('GET','b'.repeat(64));
  assert.equal(anon.status,401);
 }finally{sqlite.close()}
});
