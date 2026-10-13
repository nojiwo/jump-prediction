import {db} from '../../server/db.js';
import {handle,method,send,ip,consumeRateLimit} from '../../server/http.js';
export default async function(req,res){await handle(res,async()=>{
  method(req,'GET');await consumeRateLimit('resetq:'+ip(req),25);
  const username=String(new URL(req.url,'https://local.invalid').searchParams.get('username')||'').trim();
  const c=await db();const result=await c.execute({sql:`SELECT q.slot,sq.id,sq.question FROM users u JOIN user_security_answers q ON q.user_id=u.id
    JOIN security_questions sq ON sq.id=q.question_id WHERE u.username=? COLLATE NOCASE ORDER BY q.slot`,args:[username]});
  // Deliberately requires a valid account to show which questions to answer; requests rate-limited.
  if(result.rows.length!==2)send(res,404,{error:'このアカウントの質問を確認できませんでした。'});
  else send(res,200,{questions:result.rows.map(x=>({slot:x.slot,id:x.id,question:x.question}))});
})}
