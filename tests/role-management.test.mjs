import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { __setTestDb } from '../server/db.js';
import { hashSecret } from '../server/password.js';
import rolesHandler from '../api/admin/roles.js';
import searchHandler from '../api/admin/users.js';

function setup(){
 const sqlite=new DatabaseSync(':memory:');
 sqlite.exec('PRAGMA foreign_keys=ON');
 for (const n of ['001_initial.sql','002_appearance.sql','003_final_selection.sql'])
  sqlite.exec(readFileSync(new URL('../migrations/'+n,import.meta.url),'utf8'));
 const execute=async (v)=>{
  const {sql,args=[]}=typeof v==='string'?{sql:v}:v;
  const stmt=sqlite.prepare(sql);
  if(/^\s*(SELECT|WITH|PRAGMA)/i.test(sql))return {rows:stmt.all(...args)};
  const result=stmt.run(...args);
  return {rows:[],rowsAffected:result.changes,changes:result.changes};
 };
 __setTestDb({execute});
 return {sqlite};
}
async function invoke(handler,method,path,token,data){
 return new Promise((resolve,reject)=>{
  const req={method,url:path,body:data,headers:{host:'localhost',origin:'http://localhost',cookie:token?`jump_session=${token}`:''},socket:{remoteAddress:'127.0.0.1'}};
  const res={statusCode:200,setHeader(){},end(text){try{resolve({status:this.statusCode,body:JSON.parse(text)})}catch(e){reject(e)}}};
  Promise.resolve(handler(req,res)).catch(reject);
 });
}
async function seedUser(sqlite,id,username,role,password,founder=0){
 const stamp='2026-01-01T00:00:00.000Z';
 sqlite.prepare('INSERT INTO users(id,username,password_hash,role,is_founder,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,username,await hashSecret(password),role,founder,stamp,stamp);
 const token=(id==='founder'?'a':id==='admin'?'b':'c').repeat(64);
 sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,'2099-01-01T00:00:00Z',stamp);
 return token;
}

test('administrator search returns only IDs, roles and names; admin role changes require owner reauthentication',async()=>{
 const {sqlite}=setup();
 try{
  const owner=await seedUser(sqlite,'founder','Founder','owner','owner-password-long',1);
  const ordinary=await seedUser(sqlite,'admin','Regular','admin','admin-password-long');
  await seedUser(sqlite,'ordinary','Friend','user','friend-password-long');
  const result=await invoke(searchHandler,'GET','/api/admin/users?q=fr',owner);
  assert.equal(result.status,200);assert.equal(result.body.users[0].username,'Friend');
  assert.deepEqual(Object.keys(result.body.users[0]).sort(),['id','role','username']);
  assert.equal((await invoke(rolesHandler,'POST','/api/admin/roles',ordinary,{targetUserId:'ordinary',role:'owner',password:'admin-password-long',confirmed:true})).status,403);
  assert.equal((await invoke(rolesHandler,'POST','/api/admin/roles',owner,{targetUserId:'ordinary',role:'admin',password:'wrong-password',confirmed:true})).status,403);
  assert.equal(sqlite.prepare('SELECT role FROM users WHERE id=?').get('ordinary').role,'user');
  const ok=await invoke(rolesHandler,'POST','/api/admin/roles',owner,{targetUserId:'ordinary',role:'admin',password:'owner-password-long',confirmed:true});
  assert.equal(ok.status,200,JSON.stringify(ok.body));
  assert.equal(sqlite.prepare('SELECT role FROM users WHERE id=?').get('ordinary').role,'admin');
  const deny=await invoke(rolesHandler,'POST','/api/admin/roles',owner,{targetUserId:'founder',role:'user',password:'owner-password-long',confirmed:true});
  assert.equal(deny.status,409);
  assert.equal(sqlite.prepare('SELECT role FROM users WHERE id=?').get('founder').role,'owner');
 }finally{sqlite.close()}
});

test('owner role reauthentication is rate-limited to prevent password guessing',async()=>{
 const {sqlite}=setup();
 try{
  const owner=await seedUser(sqlite,'founder','Founder','owner','owner-password-long',1);
  await seedUser(sqlite,'ordinary','Friend','user','friend-password-long');
  for(let i=0;i<5;i++){
   const attempt=await invoke(rolesHandler,'POST','/api/admin/roles',owner,{targetUserId:'ordinary',role:'admin',password:'wrong-password',confirmed:true});
   assert.equal(attempt.status,403);
  }
  const sixth=await invoke(rolesHandler,'POST','/api/admin/roles',owner,{targetUserId:'ordinary',role:'admin',password:'owner-password-long',confirmed:true});
  assert.equal(sixth.status,429);
  assert.equal(sqlite.prepare('SELECT role FROM users WHERE id=?').get('ordinary').role,'user');
 }finally{sqlite.close()}
});
