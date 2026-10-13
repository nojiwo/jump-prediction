import {db} from '../../server/db.js';
import {handle,method,send,fail,requireUser,requireAdmin} from '../../server/http.js';
export default async function(req,res){await handle(res,async()=>{
 method(req,'GET');requireAdmin(await requireUser(req));const c=await db();const q=new URL(req.url,'https://example.invalid').searchParams.get('q')||'';
 if(q.length>60)fail(400,'検索文字が長すぎます。');
 const found=(await c.execute({sql:'SELECT id,username,role FROM users WHERE username LIKE ? ESCAPE \'\\\' ORDER BY username LIMIT 100',args:['%'+q.replace(/[\\%_]/g,'\\$&')+'%']})).rows;
 send(res,200,{users:found});
})}
