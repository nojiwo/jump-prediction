import {db} from '../server/db.js';
import {handle,method,body,send,requireUser,checkOrigin,fail,now} from '../server/http.js';
const keys={theme_mode:['system','light','dark'],accent_color:['cyan','blue','green','purple','orange','pink'],prediction_input_mode:['drag','sequential'],actual_input_mode:['drag','sequential']};
export default async function(req,res){await handle(res,async()=>{
  method(req,'PATCH');checkOrigin(req);const user=await requireUser(req);const input=await body(req),entries=Object.entries(input);
  if(!entries.length||entries.length>4||entries.some(([k,v])=>!keys[k]?.includes(v)))fail(400,'設定値が正しくありません。');
  if(user.role==='user'&&entries.some(([k])=>k==='actual_input_mode'))fail(403,'管理者権限が必要です。');
  const c=await db();await c.execute({sql:`UPDATE users SET ${entries.map(([k])=>k+'=?').join(',')},updated_at=? WHERE id=?`,args:[...entries.map(x=>x[1]),now(),user.id]});
  const r=await c.execute({sql:'SELECT theme_mode,accent_color,prediction_input_mode,actual_input_mode FROM users WHERE id=?',args:[user.id]});
  send(res,200,{preferences:r.rows[0]});
})}
