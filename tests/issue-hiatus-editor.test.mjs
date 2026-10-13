import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {__setTestDb} from '../server/db.js';
import issueSetup from '../api/admin/issue-setup.js';

const CODE='20264200';
const token='d'.repeat(64);
function fixture(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON');
 for(const file of ['001_initial.sql','002_appearance.sql','003_final_selection.sql'])
  sqlite.exec(readFileSync(new URL(`../migrations/${file}`,import.meta.url),'utf8'));
 const execute=async x=>{
  const {sql,args=[]}=typeof x==='string'?{sql:x}:x;
  const st=sqlite.prepare(sql);
  if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {rows:st.all(...args)};
  const result=st.run(...args);
  return {rows:[],rowsAffected:result.changes,changes:result.changes};
 };
 __setTestDb({execute,async transaction(){
  sqlite.exec('BEGIN IMMEDIATE');let open=true;
  return {execute,async commit(){if(open){sqlite.exec('COMMIT');open=false}},async rollback(){if(open){sqlite.exec('ROLLBACK');open=false}}};
 }});
 const now='2026-01-01T00:00:00Z';
 sqlite.prepare('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)')
  .run('owner','admin','unused','owner',now,now);
 sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
  .run(createHash('sha256').update(token).digest('hex'),'owner','2099-01-01T00:00:00Z',now);
 sqlite.prepare("INSERT INTO issues(code,release_at,cutoff_at,status,created_at,updated_at) VALUES(?,?,?,'planned',?,?)")
  .run(CODE,'2090-10-19T00:00:00Z','2090-10-15T00:00:00Z',now,now);
 for(let i=1;i<=3;i++){
  const id=String(i).padStart(4,'0');
  sqlite.prepare('INSERT INTO works(id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?)')
   .run(id,`連載作品${i}`,'serial',now,now);
  sqlite.prepare('INSERT INTO serialization_periods(work_id,start_issue_code,end_issue_code) VALUES(?,?,NULL)')
   .run(id,'20260100');
 }
 return sqlite;
}
async function request(method='GET',payload){
 return new Promise((resolve,reject)=>{
  const req={method,url:`/api/admin/issue-setup?code=${CODE}`,body:payload,
   headers:{host:'localhost',origin:'http://localhost',cookie:`jump_session=${token}`}};
  const res={statusCode:200,setHeader(){},end(data){try{resolve({status:this.statusCode,body:JSON.parse(data)})}catch(e){reject(e)}}};
  Promise.resolve(issueSetup(req,res)).catch(reject);
 });
}
const save=(hiatus=[],colors=[{workId:'0001',color:'lead'}],confirmed=true)=>request('POST',{
 action:'save',code:CODE,confirmed,colors,plannedHiatus:hiatus
});

test('planned hiatus stays visible when editing, and it can be cancelled before opening',async()=>{
 const sqlite=fixture();try{
  const initial=await save(['0002']);assert.equal(initial.status,200,JSON.stringify(initial.body));
  const get=await request();assert.equal(get.status,200);
  assert.equal(get.body.selected.length,3);
  assert.equal(get.body.selected.find(w=>w.id==='0002').inclusion,'planned_hiatus');
  const edit=await save([]);assert.equal(edit.status,200,JSON.stringify(edit.body));
  const open=await request('POST',{action:'open',code:CODE});
  assert.equal(open.status,200,JSON.stringify(open.body));
  assert.equal(open.body.count,3);
  assert.deepEqual(sqlite.prepare('SELECT work_id FROM issue_frozen_works WHERE issue_code=? ORDER BY initial_position').all(CODE).map(x=>x.work_id),['0001','0002','0003']);
 }finally{sqlite.close()}
});

test('confirmed planned hiatus is omitted from the frozen prediction snapshot',async()=>{
 const sqlite=fixture();try{
  assert.equal((await save(['0002'])).status,200);
  const opened=await request('POST',{action:'open',code:CODE});
  assert.equal(opened.status,200,JSON.stringify(opened.body));
  assert.equal(opened.body.count,2);
  assert.deepEqual(sqlite.prepare('SELECT work_id FROM issue_frozen_works WHERE issue_code=? ORDER BY initial_position').all(CODE).map(x=>x.work_id),['0001','0003']);
 }finally{sqlite.close()}
});

test('a work on planned hiatus cannot simultaneously have a color designation',async()=>{
 const sqlite=fixture();try{
  const bad=await save(['0001']);
  assert.equal(bad.status,400,JSON.stringify(bad.body));
  const good=await save(['0002']);
  assert.equal(good.status,200,JSON.stringify(good.body));
 }finally{sqlite.close()}
});
