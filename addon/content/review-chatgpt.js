/* Official Sign in with ChatGPT for open-source apps (Authorization Code + PKCE).
 * Uses a loopback OAuth callback, validates signed OIDC identity against OpenAI JWKS,
 * stores tokens only in Gecko's encrypted Login Manager, and uses public Responses API.
 * NEVER reads ChatGPT/Codex cookies or contacts private ChatGPT backend APIs.
 */
var ReviewChatGPT = (function () {
  'use strict';
  const ORIGIN='https://auth.openai.com';
  const RESOURCE='https://api.openai.com/v1';
  const AUTHORIZE=ORIGIN+'/api/accounts/authorize';
  const TOKEN=ORIGIN+'/api/accounts/oauth/token';
  const JWKS=ORIGIN+'/.well-known/jwks.json';
  const HOST='https://zotero-review-studio.localhost';
  const REALM='Zotero Review Studio — ChatGPT OAuth';
  const USERNAME='chatgpt-plan';
  const SCOPE='openid profile email offline_access resource.invoke chatgpt.tokens.use.direct';
  const SCOPES_REQUIRED=['resource.invoke','chatgpt.tokens.use.direct'];
  let zotero=null, current=null, refreshPromise=null, signInPromise=null;

  function configure(z){zotero=z;return current;}
  function isConnected(){return !!(current?.access_token && current?.refresh_token && current?.client_id);}
  function status(){return {connected:isConnected(),email:current?.email||'',expiresAt:current?.expiresAt||0};}
  function randomURLString(byteCount=32){
    const bytes=new Uint8Array(byteCount);
    crypto.getRandomValues(bytes);
    return base64url(bytes);
  }
  function base64url(bytes){
    let result='';for(const b of bytes)result+=String.fromCharCode(b);
    return btoa(result).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  }
  function decodeB64URL(s){
    const str=String(s).replace(/-/g,'+').replace(/_/g,'/');
    const raw=atob(str+'='.repeat((4-str.length%4)%4));
    return Uint8Array.from(raw,ch=>ch.charCodeAt(0));
  }
  function decodeJWTSection(s){return JSON.parse(new TextDecoder().decode(decodeB64URL(s)));}

  function getServices(){
    if(typeof Services!=='undefined'&&Services.logins)return Services;
    if(typeof ChromeUtils!=='undefined'){
      const service=ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs').Services;
      if(service?.logins)return service;
    }
    throw new Error('无法使用 Zotero 7 加密凭据存储；请检查客户端版本');
  }
  function loginManager(){
    if(typeof Components==='undefined')throw new Error('仅可在 Zotero 桌面版安全储存登录信息');
    return getServices().logins;
  }
  function storedLogins(){return loginManager().findLogins(HOST,null,REALM).filter(x=>x.username===USERNAME);}
  function restore(){
    if(current)return current;
    const records=storedLogins();
    if(records.length){
      const found=JSON.parse(records[0].password);
      if(found?.client_id && found?.subject)current=found;
    }
    return current;
  }
  function storeCredentials(record){
    // LoginManager encrypts the secret with Zotero/Gecko's configured secure storage.
    const existing=storedLogins();
    const login=Components.classes['@mozilla.org/login-manager/loginInfo;1']
      .createInstance(Components.interfaces.nsILoginInfo);
    login.init(HOST,null,REALM,USERNAME,JSON.stringify(record),'','');
    if(existing.length)loginManager().modifyLogin(existing[0],login);
    else loginManager().addLogin(login);
    current=record;
    return record;
  }
  function forgetCredentials(){
    for(const login of storedLogins())loginManager().removeLogin(login);
    current=null;
  }
  function hostID(){
    if(!zotero)throw new Error('Zotero 尚未初始化');
    const key='extensions.zoteroReviewStudio.chatgptHostID';
    let value='';try{value=String(zotero.Prefs.get(key,true)||'');}catch(_){}
    if(!value){value='urn:uuid:'+crypto.randomUUID();zotero.Prefs.set(key,value,true);}
    return value;
  }
  async function sha256B64(text){
    const bytes=new TextEncoder().encode(text);
    return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
  }
  function checkScope(scope){
    const granted=String(scope||'').split(/\s+/);
    if(!SCOPES_REQUIRED.every(s=>granted.includes(s)))
      throw new Error('未授权 ChatGPT 套餐用量；请重新登录并在官方授权页面勾选相关权限');
  }

  async function http(method,url,options={}){
    if(!zotero)throw new Error('Zotero 尚未初始化');
    const profile=options.proxyProfile;
    const args={timeout:options.timeout||30000,headers:options.headers||{},
      body:options.body,noCache:true,followRedirects:false,errorDelayMax:0,logBodyLength:0,
      responseType:'text'};
    const response=profile && typeof ReviewNetwork!=='undefined'
      ?await ReviewNetwork.request(zotero,method,url,args,profile)
      :await zotero.HTTP.request(method,url,args);
    return response.responseText;
  }
  async function tokenRequest(data,settings={}){
    const body=new URLSearchParams(data).toString();
    const result=await http('POST',TOKEN,{body,proxyProfile:settings,headers:{'Content-Type':'application/x-www-form-urlencoded',Accept:'application/json'}});
    const out=JSON.parse(result);
    if(!out.access_token || !out.refresh_token)throw new Error('OpenAI OAuth 未返回完整的访问与刷新凭据');
    return out;
  }

  async function verifyIdentity(idToken,clientID,nonce=null,expectedSubject=null,settings={}){
    const parts=String(idToken||'').split('.');
    if(parts.length!==3)throw new Error('登录返回的身份令牌格式不正确');
    const header=decodeJWTSection(parts[0]);
    const claims=decodeJWTSection(parts[1]);
    if(header.alg!=='RS256'||typeof header.kid!=='string')throw new Error('身份令牌签名算法不受信任');
    const jwks=JSON.parse(await http('GET',JWKS,{proxyProfile:settings,headers:{Accept:'application/json'}}));
    const key=(jwks.keys||[]).find(k=>k.kid===header.kid && k.kty==='RSA' && (!k.use || k.use==='sig'));
    if(!key)throw new Error('无法找到 OpenAI 身份令牌的公钥');
    const imported=await crypto.subtle.importKey('jwk',key,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const authenticated=await crypto.subtle.verify('RSASSA-PKCS1-v1_5',imported,decodeB64URL(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1]));
    if(!authenticated)throw new Error('OpenAI 身份令牌签名校验失败');
    const now=Date.now()/1000;
    const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
    if(claims.iss!==ORIGIN||!audiences.includes(clientID)||!claims.sub||!Number.isFinite(claims.exp)
      ||claims.exp<now-60||!Number.isFinite(claims.iat)||claims.iat>now+60)
      throw new Error('身份令牌签发方、接收对象或有效期验证失败');
    if(nonce!==null && claims.nonce!==nonce)throw new Error('身份令牌随机数不匹配');
    if(expectedSubject && claims.sub!==expectedSubject)throw new Error('登录账户与原有授权账户不一致');
    return claims;
  }

  function responseToCredential(response,clientID,identity,old){
    const scopes=response.scope || old?.scope || '';
    checkScope(scopes);
    return {
      client_id:clientID,
      ext_agent_host_id:hostID(),
      subject:identity.sub,
      email:String(identity.email||old?.email||'').slice(0,320),
      id_token:response.id_token||old?.id_token||'',
      access_token:response.access_token,
      refresh_token:response.refresh_token,
      expiresAt:Date.now()+Math.max(60,Number(response.expires_in)||3600)*1000,
      scope:scopes,
    };
  }

  // Loopback listener for http://127.0.0.1:<ephemeral-port>/auth/callback.
  // The callback is accepted ONLY when the per-attempt random state matches.
  function callbackListener(state){
    if(typeof Components==='undefined')throw new Error('本机 ChatGPT OAuth 登录仅支持 Zotero 桌面版');
    const Cc=Components.classes,Ci=Components.interfaces;
    const server=Cc['@mozilla.org/network/server-socket;1'].createInstance(Ci.nsIServerSocket);
    server.init(-1,true,8);
    const redirect='http://127.0.0.1:'+server.port+'/auth/callback';
    let resolved=false,timer,accept,reject;
    const result=new Promise((res,rej)=>{accept=res;reject=rej;});
    const finalize=(error,data)=>{
      if(resolved)return;resolved=true;
      clearTimeout(timer);
      try{server.close();}catch(_){}
      if(error)reject(error);else accept(data);
    };
    const reply=(transport,code,body)=>{
      try{
        const output=transport.openOutputStream(0,0,0);
        const content='<!doctype html><html><head><meta charset="UTF-8"><title>Review Studio</title></head><body><h2>'+body+'</h2><p>You can return to Zotero.</p></body></html>';
        const header='HTTP/1.1 '+code+'\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\nContent-Length: '+content.length+'\r\n\r\n';
        output.write(header+content,header.length+content.length);
        output.close();
      }catch(_){}
    };
    server.asyncListen({
      onSocketAccepted(_socket,transport){
        let read='',handled=false;
        try{
          const input=transport.openInputStream(0,0,0);
          const pump=Cc['@mozilla.org/network/input-stream-pump;1'].createInstance(Ci.nsIInputStreamPump);
          pump.init(input,0,0,false);
          pump.asyncRead({
            onStartRequest(){},
            onDataAvailable(_req,stream,_offset,count){
              if(handled)return;
              const reader=Cc['@mozilla.org/scriptableinputstream;1'].createInstance(Ci.nsIScriptableInputStream);
              reader.init(stream);read+=reader.read(count);
              if(read.length>16384)read='';
              if(!read.includes('\r\n\r\n'))return;
              handled=true;
              const first=read.split('\r\n')[0];
              const m=/^GET (\S+) HTTP\/1\.[01]$/.exec(first);
              if(!m){reply(transport,'400 Bad Request','Invalid request');return;}
              let u;try{u=new URL(m[1],redirect);}catch(_){reply(transport,'400 Bad Request','Invalid URL');return;}
              if(u.pathname!=='/auth/callback') {reply(transport,'404 Not Found','Not found');return;}
              if(u.searchParams.get('state')!==state){reply(transport,'403 Forbidden','Invalid sign-in state');return;}
              if(u.searchParams.get('error')){
                reply(transport,'200 OK','Sign-in was not authorized');
                finalize(new Error('用户未授权使用 ChatGPT 登录'));
                return;
              }
              const code=u.searchParams.get('code');
              if(!code){reply(transport,'400 Bad Request','Missing authorization code');return;}
              reply(transport,'200 OK','ChatGPT authorization received');
              finalize(null,{code,client_id:u.searchParams.get('client_id')||''});
            },
            onStopRequest(){},
            QueryInterface:ChromeUtils.generateQI(['nsIStreamListener','nsIRequestObserver']),
          });
        }catch(error){reply(transport,'500 Internal Server Error','Sign-in failed');finalize(error);}
      },
      onStopListening(){},
    });
    timer=setTimeout(()=>finalize(new Error('ChatGPT 登录超时，请重新点击登录')),180000);
    return {redirect,result,close:()=>finalize(new Error('登录已取消'))};
  }

  async function signIn(settings={}){
    if(signInPromise)return signInPromise;
    signInPromise=(async()=>{
      restore();
      const existing=current;
      const state=randomURLString();
      const nonce=randomURLString();
      const verifier=randomURLString(64);
      const codeChallenge=await sha256B64(verifier);
      const listener=callbackListener(state);
      const dynamic=!existing?.client_id;
      const client_id=dynamic?'dynamic_agent_client':existing.client_id;
      const query=new URLSearchParams({client_id,response_type:'code',redirect_uri:listener.redirect,
        scope:SCOPE,resource:RESOURCE,state,nonce,code_challenge_method:'S256',code_challenge:codeChallenge,
        ext_agent_host_id:hostID()});
      if(dynamic)query.set('agent_name_hint','Zotero Review Studio');
      else{
        if(existing.id_token)query.set('id_token_hint',existing.id_token);
        if(existing.email)query.set('login_hint',existing.email);
      }
      try{
        // Only this official site receives the auth request, never any API gateway.
        zotero.launchURL(AUTHORIZE+'?'+query.toString());
        const callback=await listener.result;
        const issued=dynamic?callback.client_id:client_id;
        if(!/^oaiapp_[A-Za-z0-9_-]+$/.test(issued))throw new Error('官方授权未返回有效的客户端注册 ID');
        if(!dynamic && callback.client_id && callback.client_id!==client_id)
          throw new Error('OAuth 回调中的客户端与已有账户不匹配');
        const response=await tokenRequest({grant_type:'authorization_code',client_id:issued,
          code:callback.code,redirect_uri:listener.redirect,code_verifier:verifier,resource:RESOURCE},settings);
        const identity=await verifyIdentity(response.id_token,issued,nonce,existing?.subject||null,settings);
        return storeCredentials(responseToCredential(response,issued,identity,existing));
      }finally{if(listener)listener.close();}
    })();
    try{return await signInPromise;}finally{signInPromise=null;}
  }

  async function renew(settings={}){
    if(refreshPromise)return refreshPromise;
    refreshPromise=(async()=>{
      const old=restore();
      if(!old?.refresh_token)throw new Error('尚未连接 ChatGPT 账号');
      const response=await tokenRequest({grant_type:'refresh_token',client_id:old.client_id,
        refresh_token:old.refresh_token,resource:RESOURCE},settings);
      let identity={sub:old.subject,email:old.email};
      if(response.id_token)identity=await verifyIdentity(response.id_token,old.client_id,null,old.subject,settings);
      return storeCredentials(responseToCredential(response,old.client_id,identity,old));
    })();
    try{return await refreshPromise;}finally{refreshPromise=null;}
  }
  async function accessToken(settings={}){
    const record=restore();
    if(!record?.access_token)throw new Error('请先点击“使用 ChatGPT 登录”并完成官方授权，无需 API Key');
    if(Date.now() > record.expiresAt-120000)await renew(settings);
    return current.access_token;
  }
  async function signOut(settings={}){
    const record=restore();
    if(!record)return;
    let revoked=false;
    try{
      if(record.refresh_token){
        let revokeURL=ORIGIN+'/api/accounts/oauth/revoke';
        try{
          const discovery=JSON.parse(await http('GET',ORIGIN+'/.well-known/openid-configuration',{proxyProfile:settings}));
          const candidate=new URL(discovery.revocation_endpoint);
          if(candidate.protocol==='https:'&&candidate.origin===ORIGIN)revokeURL=candidate.toString();
        }catch(_){}
        await http('POST',revokeURL,{
          headers:{'Content-Type':'application/x-www-form-urlencoded'},
          body:new URLSearchParams({token:record.refresh_token,token_type_hint:'refresh_token',client_id:record.client_id}).toString(),proxyProfile:settings
        });revoked=true;
      }
    }catch(_){}
    forgetCredentials();
    if(!revoked)throw new Error('本机登录已清除，但未确认服务端撤销；可在 ChatGPT 设置中断开应用访问');
  }

  function parseEventStream(source){
    let text='',completed=false,failed=null,finalText='';
    for(const block of String(source||'').split(/\r?\n\r?\n/)){
      let type='',data='';
      for(const line of block.split(/\r?\n/)){
        if(line.startsWith('event:'))type=line.slice(6).trim();
        else if(line.startsWith('data:'))data+=(data?'\n':'')+line.slice(5).trimStart();
      }
      if(!data || data==='[DONE]')continue;
      let obj;try{obj=JSON.parse(data);}catch(_){continue;}
      const eventType=type||obj.type;
      if(eventType==='response.output_text.delta' && typeof obj.delta==='string')text+=obj.delta;
      if(eventType==='response.failed' || eventType==='error')failed=obj.error?.message||'模型请求失败';
      if(eventType==='response.completed'){
        completed=obj.response?.status==='completed';
        finalText=(obj.response?.output||[]).flatMap(o=>(o.content||[]).filter(c=>c.type==='output_text').map(c=>c.text||'')).join('\n');
      }
    }
    if(failed)throw new Error('ChatGPT 请求失败：'+failed);
    if(!completed)throw new Error('ChatGPT 未返回完整的 response.completed；请检查网络或套餐额度');
    return finalText||text;
  }

  async function request(messages,settings={}){
    const token=await accessToken(settings);
    const instructions=messages.filter(x=>x.role==='system'||x.role==='developer')
      .map(x=>String(x.content||'')).join('\n\n');
    const input=messages.filter(x=>x.role!=='system'&&x.role!=='developer').map(x=>({role:x.role,content:String(x.content||'')}));
    const payload={model:settings.model,input,store:false,stream:true};
    if(instructions)payload.instructions=instructions;
    const out=await http('POST',RESOURCE+'/responses',{
      timeout:settings.timeoutMs||120000,proxyProfile:settings,
      headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Accept':'text/event-stream'},
      body:JSON.stringify(payload)
    });
    return parseEventStream(out);
  }
  async function listModels(settings={}){
    const token=await accessToken(settings);
    const raw=await http('GET',RESOURCE+'/models',{
      timeout:30000,proxyProfile:settings,
      headers:{Authorization:'Bearer '+token,'Accept':'application/json'}
    });
    const data=JSON.parse(raw);
    const arr=Array.isArray(data.models)?data.models:Array.isArray(data.data)?data.data:[];
    return arr.filter(x=>x.visibility===undefined||x.visibility==='list').map(x=>({id:String(x.slug||x.id||''),name:String(x.display_name||x.slug||x.id||'')}))
      .filter(x=>x.id).slice(0,100);
  }
  return {configure,restore,status,isConnected,signIn,signOut,accessToken,renew,request,listModels,
    // Pure helpers exported for regression and security tests.
    parseEventStream,decodeJWTSection,checkScope,verifyIdentity,sha256B64};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ReviewChatGPT;
