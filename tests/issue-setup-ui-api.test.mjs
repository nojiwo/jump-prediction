import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {__setTestDb} from '../server/db.js';
import issueHandler from '../api/admin/issue-setup.js';
import {persistIssueSetup} from '../src/core/issue-setup-flow.ts';

const code='20904300';
const token='e'.repeat(64);
function fixture(){
 const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of ['001_initial.sql','002_appearance.sql','003_final_selection.sql'])
  sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 const execute=async input=>{
  const sql=typeof input==='string'?input:input.sql;
  const args=typeof input==='string'?[]:input.args||[];
  const statement=sqlite.prepare(sql);
  if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {rows:statement.all(...args)};
  const result=statement.run(...args);
  return {rows:[],rowsAffected:result.changes,changes:result.changes};
 };
 __setTestDb({execute,async transaction(){sqlite.exec('BEGIN IMMEDIATE');let open=true;return {
  execute,async commit(){if(open){sqlite.exec('COMMIT');open=false}},async rollback(){if(open){sqlite.exec('ROLLBACK');open=false}}
 }}});
 const at='2026-01-01T00:00:00.000Z';
 sqlite.prepare('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('owner','admin','unused','owner',at,at);
 sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),'owner','2099-01-01T00:00:00Z',at);
 sqlite.prepare("INSERT INTO issues(code,release_at,cutoff_at,status,created_at,updated_at) VALUES(?,?,?,'planned',?,?)").run(code,'2090-11-01T00:00:00Z','2090-10-28T00:00:00Z',at,at);
 for(let i=1;i<=3;i++){
  const id=String(i).padStart(4,'0');
  sqlite.prepare('INSERT INTO works(id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,'作品'+i,'serial',at,at);
  sqlite.prepare('INSERT INTO serialization_periods(work_id,start_issue_code,end_issue_code) VALUES(?,?,NULL)').run(id,'20900100');
 }
 return sqlite;
}
async function request(path,method,payload){
 return new Promise((resolve,reject)=>{
  const req={method,url:`${path}?code=${code}`,body:payload,headers:{host:'localhost',origin:'http://localhost',cookie:`jump_session=${token}`}};
  const res={statusCode:200,setHeader(){},end(text){const obj=JSON.parse(text);if(this.statusCode>=400)reject(new Error(obj.error));else resolve(obj)}};
  Promise.resolve(issueHandler(req,res)).catch(reject);
 });
}
test('UI acceptance flow persists edited settings through real admin API before freezing the eligible works',async()=>{
 const db=fixture();
 try{
  await persistIssueSetup(request,{
   code,lead:'0003',centers:['0001'],hiatus:['0002'],confirmed:true,conflictCount:0
  },true);
  const rows=db.prepare('SELECT work_id,color FROM issue_frozen_works WHERE issue_code=? ORDER BY initial_position').all(code);
  assert.deepEqual(rows.map(r=>({work_id:r.work_id,color:r.color})),[{work_id:'0003',color:'lead'},{work_id:'0001',color:'center'}]);
  assert.equal(db.prepare('SELECT status FROM issues WHERE code=?').get(code).status,'open');
 }finally{db.close()}
});
