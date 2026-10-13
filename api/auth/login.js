import {db} from '../../server/db.js';
import {handle,method,body,send,fail,ip,consumeRateLimit,checkOrigin,createSession,clearRateLimit} from '../../server/http.js';
import {verifySecret} from '../../server/password.js';
export default async function(req,res){await handle(res,async()=>{
  method(req,'POST');checkOrigin(req);const v=await body(req),username=String(v.username||'').trim(),password=String(v.password||'');
  await consumeRateLimit('login:'+ip(req)+':'+username.toLowerCase(),8);
  const c=await db();const found=(await c.execute({sql:'SELECT * FROM users WHERE username=? COLLATE NOCASE',args:[username]})).rows[0];
  const valid=found&&await verifySecret(password,found.password_hash);
  if(!valid)fail(401,'ユーザー名またはパスワードが違います。');
 const settings=(await c.execute({sql:'SELECT maintenance,maintenance_message FROM site_settings WHERE id=1'})).rows[0];
 if(settings?.maintenance && found.role!=='owner')fail(503,settings.maintenance_message||'メンテナンス中です。');
  await clearRateLimit('login:'+ip(req)+':'+username.toLowerCase());
  await createSession(res,found.id);
  const {id,role,prediction_input_mode,actual_input_mode,theme_mode,accent_color}=found;
  send(res,200,{user:{id,username:found.username,role,prediction_input_mode,actual_input_mode,theme_mode,accent_color}});
})}
