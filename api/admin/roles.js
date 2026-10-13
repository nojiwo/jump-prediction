import {db} from '../../server/db.js';
import {handle,body,method,send,fail,requireUser,checkOrigin,now,consumeRateLimit,clearRateLimit} from '../../server/http.js';
import {verifySecret} from '../../server/password.js';
export default async function(req,res){await handle(res,async()=>{
 const u=await requireUser(req);if(u.role!=='owner')fail(403,'スーパー管理者のみ変更できます。');const c=await db();
 if(req.method==='GET'){
  const admins=(await c.execute({sql:"SELECT id,username,role,is_founder FROM users WHERE role IN ('admin','owner') ORDER BY is_founder DESC,username"})).rows;
  return send(res,200,{admins});
 }
 method(req,'POST');checkOrigin(req);const v=await body(req);
 if(!['user','admin','owner'].includes(v.role)||typeof v.targetUserId!=='string'||!v.targetUserId||!v.confirmed)fail(400,'権限と確認操作を指定してください。');
 // A stolen owner session must not allow unlimited guesses at the reauthentication password.
 const rateKey='role-reauth:'+u.id;await consumeRateLimit(rateKey,5,15*60*1000);
 const actor=(await c.execute({sql:'SELECT password_hash FROM users WHERE id=?',args:[u.id]})).rows[0];
 if(!await verifySecret(v.password,actor?.password_hash))fail(403,'パスワードの再確認に失敗しました。');
 const target=(await c.execute({sql:'SELECT is_founder FROM users WHERE id=?',args:[v.targetUserId]})).rows[0];
 if(!target)fail(404,'ユーザーが存在しません。');if(target.is_founder&&v.role!=='owner')fail(409,'創設者を降格できません。');
 await c.execute({sql:'UPDATE users SET role=?,updated_at=? WHERE id=?',args:[v.role,now(),v.targetUserId]});
 await clearRateLimit(rateKey);send(res,200,{ok:true});
})}
