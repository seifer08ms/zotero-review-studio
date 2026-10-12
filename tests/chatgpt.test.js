/* No external calls: tests official OAuth PKCE, signed OIDC validation, secure
 * storage, documented Responses streaming contract, refresh and revocation. */
'use strict';
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const crypto=webcrypto;
const now=()=>Math.floor(Date.now()/1000);
const encode=v=>Buffer.from(typeof v==='string'?v:JSON.stringify(v)).toString('base64url');
function form(body){return Object.fromEntries(new URLSearchParams(body));}
async function main(){
 const keys=await crypto.subtle.generateKey({name:'RSASSA-PKCS1-v1_5',modulusLength:2048,
  publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
 const jwk=await crypto.subtle.exportKey('jwk',keys.publicKey);jwk.kid='kid1';jwk.alg='RS256';jwk.use='sig';
 let authorize=null,listener=null,loopbackReply='',lastPayload=null,refreshCount=0;
 const records=[];
 global.Services={logins:{findLogins(host,action,realm){return records.filter(x=>x.hostname===host&&x.realm===realm)},
  addLogin(x){records.push(x)},modifyLogin(old,next){Object.assign(old,next)},removeLogin(x){records.splice(records.indexOf(x),1)}}};
 class Login{init(hostname,_,realm,username,password){Object.assign(this,{hostname,realm,username,password})}}
 const server={port:16473,init(_p,local){assert.equal(local,true)},asyncListen(v){listener=v},close(){}};
 global.Components={classes:{
  '@mozilla.org/login-manager/loginInfo;1':{createInstance:()=>new Login()},
  '@mozilla.org/network/server-socket;1':{createInstance:()=>server},
  '@mozilla.org/network/input-stream-pump;1':{createInstance:()=>({init(s){this.source=s},asyncRead(cb){const input={bytes:this.source.bytes};
    cb.onStartRequest?.();cb.onDataAvailable(null,input,0,input.bytes.length);cb.onStopRequest();}})},
  '@mozilla.org/scriptableinputstream;1':{createInstance:()=>({init(s){this.source=s},read(n){return this.source.bytes.slice(0,n)}})},
 },interfaces:{nsILoginInfo:1,nsIServerSocket:2,nsIInputStreamPump:3,nsIScriptableInputStream:4}};
 global.ChromeUtils={generateQI:()=>()=>({})};
 async function token(nonce){
  const header=encode({alg:'RS256',typ:'JWT',kid:'kid1'});
  const payload=encode({iss:'https://auth.openai.com',aud:'oaiapp_mock123',sub:'user-test',
   email:'tester@example.com',nonce,exp:now()+3600,iat:now()});
  const data=header+'.'+payload;
  const sig=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',keys.privateKey,new TextEncoder().encode(data));
  return data+'.'+Buffer.from(sig).toString('base64url');
 }
 const data={};const zotero={Prefs:{get:k=>data[k],set:(k,v)=>data[k]=v},
  launchURL:url=>{
    authorize=new URL(url);
    assert.equal(authorize.origin,'https://auth.openai.com');
    assert.equal(authorize.searchParams.get('client_id'),'dynamic_agent_client');
    assert.equal(authorize.searchParams.get('code_challenge_method'),'S256');
    assert(authorize.searchParams.get('code_challenge').length>30);
    assert.equal(authorize.searchParams.get('scope').includes('chatgpt.tokens.use.direct'),true);
    const params=new URLSearchParams({code:'temp-oauth-code',state:authorize.searchParams.get('state'),client_id:'oaiapp_mock123'});
    setImmediate(()=>listener.onSocketAccepted(null,{
      openInputStream(){return {bytes:`GET /auth/callback?${params.toString()} HTTP/1.1\r\nHost: 127.0.0.1:16473\r\n\r\n`}},
      openOutputStream(){return {write(text){loopbackReply+=text},close(){}}},
    }));
  },
  HTTP:{request:async(method,url,options={})=>{
    if(url.endsWith('/.well-known/jwks.json'))return {responseText:JSON.stringify({keys:[jwk]})};
    if(url.endsWith('/.well-known/openid-configuration'))return {responseText:JSON.stringify({revocation_endpoint:'https://auth.openai.com/oauth/revoke'})};
    if(url.endsWith('/oauth/token')){
      const req=form(options.body);
      if(req.grant_type==='authorization_code'){
        assert.equal(req.code_verifier.length>=43,true);
        assert.equal(req.client_id,'oaiapp_mock123');
        assert.equal(req.redirect_uri,authorize.searchParams.get('redirect_uri'));
        assert.equal(req.resource,'https://api.openai.com/v1');
        return {responseText:JSON.stringify({access_token:'initial-access',refresh_token:'refresh-1',id_token:await token(authorize.searchParams.get('nonce')),
          expires_in:3600,scope:'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct'})};
      }
      assert.equal(req.grant_type,'refresh_token');refreshCount++;
      return {responseText:JSON.stringify({access_token:'renewed-access',refresh_token:'refresh-2',expires_in:3600})};
    }
    if(url.endsWith('/v1/models'))return {responseText:JSON.stringify({models:[{slug:'gpt-6.1-sol',visibility:'list',display_name:'GPT 6.1 Sol'}]})};
    if(url.endsWith('/v1/responses')){
      assert.equal(options.headers.Authorization,'Bearer renewed-access');
      lastPayload=JSON.parse(options.body);
      return {responseText:'event: response.output_text.delta\ndata: {"delta":"Hello "}\n\nevent: response.output_text.delta\ndata: {"delta":"world"}\n\nevent: response.completed\ndata: {"response":{"status":"completed","output":[]}}\n\n'};
    }
    if(url.endsWith('/oauth/revoke'))return {responseText:''};
    throw Error('Unexpected request: '+url);
  }}
 };
 const requestsWithProxy=[];
 global.ReviewNetwork={request:(z,method,url,options,profile)=>{requestsWithProxy.push({url,mode:profile.proxyMode});return z.HTTP.request(method,url,options);}};
 const proxy={proxyMode:'custom',model:'gpt-6.1-sol',proxyHost:'127.0.0.1',proxyPort:1080,proxyType:'socks5'};
 const m=require('../addon/content/review-chatgpt.js');m.configure(zotero);
 assert.equal(m.isConnected(),false);
 assert.throws(()=>m.checkScope('openid email'),/未授权/);
 assert.throws(()=>m.parseEventStream('event: response.output_text.delta\ndata: {"delta":"x"}\n\n'),/完整/);
 await m.signIn(proxy);
 assert.equal(m.isConnected(),true);assert.equal(m.status().email,'tester@example.com');
 assert(loopbackReply.includes('200 OK'));
 assert.equal(records.length,1);assert(records[0].password.includes('initial-access'));
 assert(!JSON.stringify(data).includes('initial-access'),'OAuth token must never enter Zotero prefs');
 await m.renew(proxy);assert.equal(refreshCount,1);
 const models=await m.listModels(proxy);assert.equal(models[0].id,'gpt-6.1-sol');
 const out=await m.request([{role:'system',content:'System instruction'},{role:'user',content:'Research text'}],proxy);
 assert.equal(out,'Hello world');
 assert.deepEqual(Object.keys(lastPayload).sort(),['input','instructions','model','store','stream'].sort());
 assert.equal(lastPayload.store,false);assert.equal(lastPayload.stream,true);
 assert.equal(lastPayload.instructions,'System instruction');
 assert.equal(lastPayload.input[0].content,'Research text');
 await m.request([{role:'user',content:'Short response'}],proxy,123);
 assert.equal(lastPayload.max_output_tokens,123);
 await m.signOut(proxy);assert.equal(m.isConnected(),false);assert.equal(records.length,0);
 for(const path of ['/oauth/token','/.well-known/jwks.json','/v1/models','/v1/responses']) {
   assert(requestsWithProxy.some(x=>x.url.includes(path)&&x.mode==='custom'), 'OAuth/model calls must inherit per-profile proxy: '+path);
 }
 delete global.ReviewNetwork;
 console.log('Official OAuth PKCE, OIDC signature, secure login, refresh, streaming Responses and logout passed');
}
main().catch(e=>{console.error(e);process.exitCode=1});
