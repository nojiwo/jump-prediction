import {db} from '../server/db.js';
import {handle,body,method,send,fail,requireUser,checkOrigin,now} from '../server/http.js';
export default async function(req,res){await handle(res,async()=>{
 const u=await requireUser(req),c=await db();
 if(req.method==='GET'){
  const rows=(await c.execute({sql:'SELECT id,kind,source_id,payload_json,created_at,read_at FROM notifications WHERE user_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 100',args:[u.id,now()]})).rows;
  return send(res,200,{notifications:rows.map(x=>({...x,payload:JSON.parse(x.payload_json||'{}'),payload_json:undefined}))});
 }
 method(req,'POST');checkOrigin(req);const v=await body(req);
 if(v.action!=='readAll'&&v.action!=='read')fail(400,'操作が正しくありません。');
 if(v.action==='read'){
  if(typeof v.id!=='string')fail(400,'通知を指定してください。');
  await c.execute({sql:'UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE id=? AND user_id=?',args:[now(),v.id,u.id]});
 }else await c.execute({sql:'UPDATE notifications SET read_at=COALESCE(read_at,?) WHERE user_id=? AND read_at IS NULL',args:[now(),u.id]});
 send(res,200,{ok:true});
})}
