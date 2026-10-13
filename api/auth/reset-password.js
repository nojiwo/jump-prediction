import {db} from '../../server/db.js';
import {handle,method,body,send,fail,ip,consumeRateLimit,checkOrigin,now} from '../../server/http.js';
import {hashSecret,verifySecret,validatePassword} from '../../server/password.js';
export default async function(req,res){await handle(res,async()=>{
  method(req,'POST');checkOrigin(req);const v=await body(req);const username=String(v.username||'').trim();
  await consumeRateLimit('resetp:'+ip(req)+':'+username.toLowerCase(),5,60*60*1000);
  if(!validatePassword(v.newPassword))fail(400,'新しいパスワードは10〜128文字で入力してください。');
  const c=await db();const record=(await c.execute({sql:'SELECT id FROM users WHERE username=? COLLATE NOCASE',args:[username]})).rows[0];
  if(!record)fail(401,'秘密の質問の回答を確認できませんでした。');
  const ans=(await c.execute({sql:'SELECT slot,question_id,answer_hash FROM user_security_answers WHERE user_id=? ORDER BY slot',args:[record.id]})).rows;
  if(ans.length!==2||ans[0].question_id!==Number(v.question1)||ans[1].question_id!==Number(v.question2))fail(401,'秘密の質問の回答を確認できませんでした。');
  const answers=[v.answer1,v.answer2].map(x=>String(x||'').trim());
  if(!await verifySecret(answers[0],ans[0].answer_hash)||!await verifySecret(answers[1],ans[1].answer_hash))fail(401,'秘密の質問の回答を確認できませんでした。');
  const hashed=await hashSecret(v.newPassword);
  await c.batch([
    {sql:'UPDATE users SET password_hash=?,updated_at=? WHERE id=?',args:[hashed,now(),record.id]},
    {sql:'DELETE FROM sessions WHERE user_id=?',args:[record.id]}
  ],'write');
  send(res,200,{ok:true,message:'パスワードを更新しました。もう一度ログインしてください。'});
})}
