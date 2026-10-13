import {handle,method,send} from '../server/http.js';
export default async function(req,res){await handle(res,async()=>{
  method(req,'GET');send(res,200,{ok:true,app:'jump-prediction-pwa',stage:'implementation-foundation'});
})}
