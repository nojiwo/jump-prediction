import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {__setTestDb} from '../server/db.js';
import getPrediction from '../api/prediction.js';
import comparePrediction from '../api/prediction-comparison.js';
import listIssues from '../api/issues.js';

function fixture(){
 const sqlite=new DatabaseSync(':memory:'); sqlite.exec('PRAGMA foreign_keys=ON');
 for(const filename of ['001_initial.sql','002_appearance.sql','003_final_selection.sql']){
  sqlite.exec(readFileSync(new URL('../migrations/'+filename,import.meta.url),'utf8'));
 }
 const execute=async value=>{
  const {sql,args=[]}=typeof value==='string'?{sql:value}:value;
  const stmt=sqlite.prepare(sql);
  if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {rows:stmt.all(...args)};
  const written=stmt.run(...args);return {rows:[],rowsAffected:written.changes,changes:written.changes};
 };
 __setTestDb({execute,async transaction(){sqlite.exec('BEGIN IMMEDIATE');return {execute,commit:async()=>sqlite.exec('COMMIT'),rollback:async()=>sqlite.exec('ROLLBACK')}}});
 const now='2026-01-01T00:00:00.000Z';
 const token='c'.repeat(64);
 sqlite.prepare('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('u1','reviewer','pw','user',now,now);
 sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),'u1','2099-01-01T00:00:00.000Z',now);
 sqlite.prepare("INSERT INTO issues(code,release_at,cutoff_at,status,created_at,updated_at) VALUES(?,?,?,'open',?,?)").run('20260100','2026-01-05T00:00:00.000Z','2026-01-02T00:00:00.000Z',now,now);
 sqlite.prepare("INSERT INTO issues(code,release_at,cutoff_at,status,created_at,updated_at) VALUES(?,?,?,'planned',?,?)").run('20260200','2026-01-12T00:00:00.000Z','2026-01-08T00:00:00.000Z',now,now);
 for(let i=1;i<=3;i++){
  const id=String(i).padStart(4,'0');
  sqlite.prepare('INSERT INTO works(id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,`マンガ${i}`,'serial',now,now);
  sqlite.prepare('INSERT INTO issue_frozen_works(issue_code,work_id,initial_position,color) VALUES(?,?,?,?)').run('20260100',id,i,'none');
 }
 sqlite.prepare('INSERT INTO predictions(id,issue_code,user_id,first_submitted_at,last_submitted_at) VALUES(?,?,?,?,?)').run('p1','20260100','u1',now,now);
 for(const [i,id] of ['0002','0001','0003'].entries()){
  sqlite.prepare('INSERT INTO prediction_items(prediction_id,work_id,predicted_rank) VALUES(?,?,?)').run('p1',id,i+1);
 }
 return {sqlite,token};
}
async function invoke(handler,{url,token}={}){
 return await new Promise((resolve,reject)=>{
  const req={url,method:'GET',headers:{host:'localhost',origin:'http://localhost',cookie:`jump_session=${token}`}};
  const res={statusCode:200,setHeader(){},end(txt){try{resolve({status:this.statusCode,body:JSON.parse(txt)})}catch(e){reject(e)}}};
  Promise.resolve(handler(req,res)).catch(reject);
 });
}

test('the just-closed issue remains available to the logged-in user for prediction comparisons',async()=>{
 const {sqlite,token}=fixture();
 try{
  // Advance past the cutoff; the issue-list API closes it automatically.
  sqlite.prepare('UPDATE issues SET cutoff_at=? WHERE code=?').run('2025-12-31T15:00:00.000Z','20260100');
  const issues=await invoke(listIssues,{url:'/api/issues',token});
  assert.equal(issues.status,200);
  assert.equal(issues.body.issues.find(i=>i.code==='20260100').status,'closed');
  assert.equal(issues.body.issues.some(i=>i.code==='20260200'),false);
  const own=await invoke(getPrediction,{url:'/api/prediction?issue=20260100',token});
  assert.equal(own.status,200);
  assert.deepEqual(own.body.formal,['0002','0001','0003']);
  const compared=await invoke(comparePrediction,{url:'/api/prediction-comparison?issue=20260100',token});
  assert.equal(compared.status,200);
  assert.equal(compared.body.participants[0].username,'reviewer');
  assert.deepEqual(compared.body.participants[0].order,['0002','0001','0003']);
 }finally{sqlite.close()}
});

test('unregistered guests cannot see closed prediction comparison data',async()=>{
 const {sqlite}=fixture();
 try{const response=await invoke(comparePrediction,{url:'/api/prediction-comparison?issue=20260100',token:'d'.repeat(64)});assert.equal(response.status,401)}finally{sqlite.close()}
});
