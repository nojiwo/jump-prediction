import {randomUUID} from 'node:crypto';
import {db} from '../server/db.js';
import {handle,body,method,send,fail,requireUser,requireAdmin,checkOrigin,now} from '../server/http.js';
import {enqueue} from '../server/notifications.js';
const query=async(c,sql,args=[]) => (await c.execute({sql,args})).rows;
export default async function(req,res){await handle(res,async()=>{
 const u=await requireUser(req),admin=['admin','owner'].includes(u.role),c=await db();
 if(req.method==='GET'){
  const id=new URL(req.url,'https://example.invalid').searchParams.get('id');
  if(id){
   const inquiry=(await query(c,'SELECT * FROM inquiries WHERE id=?',[id]))[0];
   if(!inquiry||!admin&&inquiry.user_id!==u.id)fail(404,'お問い合わせがありません。');
   const messages=await query(c,`SELECT m.id,m.body,m.sender_user_id,m.created_at,CASE WHEN u.role IN ('admin','owner') THEN '運営' ELSE u.username END AS sender
    FROM inquiry_messages m JOIN users u ON u.id=m.sender_user_id WHERE m.inquiry_id=? ORDER BY m.created_at,m.id`,[id]);
   return send(res,200,{inquiry,messages});
  }
  const items=await query(c,admin?'SELECT i.*,u.username FROM inquiries i JOIN users u ON u.id=i.user_id ORDER BY i.updated_at DESC':'SELECT * FROM inquiries WHERE user_id=? ORDER BY updated_at DESC',admin?[]:[u.id]);
  return send(res,200,{inquiries:items});
 }
 method(req,'POST');checkOrigin(req);const v=await body(req);const action=String(v.action||'');const stamp=now();
 if(action==='create'){
  const title=String(v.title||'').trim(),message=String(v.message||'').trim();
  if(!title||title.length>120||!message||message.length>6000)fail(400,'お問い合わせの入力を確認してください。');
  const id=randomUUID();const admins=await query(c,"SELECT id FROM users WHERE role IN ('admin','owner')");
  const tx=await c.transaction('write');try{
   await tx.execute({sql:'INSERT INTO inquiries(id,user_id,title,status,created_at,updated_at) VALUES(?,?,?,?,?,?)',args:[id,u.id,title,'new',stamp,stamp]});
   await tx.execute({sql:'INSERT INTO inquiry_messages(id,inquiry_id,sender_user_id,body,created_at) VALUES(?,?,?,?,?)',args:[randomUUID(),id,u.id,message,stamp]});
   for(const person of admins)await enqueue(tx,person.id,'inquiry',id+':new',{title});
   await tx.commit();return send(res,201,{ok:true,id});
  }catch(e){await tx.rollback();throw e}
 }
 const inquiry=(await query(c,'SELECT * FROM inquiries WHERE id=?',[v.id]))[0];
 if(!inquiry||!admin&&inquiry.user_id!==u.id)fail(404,'お問い合わせがありません。');
 if(action==='status'){
  requireAdmin(u);
  if(!['new','in_progress','done'].includes(v.status))fail(400,'状態が正しくありません。');
  await c.execute({sql:'UPDATE inquiries SET status=?,updated_at=? WHERE id=?',args:[v.status,stamp,v.id]});return send(res,200,{ok:true});
 }
 if(action!=='reply')fail(400,'操作が正しくありません。');
 const message=String(v.message||'').trim();if(!message||message.length>6000)fail(400,'返信を入力してください。');
 const next=admin?'in_progress':inquiry.status==='done'?'in_progress':inquiry.status;
 const people=admin?[{id:inquiry.user_id}]:await query(c,"SELECT id FROM users WHERE role IN ('admin','owner')");
 const tx=await c.transaction('write');try{
  const messageId=randomUUID();await tx.execute({sql:'INSERT INTO inquiry_messages(id,inquiry_id,sender_user_id,body,created_at) VALUES(?,?,?,?,?)',args:[messageId,v.id,u.id,message,stamp]});
  await tx.execute({sql:'UPDATE inquiries SET status=?,updated_at=? WHERE id=?',args:[next,stamp,v.id]});
  for(const recipient of people)if(recipient.id!==u.id)await enqueue(tx,recipient.id,'inquiry',messageId,{inquiryId:v.id,title:inquiry.title});
  await tx.commit();return send(res,200,{ok:true});
 }catch(e){await tx.rollback();throw e}
})}
