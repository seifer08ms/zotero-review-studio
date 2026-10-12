/* Local-only configuration model for ChatGPT OAuth and compatible Chat Completions APIs.
 * Passwords are deliberately NOT serialized in the profiles JSON.
 * A user may explicitly opt in to saving a separate plaintext key preference.
 */
var ReviewProfiles = (function () {
  'use strict';

  const PRESETS = Object.freeze([
    {id:'chatgpt',name:'ChatGPT 官网账号（无需 API Key）',endpoint:'https://api.openai.com/v1/responses',model:'gpt-6.1-sol'},
    {id:'openai',name:'OpenAI',endpoint:'https://api.openai.com/v1/chat/completions',model:'gpt-4.1-mini'},
    {id:'deepseek',name:'DeepSeek',endpoint:'https://api.deepseek.com/chat/completions',model:'deepseek-chat'},
    {id:'qwen',name:'通义千问（DashScope）',endpoint:'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',model:'qwen-plus'},
    {id:'siliconflow',name:'SiliconFlow 硅基流动',endpoint:'https://api.siliconflow.cn/v1/chat/completions',model:'Qwen/Qwen3-8B'},
    {id:'openrouter',name:'OpenRouter',endpoint:'https://openrouter.ai/api/v1/chat/completions',model:'openai/gpt-4.1-mini'},
    {id:'ollama',name:'Ollama 本地',endpoint:'http://127.0.0.1:11434/v1/chat/completions',model:'qwen3:8b'},
    {id:'lmstudio',name:'LM Studio 本地',endpoint:'http://127.0.0.1:1234/v1/chat/completions',model:'local-model'},
    {id:'custom',name:'自定义兼容接口',endpoint:'https://example.com/v1/chat/completions',model:'model-name'},
  ]);

  function preset(id) { return PRESETS.find(p=>p.id===id)||PRESETS[0]; }
  function normalizedEndpoint(value) {
    return String(value||'').trim().replace(/\/+$/,'').toLowerCase();
  }
  // Older releases stored one endpoint/model pair instead of a named provider.
  // Recover a known provider from that endpoint so a saved DeepSeek/Qwen/etc.
  // configuration remains identifiable after the ChatGPT profile was added.
  function providerFromEndpoint(endpoint) {
    const value=normalizedEndpoint(endpoint);
    if(!value)return '';
    const exact=PRESETS.find(p=>!['chatgpt','custom'].includes(p.id)&&normalizedEndpoint(p.endpoint)===value);
    if(exact)return exact.id;
    try {
      const host=new URL(value).hostname;
      const aliases=[
        ['deepseek',['api.deepseek.com']],
        ['qwen',['dashscope.aliyuncs.com']],
        ['siliconflow',['api.siliconflow.cn']],
        ['openrouter',['openrouter.ai']],
        ['ollama',['127.0.0.1','localhost','[::1]']],
        ['lmstudio',['127.0.0.1','localhost','[::1]']],
      ];
      for(const [id,hosts] of aliases){
        if(hosts.includes(host)){
          if(id==='ollama'&&!value.includes(':11434/'))continue;
          if(id==='lmstudio'&&!value.includes(':1234/'))continue;
          return id;
        }
      }
    } catch (_) {}
    return '';
  }
  function providerFor(rawProvider,endpoint) {
    const explicit=PRESETS.find(p=>p.id===rawProvider);
    const inferred=providerFromEndpoint(endpoint);
    if(!explicit)return inferred||((endpoint)?'openai':'chatgpt');
    // A v0.3 endpoint migrated as OpenAI can still point at DeepSeek or
    // another known service. Repair that label while leaving custom OpenAI
    // compatible endpoints untouched.
    if(explicit.id==='openai'&&inferred&&inferred!=='openai')return inferred;
    return explicit.id;
  }
  function generateId() { return 'api-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8); }
  function sanitize(raw, index=0) {
    const p=raw&&typeof raw==='object'?raw:{};
    const provider=providerFor(p.provider,p.endpoint);
    const base=preset(provider);
    let name=String(p.name||base.name+' '+(index+1)).trim().slice(0,70);
    // A profile migrated by v0.4 may already be stored as "OpenAI · 默认"
    // even though its endpoint identifies DeepSeek (or another known service).
    // Update only these generated migration names; user-assigned names remain.
    if(provider!==(PRESETS.find(x=>x.id===p.provider)?.id||p.provider)
      && /^OpenAI(?: · (?:默认|原有配置))?$/.test(name))
      name=base.name+' · 原有配置';
    return {
      id: typeof p.id==='string'&&/^[a-zA-Z0-9_-]{3,90}$/.test(p.id)?p.id:generateId(),
      name,
      provider:base.id,
      endpoint:String(p.endpoint!==undefined?p.endpoint:base.endpoint).trim().slice(0,2000),
      model:String(p.model!==undefined?p.model:base.model).trim().slice(0,180),
      route:base.id==='chatgpt'?'zotero':p.route==='gateway'?'gateway':'zotero',
      gatewayEndpoint:String(p.gatewayEndpoint||'').trim().slice(0,2000),
      proxyMode:['inherit','direct','custom'].includes(p.proxyMode)?p.proxyMode:'inherit',
      proxyType:p.proxyType==='socks5'?'socks5':'http',
      proxyHost:String(p.proxyHost||'').trim().slice(0,253),
      proxyPort:p.proxyPort===undefined || p.proxyPort===null || p.proxyPort===''?'':Number(p.proxyPort),
      proxyRemoteDNS:p.proxyRemoteDNS!==false,
      rememberKey:base.id==='chatgpt'?false:p.rememberKey===true,
      jsonMode:p.jsonMode!==false,
      timeoutMs:Math.max(5000,Math.min(300000,Number(p.timeoutMs)||120000)),
    };
  }
  function create(provider='chatgpt',name='') {
    const p=preset(provider);
    return sanitize({id:generateId(),name:name||p.name,provider:p.id,
      endpoint:p.endpoint,model:p.model,route:'zotero',proxyMode:'inherit',proxyType:'http',proxyHost:'127.0.0.1',proxyPort:7890,rememberKey:false,jsonMode:true,timeoutMs:120000});
  }
  function load(getPref) {
    let all=[];
    try {const raw=getPref('apiProfiles','');const parsed=JSON.parse(raw);if(Array.isArray(parsed))all=parsed;}
    catch (_) {}
    if (!all.length) {
      const legacyKey=String(getPref('apiKey','')||'');
      const legacyEndpoint=String(getPref('endpoint','')||'');
      const legacyModel=String(getPref('model','')||'');
      const customized=legacyKey || (legacyEndpoint && legacyEndpoint!=='https://api.openai.com/v1/chat/completions')
        || (legacyModel && legacyModel!=='gpt-4.1-mini');
      if(!customized){
        const fresh=create('chatgpt','ChatGPT · 官网账号（默认）');
        return {profiles:[fresh],activeId:fresh.id,migratedKey:''};
      }
      const provider=providerFromEndpoint(legacyEndpoint)||'openai';
      const migrated=create(provider,provider==='openai'?'OpenAI · 原有配置':preset(provider).name+' · 原有配置');
      if(legacyEndpoint)migrated.endpoint=legacyEndpoint;
      if(legacyModel)migrated.model=legacyModel;
      migrated.rememberKey=!!legacyKey;
      // Keep the existing compatible API active while adding the official
      // ChatGPT account as a separate option during the upgrade.
      const chatgpt=create('chatgpt','ChatGPT · 官网账号');
      return {profiles:[migrated,chatgpt],activeId:migrated.id,migratedKey:legacyKey};
    }
    const ids=new Set();
    const profiles=all.slice(0,30).map(sanitize).filter(p=>{if(ids.has(p.id))return false;ids.add(p.id);return true;});
    if(!profiles.length)profiles.push(create('chatgpt'));
    // Add the no-API-key login provider during upgrades without discarding existing profiles.
    const active=getPref('activeAPIProfile','');
    const savedActive=ids.has(active)?active:profiles[0].id;
    if(!profiles.some(p=>p.provider==='chatgpt') && profiles.length<30){
      profiles.unshift(create('chatgpt','ChatGPT · 官网账号'));
    }
    return {profiles,activeId:savedActive,migratedKey:''};
  }
  function save(setPref,profiles,activeId) {
    const sanitized=profiles.slice(0,30).map(sanitize);
    setPref('apiProfiles',JSON.stringify(sanitized));
    setPref('activeAPIProfile',activeId);
  }
  function allowedURL(raw) {
    let url;
    try {url=new URL(String(raw||''));}catch (_){throw new Error('请输入有效的完整 API URL');}
    const local=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
    if(url.protocol!=='https:' && !(local && url.protocol==='http:'))
      throw new Error('云端 API 必须使用 HTTPS；HTTP 仅允许本机 localhost / 127.0.0.1');
    if(url.username||url.password) throw new Error('API URL 不能包含账号或密码');
    if(!url.pathname.endsWith('/chat/completions'))
      throw new Error('当前版本支持 OpenAI 兼容 Chat Completions；URL 应以 /chat/completions 结尾');
    return url.toString();
  }
  function effectiveEndpoint(profile) {
    const p=sanitize(profile);
    return p.provider==='chatgpt'?'https://api.openai.com/v1/responses':allowedURL(p.route==='gateway'?p.gatewayEndpoint:p.endpoint);
  }
  function validate(profile) {
    const p=sanitize(profile);
    if(!p.name)throw new Error('请为 API 配置填写名称');
    if(!p.model)throw new Error('请填写模型名称');
    if(p.provider!=='chatgpt')allowedURL(p.endpoint);
    if(p.proxyMode==='custom') {
      if(typeof ReviewNetwork!=='undefined')ReviewNetwork.proxyConfig(p);
      else { const port=Number(p.proxyPort); if(!p.proxyHost||!Number.isInteger(port)||port<=0||port>65535)throw new Error('请填写有效的独立代理主机与端口'); }
    }
    return effectiveEndpoint(p);
  }
  function label(profile) {
    const p=sanitize(profile);
    return p.name+' · '+p.model+(p.route==='gateway'?' · 网关':'')+(p.proxyMode==='custom'?' · 代理':p.proxyMode==='direct'?' · 直连':'');
  }
  return {PRESETS,preset,create,load,save,sanitize,validate,effectiveEndpoint,label};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ReviewProfiles;
