/* Per-profile network transport for Zotero 7.
 * 'inherit' uses Zotero.HTTP; 'direct' and 'custom' create a channel with
 * an explicit nsIProxyInfo on that REQUEST only. Never changes network.proxy.*
 * or registers a process-wide proxy filter.
 */
var ReviewNetwork = (function () {
  'use strict';

  function proxyConfig(input) {
    const p = input || {};
    const mode = ['inherit', 'direct', 'custom'].includes(p.proxyMode) ? p.proxyMode : 'inherit';
    if (mode !== 'custom') return {mode};
    const type = String(p.proxyType || 'http').toLowerCase();
    if (!['http','socks5'].includes(type)) throw new Error('代理类型请选择 HTTP 或 SOCKS5');
    const host = String(p.proxyHost || '').trim();
    const port = Number(p.proxyPort);
    // Deliberately disallow credentials, URL paths and control chars in proxy host.
    if (!host || host.length > 253 || /[\s\/@?#\\]/.test(host) || host.includes(':'))
      throw new Error('代理地址仅填写主机名或 IPv4，如 127.0.0.1；IPv6 暂不支持');
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw new Error('代理端口必须在 1–65535 之间');
    return {mode, type,host,port, remoteDNS:p.proxyRemoteDNS!==false};
  }

  function getPlatform() {
    if (typeof Components==='undefined')
      throw new Error('独立代理仅能在 Zotero 7 桌面插件中使用');
    const services=(typeof Services!=='undefined') ? Services
      : ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs').Services;
    return {services,cc:Components.classes,ci:Components.interfaces,cr:Components.results};
  }

  function makeProxyInfo(config,pps,ci) {
    const direct=config.mode==='direct';
    const type=direct?'direct':config.type==='socks5'?'socks':'http';
    const flags=(!direct && config.type==='socks5' && config.remoteDNS)
      ? ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST : 0;
    const host=direct?'':config.host;
    const port=direct?-1:config.port;
    // Firefox's recent nsIProtocolProxyService adds the auth/header and
    // isolation-key arguments. Do not fall back to Zotero.HTTP on failure,
    // because that would silently bypass the user's selected proxy.
    return pps.newProxyInfo(type,host,port,'','',flags,0,null);
  }

  async function explicitRequest(method,url,options,config) {
    const {services,cc,ci,cr}=getPlatform();
    const uri=services.io.newURI(url);
    if (!['http','https'].includes(uri.scheme)) throw new Error('禁止非 HTTP(S) API 请求');
    const principal=services.scriptSecurityManager.getSystemPrincipal();
    const baseChannel=services.io.newChannelFromURI(uri,null,principal,null,
      ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
      ci.nsIContentPolicy.TYPE_OTHER);
    const handler=services.io.getProtocolHandler(uri.scheme).QueryInterface(ci.nsIProxiedProtocolHandler);
    let channel;
    if(config.mode==='inherit') {
      // Let Gecko resolve Zotero's normal system/PAC proxy on the base channel.
      // This path is used only after Zotero.HTTP has failed on a newer Gecko
      // binding, so it preserves the user's inherited network settings.
      channel=baseChannel.QueryInterface(ci.nsIHttpChannel);
    } else {
      const pps=cc['@mozilla.org/network/protocol-proxy-service;1']
        .getService(ci.nsIProtocolProxyService);
      const proxyInfo=makeProxyInfo(config,pps,ci);
      channel=handler.newProxiedChannel(uri,proxyInfo,0,null,baseChannel.loadInfo)
        .QueryInterface(ci.nsIHttpChannel);
    }

    const verb=String(method||'POST').toUpperCase();
    if (options.body !== undefined && options.body !== null) {
      const payload=String(options.body);
      const stream=cc['@mozilla.org/io/string-input-stream;1'].createInstance(ci.nsIStringInputStream);
      stream.setUTF8Data(payload);
      const bytes=new TextEncoder().encode(payload).byteLength;
      const contentType=Object.entries(options.headers||{})
        .find(([key])=>String(key).toLowerCase()==='content-type')?.[1]
        ||'application/octet-stream';
      const upload=channel.QueryInterface(ci.nsIUploadChannel2);
      // Current Gecko requires the fifth aStreamHasHeaders argument. Keep a
      // four-argument fallback for older Zotero runtimes whose XPCOM binding
      // predates that parameter.
      try{upload.explicitSetUploadStream(stream,String(contentType),bytes,verb,false);}
      catch(error){
        if(!/argument|parameter|not enough/i.test(String(error?.message||error)))throw error;
        upload.explicitSetUploadStream(stream,String(contentType),bytes,verb);
      }
    }
    channel.requestMethod=verb;
    const headers=options.headers||{};
    for(const [key,value] of Object.entries(headers)) {
      if (/^(host|cookie|proxy-authorization)$/i.test(key))
        throw new Error('不允许直接覆盖网络代理或 Cookie 请求头');
      if (key.toLowerCase()!=='content-type' || options.body===undefined)
        channel.setRequestHeader(String(key),String(value),false);
    }
    // Avoid redirects that might send the API key to a different hostname.
    // This property exists on Gecko nsIHttpChannel; fail closed otherwise.
    channel.redirectionLimit=0;
    const timeout=Math.max(3000,Math.min(300000,Number(options.timeout)||120000));
    return new Promise((resolve,reject)=>{
      let finished=false,total=0;
      const data=[];
      const timer=setTimeout(()=>{try{channel.cancel(cr.NS_ERROR_NET_TIMEOUT);}catch(_){}},timeout);
      const finish=(error,result)=>{
        if(finished)return;
        finished=true;clearTimeout(timer);
        if(error)reject(error);else resolve(result);
      };
      const listener={
        onStartRequest(){},
        onDataAvailable(_req,input,_offset,count){
          try{
            total+=count;
            if(total>12*1024*1024){channel.cancel(cr.NS_ERROR_FILE_TOO_BIG||cr.NS_ERROR_FAILURE);return;}
            const bin=cc['@mozilla.org/binaryinputstream;1'].createInstance(ci.nsIBinaryInputStream);
            bin.setInputStream(input);
            data.push(Uint8Array.from(bin.readByteArray(count)));
          }catch(e){try{channel.cancel(cr.NS_ERROR_FAILURE);}catch(_){};finish(e);}
        },
        onStopRequest(request,status){
          if(finished)return;
          if(status!==0){
            const error=new Error('代理请求失败（网络状态：'+status+'）');
            error.status=0;
            return finish(error);
          }
          const response=new Uint8Array(total);
          let pos=0;for(const chunk of data){response.set(chunk,pos);pos+=chunk.length;}
          const responseText=new TextDecoder('utf-8').decode(response);
          const code=Number(request.QueryInterface(ci.nsIHttpChannel).responseStatus||0);
          if(code<200||code>=300){
            const error=new Error('HTTP '+code+'（代理模式：'+config.mode+'）');
            error.status=code;
            error.xmlhttp={status:code,responseText:responseText.slice(0,1200)};
            return finish(error);
          }
          finish(null,{responseText,status:code});
        },
        QueryInterface:ChromeUtils.generateQI(['nsIStreamListener','nsIRequestObserver']),
      };
      try{channel.asyncOpen(listener);}catch(e){finish(e);}
    });
  }

  async function request(zotero,method,url,options={},profile={}) {
    const config=proxyConfig(profile);
    if(config.mode==='inherit') {
      try{return await zotero.HTTP.request(method,url,options);}
      catch(error){
        // Zotero builds backed by a newer Gecko can expose a five-argument
        // nsIUploadChannel2 while their bundled Zotero.HTTP/XHR path still
        // calls the old four-argument form. Retry only this known binding
        // failure through the compatible channel implementation above.
        if(!/nsIUploadChannel2\.explicitSetUploadStream|explicitSetUploadStream/i.test(String(error?.message||error)))throw error;
        return explicitRequest(method,url,options,config);
      }
    }
    return explicitRequest(method,url,options,config);
  }
  return {proxyConfig,request,explicitRequest,makeProxyInfo};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ReviewNetwork;
