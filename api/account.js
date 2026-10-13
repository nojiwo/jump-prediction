import {db} from '../server/db.js';
import {handle,body,method,send,fail,requireUser,checkOrigin,now,cookies,sha256} from '../server/http.js';
import {verifySecret,hashSecret,validatePassword} from '../server/password.js';
/** Usernames, passwords and recovery questions require password confirmation. */
export default async function(req,res){await handle(res,async()=>{
 const u=await requireUser(req),c=await db();
 if(req.method==='GET'){
  const questions=(await c.execute({sql:'SELECT a.slot,q.id,q.question FROM user_security_answers a JOIN security_questions q ON q.id=a.question_id WHERE a.user_id=? ORDER BY a.slot',args:[u.id]})).rows;
  return send(res,200,{user:u,questions});
 }
 method(req,'POST');checkOrigin(req);const v=await body(req,6000);
 if(!['username','password','securityQuestions'].includes(v.action))fail(400,'操作が正しくありません。');
 const r=(await c.execute({sql:'SELECT password_hash FROM users WHERE id=?',args:[u.id]})).rows[0];
 if(!await verifySecret(v.currentPassword,r?.password_hash))fail(403,'現在のパスワードが正しくありません。');
 const stamp=now();
 if(v.action==='username'){
  const username=String(v.username||'').trim();if(username.length<2||username.length>40)fail(400,'ユーザー名は2〜40文字です。');
  try{await c.execute({sql:'UPDATE users SET username=?,updated_at=? WHERE id=?',args:[username,stamp,u.id]})}
  catch(e){if(String(e.message).includes('UNIQUE'))fail(409,'そのユーザー名は使われています。');throw e}
  return send(res,200,{ok:true,username});
 }
 if(v.action==='password'){
  if(!validatePassword(v.newPassword))fail(400,'新しいパスワードは10〜128文字です。');
  if(v.newPassword===v.currentPassword)fail(400,'現在と異なるパスワードを指定してください。');
  const hashed=await hashSecret(v.newPassword);
  const tx=await c.transaction('write');try{
   await tx.execute({sql:'UPDATE users SET password_hash=?,updated_at=? WHERE id=?',args:[hashed,stamp,u.id]});
   await tx.execute({sql:'DELETE FROM sessions WHERE user_id=?',args:[u.id]});await tx.commit();
  }catch(e){await tx.rollback();throw e}
  res.setHeader('Set-Cookie','jump_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  return send(res,200,{ok:true,loginRequired:true});
 }
 const q1=Number(v.question1),q2=Number(v.question2),a1=String(v.answer1||'').trim(),a2=String(v.answer2||'').trim();
 if(!Number.isSafeInteger(q1)||!Number.isSafeInteger(q2)||q1===q2||a1.length<2||a2.length<2||a1.length>128||a2.length>128)fail(400,'異なる質問を2つ選び、回答を入力してください。');
 const known=(await c.execute({sql:'SELECT id FROM security_questions WHERE id IN (?,?)',args:[q1,q2]})).rows;
 if(known.length!==2)fail(400,'秘密の質問が正しくありません。');
 const [h1,h2]=await Promise.all([hashSecret(a1),hashSecret(a2)]);
 const tx=await c.transaction('write');try{
  await tx.execute({sql:'DELETE FROM user_security_answers WHERE user_id=?',args:[u.id]});
  await tx.execute({sql:'INSERT INTO user_security_answers(user_id,slot,question_id,answer_hash) VALUES(?,?,?,?)',args:[u.id,1,q1,h1]});
  await tx.execute({sql:'INSERT INTO user_security_answers(user_id,slot,question_id,answer_hash) VALUES(?,?,?,?)',args:[u.id,2,q2,h2]});
  await tx.execute({sql:'UPDATE users SET updated_at=? WHERE id=?',args:[stamp,u.id]});
  await tx.commit();return send(res,200,{ok:true});
 }catch(e){await tx.rollback();throw e}
})}
