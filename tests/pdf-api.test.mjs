import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {__setTestDb} from '../server/db.js';
import pdfData from '../api/admin/pdf-data.js';
function setup(){
 const s=new DatabaseSync(':memory:');s.exec('PRAGMA foreign_keys=ON');
 for(const name of ['001_initial.sql','002_appearance.sql','003_final_selection.sql'])s.exec(readFileSync(new URL(`../migrations/${name}`,import.meta.url),'utf8'));
 const execute=async x=>{const sql=typeof x==='string'?x:x.sql,args=typeof x==='string'?[]:x.args||[];const st=s.prepare(sql);if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {rows:st.all(...args)};let r=st.run(...args);return {rows:[],rowsAffected:r.changes,changes:r.changes}};
 __setTestDb({execute});
 const ts='2026-01-01T00:00:00Z';
 for(const [id,role] of [['owner','owner'],['a','user'],['b','user'],['c','user'],['d','user']])s.prepare('INSERT INTO users(id,username,role,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,id,role,'test',ts,ts);
 const token='a'.repeat(64);s.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),'owner','2099-01-01T00:00:00Z',ts);
 s.prepare('INSERT INTO issues(code,release_at,cutoff_at,status,scores_confirmed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run('20264200','2026-10-19T00:00:00+09:00','2026-10-15T00:00:00+09:00','closed',ts,ts,ts);
 for(const [id,score,place] of [['a',4,1],['b',8,2],['c',8,2],['d',16,4]])s.prepare('INSERT INTO issue_scores(issue_code,user_id,total_error,place,calculated_at) VALUES(?,?,?,?,?)').run('20264200',id,score,place,ts);
 s.prepare('INSERT INTO tournaments(id,title,created_at,updated_at) VALUES(?,?,?,?)').run('t1','テスト大会',ts,ts);
 for(const [id,kind] of [['q','qualifier'],['f','final']])s.prepare('INSERT INTO tournament_stages(id,tournament_id,kind) VALUES(?,?,?)').run(id,'t1',kind);
 for(const [stage,id] of [['q','a'],['q','b'],['q','c'],['f','a'],['f','d']])s.prepare('INSERT INTO stage_participants(stage_id,user_id,joined_at,enrollment_source) VALUES(?,?,?,?)').run(stage,id,ts,'admin');
 return {s,token};
}
function invoke(token,path){return new Promise((resolve,reject)=>{const req={method:'GET',url:path,headers:{cookie:`jump_session=${token}`,host:'localhost'},socket:{remoteAddress:'127.0.0.1'}};const res={statusCode:200,setHeader(){},end(v){resolve({status:this.statusCode,data:JSON.parse(v)})}};Promise.resolve(pdfData(req,res)).catch(reject)})}
test('PDF API narrows to qualifier, finalists, and qualifier nonfinalists; reranks ties',async()=>{
 const {s,token}=setup();
 const q=await invoke(token,'/api/admin/pdf-data?type=issue&issue=20264200&scope=qualifier&tournament=t1');
 assert.equal(q.status,200,JSON.stringify(q.data));assert.deepEqual(q.data.rankings.map(x=>x.username),['a','b','c']);assert.deepEqual(q.data.rankings.map(x=>x.place),[1,2,2]);
 const f=await invoke(token,'/api/admin/pdf-data?type=issue&issue=20264200&scope=final&tournament=t1');
 assert.deepEqual(f.data.rankings.map(x=>x.username),['a','d']);assert.deepEqual(f.data.rankings.map(x=>x.place),[1,2]);
 const nf=await invoke(token,'/api/admin/pdf-data?type=issue&issue=20264200&scope=nonfinal&tournament=t1');
 assert.deepEqual(nf.data.rankings.map(x=>x.username),['b','c']);assert.deepEqual(nf.data.rankings.map(x=>x.place),[1,1]);
 const all=await invoke(token,'/api/admin/pdf-data?type=issue&issue=20264200');assert.equal(all.data.rankings.length,4);
 s.close();
});
test('PDF API refuses unrecognized scope or invalid tournament ID',async()=>{
 const {s,token}=setup();
 assert.equal((await invoke(token,'/api/admin/pdf-data?type=issue&issue=20264200&scope=unknown')).status,400);
 assert.equal((await invoke(token,'/api/admin/pdf-data?type=issue&issue=20264200&scope=qualifier&tournament=missing')).status,404);
 assert.equal((await invoke(token,'/api/admin/pdf-data?type=issue&issue=20264200&scope=qualifier')).status,400);
 s.close();
});
