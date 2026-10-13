import {db} from '../../server/db.js';
import {handle,method,send} from '../../server/http.js';
export default async function(req,res){await handle(res,async()=>{
  method(req,'GET');const c=await db();const r=await c.execute('SELECT id,question FROM security_questions ORDER BY id');send(res,200,{questions:r.rows});
})}
