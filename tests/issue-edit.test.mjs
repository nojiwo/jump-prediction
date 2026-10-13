import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {__setTestDb} from '../server/db.js';
import handler from '../api/issues.js';
import {originalWeekLastInstant,planIssueChange,parseInstant} from '../server/issue-edit.js';
function fakeDb(sqlite){
  const execute=async x=>{const sql=typeof x==='string'?x:x.sql,args=typeof x==='string'?[]:x.args||[];
   const st=sqlite.prepare(sql);if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {rows:st.all(...args)};
   const r=st.run(...args);return {rows:[],rowsAffected:r.changes,changes:r.changes}};
  return {execute,async transaction(){sqlite.exec('BEGIN IMMEDIATE');return {execute,async commit(){sqlite.exec('COMMIT')},async rollback(){sqlite.exec('ROLLBACK')}}}};
}
function setup(){const sqlite=new DatabaseSync(':memory:');sqlite.exec('PRAGMA foreign_keys=ON');
  sqlite.exec(readFileSync(new URL('../migrations/001_initial.sql',import.meta.url),'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/002_appearance.sql',import.meta.url),'utf8'));sqlite.exec(readFileSync(new URL('../migrations/003_final_selection.sql',import.meta.url),'utf8'));
  __setTestDb(fakeDb(sqlite));const stamp='2026-01-01T00:00:00Z';
  const owner='a'.repeat(64),ordinary='b'.repeat(64);
  for(const [id,role,token] of [['owner','owner',owner],['viewer','user',ordinary]]){
   sqlite.prepare('INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,id,'unused',role,stamp,stamp);
   sqlite.prepare('INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,stamp,'2099-01-01T00:00:00Z');
  }
  return {sqlite,owner,ordinary};
}
async function request(method,token,body,url='/api/issues'){
 return new Promise((resolve,reject)=>{const req={method,url,body,headers:{host:'localhost',origin:'http://localhost',cookie:`jump_session=${token}`},socket:{remoteAddress:'127.0.0.1'}};
 const res={statusCode:200,setHeader(){},end(data){resolve({status:this.statusCode,body:JSON.parse(data)})}};
 Promise.resolve(handler(req,res)).catch(reject)});
}
test('JST deadline extension is bounded to Sunday 23:59:59 of original week',()=>{
 const current={status:'open',release_at:'2090-05-16T15:00:00.000Z',cutoff_at:'2090-05-10T15:00:00.000Z',plan_reviewed_at:'2090-05-01T00:00:00Z',cutoff_manually_edited:0};
 // Cutoff corresponds to May 11 00:00 JST (Thursday). Boundary is May 14 Sunday 23:59:59 JST.
 assert.equal(originalWeekLastInstant(current.cutoff_at),'2090-05-14T14:59:59.000Z');
 const valid=planIssueChange(current,{cutoff_at:'2090-05-14T23:59:59+09:00'},Date.parse('2090-05-09T00:00:00Z'));
 assert.equal(valid.cutoff,'2090-05-14T14:59:59.000Z');assert.equal(valid.manuallyEdited,1);
 for(const candidate of ['2090-05-15T00:00:00+09:00','2090-05-10T23:00:00+09:00']){
  assert.throws(()=>planIssueChange(current,{cutoff_at:candidate},Date.parse('2090-05-09T00:00:00Z')),e=>e.status===409);
 }
 assert.throws(()=>planIssueChange(current,{cutoff_at:'2090-05-12T00:00:00+09:00'},Date.parse('2090-05-11T00:00:00Z')),e=>e.status===409);
});
test('timezone-less strings are rejected so iPhone and server local time cannot disagree',()=>{
 assert.throws(()=>parseInstant('2090-05-14T08:00','締切日時'),e=>e.status===400);
 assert.equal(parseInstant('2090-05-14T08:00+09:00','締切日時'),'2090-05-13T23:00:00.000Z');
});
test('admin edits issue metadata without losing frozen snapshot; public edit blocked',async()=>{
 const {sqlite,owner,ordinary}=setup();const stamp='2090-01-01T00:00:00Z';
 sqlite.prepare("INSERT INTO issues(code,release_at,cutoff_at,status,plan_reviewed_at,created_at,updated_at) VALUES(?,?,?,'open',?,?,?)").run('20900100','2090-05-16T15:00:00.000Z','2090-05-10T15:00:00.000Z',stamp,stamp,stamp);
 sqlite.prepare('INSERT INTO works(id,title,kind,created_at,updated_at) VALUES(?,?,?,?,?)').run('0001','作品A','serial',stamp,stamp);
 sqlite.prepare('INSERT INTO issue_frozen_works(issue_code,work_id,initial_position,color) VALUES(?,?,?,?)').run('20900100','0001',1,'lead');
 const forbidden=await request('PATCH',ordinary,{code:'20900100',cutoff_at:'2090-05-12T15:00:00.000Z'});
 assert.equal(forbidden.status,403);
 const result=await request('PATCH',owner,{code:'20900100',cutoff_at:'2090-05-12T15:00:00.000Z'});
 assert.equal(result.status,200,JSON.stringify(result.body));
 const current=sqlite.prepare('SELECT status,cutoff_manually_edited,cutoff_at,plan_reviewed_at FROM issues WHERE code=?').get('20900100');
 assert.equal(current.status,'open');assert.equal(current.cutoff_manually_edited,1);
 assert.equal(current.cutoff_at,'2090-05-12T15:00:00.000Z');
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM issue_frozen_works WHERE issue_code=?').get('20900100').n,1);
 const bad=await request('PATCH',owner,{code:'20900100',cutoff_at:'2090-05-18T15:00:00.000Z'});
 assert.equal(bad.status,400); // After release date is invalid as well.
 sqlite.close();
});
test('after closing, cutoff cannot change; editing release never unpublishes results',async()=>{
 const {sqlite,owner}=setup();const stamp='2090-01-01T00:00:00Z';
 sqlite.prepare("INSERT INTO issues(code,release_at,cutoff_at,status,results_published_at,created_at,updated_at) VALUES(?,?,?,'closed',?,?,?)").run('20900100','2090-05-16T15:00:00.000Z','2090-05-10T15:00:00.000Z',stamp,stamp,stamp);
 const bad=await request('PATCH',owner,{code:'20900100',cutoff_at:'2090-05-11T15:00:00Z'});
 assert.equal(bad.status,409);
 const ok=await request('PATCH',owner,{code:'20900100',release_at:'2090-05-17T15:00:00Z'});
 assert.equal(ok.status,200,JSON.stringify(ok.body));
 assert.equal(sqlite.prepare('SELECT results_published_at FROM issues WHERE code=?').get('20900100').results_published_at,stamp);
 sqlite.close();
});
