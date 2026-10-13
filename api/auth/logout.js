import {db} from '../../server/db.js';
import {handle,method,send,cookies,sha256,cookieHeader,checkOrigin} from '../../server/http.js';
export default async function(req,res){await handle(res,async()=>{
  method(req,'POST');checkOrigin(req);const token=cookies(req).jump_session;
  if(token){const c=await db();await c.execute({sql:'DELETE FROM sessions WHERE token_hash=?',args:[sha256(token)]})}
  res.setHeader('Set-Cookie',cookieHeader('',0));send(res,200,{ok:true});
})}
