import test from 'node:test';
import assert from 'node:assert/strict';
import {checkOrigin,cookieHeader} from '../server/http.js';

const req=(origin,extra={})=>({headers:{host:'example.vercel.app',...(origin===undefined?{}:{origin}),...extra}});

test('cookie-authenticated writes require a same-origin browser Origin',()=>{
 assert.doesNotThrow(()=>checkOrigin(req('https://example.vercel.app',{'sec-fetch-site':'same-origin'})));
 assert.throws(()=>checkOrigin(req(undefined)),{status:403});
 assert.throws(()=>checkOrigin(req('https://evil.example')),{status:403});
 assert.throws(()=>checkOrigin(req('null')),{status:403});
 assert.throws(()=>checkOrigin(req('http://example.vercel.app')),{status:403});
 assert.throws(()=>checkOrigin(req('https://example.vercel.app',{'sec-fetch-site':'cross-site'})),{status:403});
 assert.throws(()=>checkOrigin(req('https://example.vercel.app',{'sec-fetch-site':'same-site'})),{status:403});
});

test('local dev hosts are accepted while hosted writes require HTTPS',()=>{
 assert.doesNotThrow(()=>checkOrigin({headers:{host:'localhost:3000',origin:'http://localhost:3000'}}));
 assert.doesNotThrow(()=>checkOrigin({headers:{host:'127.0.0.1:3000',origin:'http://127.0.0.1:3000'}}));
 assert.throws(()=>checkOrigin({headers:{host:'example.com',origin:'http://example.com'}}),{status:403});
});

test('session cookie is HttpOnly, Lax, scoped to the app and Secure in production',()=>{
 const old=process.env.NODE_ENV;
 try{
  process.env.NODE_ENV='production';
  const h=cookieHeader('abc');
  assert.match(h,/HttpOnly/);assert.match(h,/SameSite=Lax/);assert.match(h,/Secure/);
  assert.match(h,/Path=\//);
 }finally{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old}
});
