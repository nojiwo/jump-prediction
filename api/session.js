import {currentUser,handle,method,send} from '../server/http.js';
export default async function(req,res){await handle(res,async()=>{method(req,'GET');const user=await currentUser(req);send(res,200,{user:user||null})})}
