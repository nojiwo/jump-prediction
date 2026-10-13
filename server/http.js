import {createHash, timingSafeEqual, randomBytes} from 'node:crypto';
import { db } from './db.js';
export const now = () => new Date().toISOString();
export function send(res, status, data){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.end(JSON.stringify(data));
}
export function error(res,e){
  if (e?.status) return send(res,e.status,{error:e.message});
  console.error('API failure',e?.message || e);
  return send(res,500,{error:'サーバーでエラーが発生しました。'});
}
export function fail(status,message){const e=new Error(message);e.status=status;throw e}
export function method(req,m){if(req.method!==m)fail(405,'許可されていない操作です。')}
export async function body(req,limit=12_000){
  if(req.body !== undefined){const data=typeof req.body==='string'?JSON.parse(req.body):req.body;return data||{}}
  let chunks=[],size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)fail(413,'入力が大きすぎます。');chunks.push(chunk)}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{fail(400,'JSON形式が正しくありません。')}
}
export function checkOrigin(req){
  // SameSite cookies are primary mitigation, Origin check is defense in depth for writes.
  const origin=req.headers.origin;
  // Require the browser's Origin for cookie-authenticated JSON writes.
  // Rejecting missing Origin also blocks forged plain-form POST requests that
  // do not send the header. Cron is a token-authorized GET and is unaffected.
  if(typeof origin!=='string'||!origin)fail(403,'書き込みにはOriginヘッダーが必要です。');
  const hostname=req.headers.host;
  if(typeof hostname!=='string'||!hostname)fail(403,'無効なリクエストです。');
  let parsed;try{parsed=new URL(origin)}catch{fail(403,'無効なOriginです。')}
  if(parsed.host!==hostname || (parsed.protocol!=='https:' && !['localhost','127.0.0.1'].includes(parsed.hostname)))fail(403,'異なるサイトからの書き込みはできません。');
  if(req.headers['sec-fetch-site']&&!['same-origin','none'].includes(req.headers['sec-fetch-site']))fail(403,'異なるサイトからの書き込みはできません。');
}
export function cookies(req){const value=req.headers.cookie||'';return Object.fromEntries(value.split(';').map(x=>x.trim()).filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),x.slice(i+1)]}))}
export const sha256=s=>createHash('sha256').update(s).digest('hex');
export function cookieHeader(token,maxAge=60*60*24*30){
  const secure = process.env.NODE_ENV==='production' ? '; Secure':'';
  return `jump_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure}`;
}
export async function currentUser(req){
  const token=cookies(req).jump_session;
  if(!token||!/^[0-9a-f]{64}$/.test(token))return null;
  const client=await db();
  const r=await client.execute({sql:`SELECT u.id,u.username,u.role,u.prediction_input_mode,u.actual_input_mode,u.theme_mode,u.accent_color
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`,args:[sha256(token),now()]});
  return r.rows[0]||null;
}
export async function requireUser(req){const u=await currentUser(req);if(!u)fail(401,'ログインが必要です。');
 const settings=(await (await db()).execute({sql:'SELECT maintenance,maintenance_message FROM site_settings WHERE id=1'})).rows[0];
 if(settings?.maintenance&&u.role!=='owner')fail(503,settings.maintenance_message||'メンテナンス中です。');
 return u}
export function requireAdmin(u){if(!['admin','owner'].includes(u.role))fail(403,'管理者権限が必要です。')}
export async function createSession(res,userId){
  const token=randomBytes(32).toString('hex'); const c=await db();const created=now();
  const expires=new Date(Date.now()+30*24*60*60*1000).toISOString();
  await c.execute({sql:'INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)',args:[sha256(token),userId,expires,created]});
  res.setHeader('Set-Cookie',cookieHeader(token));
}
export async function consumeRateLimit(key, limit=8,windowMs=15*60*1000){
  const c=await db(),hash=sha256(key),t=Date.now(),date=now();
  const found=(await c.execute({sql:'SELECT * FROM auth_rate_limits WHERE key_hash=?',args:[hash]})).rows[0];
  if(found?.blocked_until && Date.parse(String(found.blocked_until))>t)fail(429,'試行回数が多すぎます。しばらくしてからお試しください。');
  const active=found && t-Date.parse(String(found.window_started_at))<windowMs;
  const count=active?Number(found.failure_count)+1:1;
  await c.execute({sql:`INSERT INTO auth_rate_limits(key_hash,failure_count,window_started_at,blocked_until) VALUES(?,?,?,?)
    ON CONFLICT(key_hash) DO UPDATE SET failure_count=excluded.failure_count,window_started_at=excluded.window_started_at,blocked_until=excluded.blocked_until`,args:[hash,count,active?found.window_started_at:date,count>limit?new Date(t+windowMs).toISOString():null]});
  if(count>limit)fail(429,'試行回数が多すぎます。しばらくしてからお試しください。');
}
export async function clearRateLimit(key){const c=await db();await c.execute({sql:'DELETE FROM auth_rate_limits WHERE key_hash=?',args:[sha256(key)]});}
export function ip(req){return String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim().slice(0,80)}
export async function handle(res,fn){try{await fn()}catch(e){error(res,e)}}
