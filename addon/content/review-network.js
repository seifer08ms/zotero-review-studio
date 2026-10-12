/* Per-profile network transport for Zotero 7.
 * 'inherit' uses Zotero.HTTP; 'direct' and 'custom' create a channel with
 * an explicit nsIProxyInfo on that REQUEST only. Never changes network.proxy.*
 * or registers a process-wide proxy filter.
 */
var ReviewNetwork = (function () {
  'use strict';

  // Error pages are useful for diagnosing a bad proxy, but a response body is
  // untrusted input and can contain credentials echoed by a gateway. Keep the
  // diagnostic short and redact the common bearer/key forms before it reaches
  // the settings pane or a thrown error.
  function redactDiagnostic(value, limit=360) {
    return String(value||'')
      .replace(/bearer\s+[^\s"'<>]+/ig,'Bearer [redacted]')
      .replace(/((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|password|secret)\s*[:=]\s*)[^\s,;"'<>]+/ig,'$1[redacted]')
      .replace(/\b(?:sk|sess|oai)-[A-Za-z0-9_-]{12,}\b/g,'[redacted]')
      .replace(/[\u0000-\u001f\u007f]+/g,' ')
      .replace(/\s+/g,' ').trim().slice(0,limit);
  }

  function plainResponseText(value) {
    let text=String(value||'');
    // Proxy block pages are often HTML. Drop executable/style content and
    // tags while retaining title/body text that identifies the proxy.
    text=text.replace(/<!--[\s\S]*?-->/g,' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/ig,' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/ig,' ')
      .replace(/<[^>]+>/g,' ')
      .replace(/&(?:nbsp|#160);/ig,' ')
      .replace(/&amp;/ig,'&').replace(/&lt;/ig,'<').replace(/&gt;/ig,'>')
      .replace(/&quot;/ig,'"').replace(/&#39;|&apos;/ig,"'");
    return redactDiagnostic(text);
  }

  function responseJSONMessage(value) {
    try {
      const parsed=JSON.parse(String(value||''));
      const error=parsed?.error;
      const candidate=typeof error==='string' ? error
        : error?.message || parsed?.detail || parsed?.message;
      if (!candidate) return '';
      const code=typeof error==='object' && (error.code||error.type);
      const param=typeof error==='object' && error.param;
      const suffix=[code,param].filter(Boolean).map(String).join(' / ');
      return redactDiagnostic(String(candidate)+(suffix?' ['+suffix+']':''));
    } catch (_) { return ''; }
  }

  function proxyResponseHint(body,headers={}) {
    const text=String(body||'');
    const headerText=Object.entries(headers||{}).map(([key,value])=>key+':'+value).join(' ');
    // HTML from an explicit proxy, or a well-known forward-proxy signature,
    // means the 403 did not necessarily come from the configured API.
    return /<!doctype\s+html|<html\b|<title\b/i.test(text)
      || /(?:^|[\s,;])(?:squid|tinyproxy|privoxy|clash|mihomo|sing-box|mitmproxy)(?:[\s,;]|$)/i.test(text+' '+headerText)
      || /(?:^|[\s,;])(?:via|x-cache|x-squid-error)\s*:/i.test(headerText);
  }

  function formatHTTPError(code,body,headers={},config={}) {
    const mode=String(config.mode||'inherit');
    const proxyLabel=mode==='custom'
      ? '独立 '+(config.type==='socks5'?'SOCKS5':'HTTP')+' 代理'
      : '代理模式：'+mode;
    const jsonMessage=responseJSONMessage(body);
    const text=plainResponseText(body);
    const proxyLike=proxyResponseHint(body,headers);
    let message='HTTP '+Number(code||0)+'（'+proxyLabel+'）';
    if (proxyLike) {
      const advice=config.type==='socks5'
        ? '请确认 SOCKS5 协议、主机、端口，以及“在代理端解析远程域名”设置'
        : '请确认 HTTP 代理主机和端口；访问 HTTPS 目标时代理必须支持 CONNECT';
      message+='：服务器返回了疑似代理拦截页。'+advice;
      if (text) message+='；返回摘要：'+text;
    } else if (jsonMessage) {
      message+='：'+jsonMessage;
    } else if (text) {
      message+='：返回摘要：'+text;
    }
    const requestID=headers['x-request-id']||headers['request-id'];
    if(requestID)message+='；请求 ID：'+redactDiagnostic(requestID,120);
    return message;
  }

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
          const httpChannel=request.QueryInterface(ci.nsIHttpChannel);
          const code=Number(httpChannel.responseStatus||0);
          const responseHeaders={};
          // Header access is best-effort: old Zotero/Gecko mocks and some
          // channel wrappers do not expose visitResponseHeaders. Never fail a
          // completed request merely because diagnostics are unavailable.
          try {
            httpChannel.visitResponseHeaders({
              visitHeader(name,value){
                if (/^(set-cookie|proxy-authorization|www-authenticate|authorization)$/i.test(name)) return;
                responseHeaders[String(name).toLowerCase()]=redactDiagnostic(value,180);
              },
            });
          } catch (_) {}
          if(code<200||code>=300){
            const error=new Error(formatHTTPError(code,responseText,responseHeaders,config));
            error.status=code;
            // Keep the body available for retry heuristics (for example a
            // provider rejecting response_format) without retaining a raw
            // gateway page or an echoed Authorization value on the error.
            error.xmlhttp={status:code,responseText:redactDiagnostic(responseText,1200),responseHeaders};
            error.proxyResponse=proxyResponseHint(responseText,responseHeaders);
            return finish(error);
          }
          finish(null,{responseText,status:code,responseHeaders});
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
  return {proxyConfig,request,explicitRequest,makeProxyInfo,formatHTTPError,redactDiagnostic};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ReviewNetwork;
