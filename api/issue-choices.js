import {handle,method,send,fail} from '../server/http.js';
export default async function(req,res){await handle(res,async()=>{
  method(req,'GET');const y=Number(new URL(req.url,'https://local.invalid').searchParams.get('year'));
  if(!Number.isInteger(y)||y<2021||y>9999)fail(400,'年度が正しくありません。');
  const options=[];for(let i=1;i<=55;i++){
    options.push({code:`${y}${String(i).padStart(2,'0')}00`,label:`${i}号`});
    if(i<55)options.push({code:`${y}${String(i).padStart(2,'0')}${String(i+1).padStart(2,'0')}`,label:`${i}・${i+1}合併号`});
  }send(res,200,{year:y,options});
})}
