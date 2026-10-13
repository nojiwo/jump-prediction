import {scrypt as scryptCb,randomBytes,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCb);
const N=16384,r=8,p=1,len=64;
export async function hashSecret(raw){
  if(typeof raw!=='string'||raw.length<1||raw.length>256)throw new Error('invalid secret');
  const salt=randomBytes(16).toString('hex');
  const key=await scrypt(raw.normalize('NFKC'),Buffer.from(salt,'hex'),len,{N,r,p,maxmem:32*1024*1024});
  return `scrypt$${N}$${r}$${p}$${salt}$${key.toString('hex')}`;
}
export async function verifySecret(raw,encoded){
  if(typeof raw!=='string'||typeof encoded!=='string')return false;
  const parts=encoded.split('$');
  if(parts.length!==6||parts[0]!=='scrypt')return false;
  let [,,rr,pp,salt,digest]=parts;const iterations=Number(parts[1]);const rVal=Number(rr),pVal=Number(pp);
  if(iterations!==N||rVal!==r||pVal!==p||!/^[0-9a-f]{32}$/.test(salt)||!/^[0-9a-f]{128}$/.test(digest))return false;
  const a=await scrypt(raw.normalize('NFKC'),Buffer.from(salt,'hex'),len,{N,r,p,maxmem:32*1024*1024});
  return timingSafeEqual(a,Buffer.from(digest,'hex'));
}
export function validatePassword(p){return typeof p==='string'&&p.length>=10&&p.length<=128}
