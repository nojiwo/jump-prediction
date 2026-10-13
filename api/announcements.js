import {randomUUID} from 'node:crypto';
import {db} from '../server/db.js';
import {handle,method,body,send,fail,currentUser,requireUser,requireAdmin,checkOrigin,now} from '../server/http.js';
import {notifyImportant} from '../server/notifications.js';
export default async function(req,res){await handle(res,async()=>{
 const user=await currentUser(req),admin=['owner','admin'].includes(user?.role),c=await db();
 if(req.method==='GET'){
  const list=(await c.execute({sql:admin?'SELECT * FROM announcements ORDER BY pinned DESC,created_at DESC':`SELECT id,title,body_json,pinned,published_at FROM announcements WHERE status='published' ORDER BY pinned DESC,published_at DESC`,args:[]})).rows;
  return send(res,200,{announcements:list});
 }
 method(req,'POST');checkOrigin(req);requireAdmin(await requireUser(req));const v=await body(req,40000);
 const action=String(v.action||'save');let id=String(v.id||''),stamp=now();
 if(action==='delete'){
  if(!id)fail(400,'対象が指定されていません。');
  // Keep historical notification source IDs valid; deletion is explicitly permanent.
  await c.execute({sql:'DELETE FROM announcements WHERE id=?',args:[id]});return send(res,200,{ok:true});
 }
 const status=String(v.status||'draft'),title=String(v.title||'').trim();
 if(!['draft','published','hidden'].includes(status)||!title||title.length>140)fail(400,'お知らせの項目を確認してください。');
 const content=typeof v.body==='string'?v.body:JSON.stringify(v.body??'');
 if(content.length>30000)fail(413,'本文が長すぎます。');
 if(!id)id=randomUUID();
 const existing=(await c.execute({sql:'SELECT * FROM announcements WHERE id=?',args:[id]})).rows[0];
 if(existing){
  await c.execute({sql:`UPDATE announcements SET title=?,body_json=?,status=?,pinned=?,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,?) ELSE published_at END,version=version+1,updated_at=? WHERE id=?`,args:[title,content,status,v.pinned?1:0,status,stamp,stamp,id]});
 }else{
  await c.execute({sql:'INSERT INTO announcements(id,title,body_json,status,pinned,published_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)',args:[id,title,content,status,v.pinned?1:0,status==='published'?stamp:null,stamp,stamp]});
 }
 const fresh=(await c.execute({sql:'SELECT * FROM announcements WHERE id=?',args:[id]})).rows[0];
 const notified=await notifyImportant(c,fresh);
 return send(res,200,{ok:true,id,notified});
})}
