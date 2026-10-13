import {db} from '../../server/db.js';
import {handle,body,method,send,fail,requireUser,checkOrigin,now} from '../../server/http.js';
export default async function(req,res){await handle(res,async()=>{
 const u=await requireUser(req);if(u.role!=='owner')fail(403,'スーパー管理者のみ操作できます。');const c=await db();
 if(req.method==='GET'){
  const x=(await c.execute({sql:'SELECT * FROM site_settings WHERE id=1'})).rows[0];return send(res,200,{settings:x||null});
 }
 method(req,'POST');checkOrigin(req);const v=await body(req);
 const siteName=String(v.siteName||'ジャンプ掲載順予想').trim();const message=String(v.message||'メンテナンス中です。');
 if(!siteName||siteName.length>80||message.length>2000||typeof v.maintenance!=='boolean')fail(400,'設定を確認してください。');
 await c.execute({sql:`INSERT INTO site_settings(id,site_name,maintenance,maintenance_message,updated_at) VALUES(1,?,?,?,?) ON CONFLICT(id) DO UPDATE SET site_name=excluded.site_name,maintenance=excluded.maintenance,maintenance_message=excluded.maintenance_message,updated_at=excluded.updated_at`,args:[siteName,v.maintenance?1:0,message,now()]});
 send(res,200,{ok:true});
})}
