import {randomUUID} from 'node:crypto';
import {db} from '../../server/db.js';
import {handle,method,body,send,fail,ip,consumeRateLimit,checkOrigin,now,createSession} from '../../server/http.js';
import {hashSecret,validatePassword} from '../../server/password.js';
export default async function(req,res){await handle(res,async()=>{
  method(req,'POST');checkOrigin(req);
  await consumeRateLimit('signup:'+ip(req),5,60*60*1000);
  const v=await body(req);
  const username=String(v.username||'').trim();
  if(username.length<2||username.length>40)fail(400,'ユーザー名は2〜40文字で入力してください。');
  if(!validatePassword(v.password))fail(400,'パスワードは10〜128文字で入力してください。');
  const q1=Number(v.question1),q2=Number(v.question2),a1=String(v.answer1||'').trim(),a2=String(v.answer2||'').trim();
  if(!Number.isSafeInteger(q1)||!Number.isSafeInteger(q2)||q1===q2||a1.length<2||a2.length<2||a1.length>128||a2.length>128)fail(400,'異なる質問2つと回答を指定してください。');
  const c=await db();
  const maintenance=(await c.execute({sql:'SELECT maintenance FROM site_settings WHERE id=1'})).rows[0];
  if(maintenance?.maintenance)fail(503,'メンテナンス中は新規登録できません。');
  const existing=await c.execute({sql:'SELECT id FROM security_questions WHERE id IN (?,?)',args:[q1,q2]});
  if(existing.rows.length!==2)fail(400,'無効な秘密の質問です。');
  const id=randomUUID(),created=now();
  const [pwd,h1,h2]=await Promise.all([hashSecret(v.password),hashSecret(a1),hashSecret(a2)]);
  try{await c.batch([
    {sql:'INSERT INTO users(id,username,password_hash,role,created_at,updated_at) VALUES(?,?,?,?,?,?)',args:[id,username,pwd,'user',created,created]},
    {sql:'INSERT INTO user_security_answers(user_id,slot,question_id,answer_hash) VALUES(?,?,?,?)',args:[id,1,q1,h1]},
    {sql:'INSERT INTO user_security_answers(user_id,slot,question_id,answer_hash) VALUES(?,?,?,?)',args:[id,2,q2,h2]}
  ],'write')}catch(e){if(String(e.message).includes('UNIQUE'))fail(409,'ユーザー名はすでに使用されています。');throw e}
  await createSession(res,id);send(res,201,{user:{id,username,role:'user',theme_mode:'system',accent_color:'cyan',prediction_input_mode:'drag',actual_input_mode:'sequential'}});
})}
