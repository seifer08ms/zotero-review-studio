const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Core=require('../addon/content/review-core.js');
const Profiles=require('../addon/content/review-profiles.js');
const Network=require('../addon/content/review-network.js');
const Checkpoints=require('../addon/content/review-checkpoints.js');
const Pages=require('../addon/content/review-pages.js');
const Chapters=require('../addon/content/review-chapters.js');

async function testProxy(){
  const direct=Profiles.create('ollama'),custom=Profiles.create('deepseek');
  direct.proxyMode='direct';
  custom.proxyMode='custom';custom.proxyType='socks5';custom.proxyHost='127.0.0.1';custom.proxyPort=1080;
  const metadata={};Profiles.save((k,v)=>metadata[k]=v,[direct,custom],custom.id);
  const restored=Profiles.load((k,fallback)=>metadata[k]??fallback);
  assert.equal(restored.profiles[0].proxyMode,'direct');
  assert.equal(restored.profiles[1].proxyMode,'custom');
  assert.equal(restored.profiles[1].proxyPort,1080);
  assert.equal(Network.proxyConfig(restored.profiles[1]).type,'socks5');
  assert.throws(()=>Network.proxyConfig({...custom,proxyPort:0}),/代理端口/);
  assert.throws(()=>Network.proxyConfig({...custom,proxyHost:'user:pass@host'}),/代理地址/);
  const call=[];
  const proxySvc={newProxyInfo:(...args)=>{call.push({kind:'info',args});return {type:args[0],host:args[1]};}};
  const ci={nsIProtocolProxyService:0,nsIProxyInfo:{TRANSPARENT_PROXY_RESOLVES_HOST:128},nsIProxiedProtocolHandler:0,nsIHttpChannel:0,
    nsIUploadChannel2:'upload',nsIStringInputStream:0,nsIBinaryInputStream:0,nsILoadInfo:{SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL:1},nsIContentPolicy:{TYPE_OTHER:1}};
  const cc={
    '@mozilla.org/network/protocol-proxy-service;1':{getService:()=>proxySvc},
    '@mozilla.org/io/string-input-stream;1':{createInstance:()=>({setUTF8Data(t){call.push({kind:'upload',text:t});}})},
    '@mozilla.org/binaryinputstream;1':{createInstance:()=>({setInputStream(input){this.input=input},readByteArray(n){return [...this.input.bytes].slice(0,n)}})},
  };
  let seq=0;
  global.Components={classes:cc,interfaces:ci,results:{NS_ERROR_NET_TIMEOUT:1,NS_ERROR_FAILURE:2}};
  global.ChromeUtils={generateQI:()=>()=>true};
  global.Services={
    scriptSecurityManager:{getSystemPrincipal:()=>({})},
    io:{newURI:(u)=>({scheme:u.startsWith('https:')?'https':'http',spec:u}),
      newChannelFromURI:()=>({loadInfo:'system'}),
      getProtocolHandler:()=>({QueryInterface:()=>({newProxiedChannel:(_uri,p)=>{
        call.push({kind:'channel',proxy:p});
        const channel={responseStatus:200,headers:{},QueryInterface:()=>channel,
          explicitSetUploadStream(_stream,_contentType,length,method){call.push({kind:'explicit-upload',length,method});},
          setRequestHeader(k,v){channel.headers[k]=v},cancel(){},
          asyncOpen(listener){
            const bytes=new TextEncoder().encode(JSON.stringify({ok:true,seq:++seq}));
            queueMicrotask(()=>{listener.onStartRequest(channel);listener.onDataAvailable(channel,{bytes},0,bytes.length);listener.onStopRequest(channel,0)});
          }};
        return channel;
      }})})}
  };
  let inherited=0;
  const zotero={HTTP:{request:async()=>{inherited++;return {responseText:'{}'}}}};
  try{
    const a=await Network.request(zotero,'POST','https://api.deepseek.com/chat/completions',{body:'{"test":true}',headers:{Authorization:'Bearer placeholder'}},custom);
    assert(JSON.parse(a.responseText).ok);
    const proxyArgs=call.find(x=>x.kind==='info').args;
    assert.equal(proxyArgs[0],'socks');assert.equal(proxyArgs[1],'127.0.0.1');assert.equal(proxyArgs[2],1080);
    assert.equal(proxyArgs[5],128,'SOCKS remote DNS must be explicit');
    assert.equal(call.find(x=>x.kind==='channel').proxy.type,'socks');
    const ret=await Network.request(zotero,'GET','https://api.example.test/',{},{proxyMode:'direct'});
    assert(JSON.parse(ret.responseText).ok);
    assert.equal(call.filter(x=>x.kind==='info').at(-1).args[0],'direct');
    await Network.request(zotero,'GET','https://api.example.test/',{},{proxyMode:'inherit'});
    assert.equal(inherited,1,'Inherited network mode delegates to Zotero.HTTP only');
  }finally {delete global.Components;delete global.ChromeUtils;delete global.Services;}
  console.log('Per-API independent proxy modes and Gecko channel mock passed');
}

async function testPages(){
  const pages=['Introduction preliminary work',
    'Limitations observed: cross-region generalization remained unstable',
    'Counterexample: the new dataset improves transfer.',
    'Conclusion and references'];
  let calls=0;
  const prefix=async maxPages=>{calls++;return {text:pages.slice(0,maxPages||pages.length).join(' '),extractedPages:maxPages||pages.length,totalPages:pages.length}};
  const quotes=[
    {evidenceId:'A',verified:true,quote:'cross-region generalization remained unstable'},
    {evidenceId:'B',verified:true,quote:'new dataset improves transfer'},
    {evidenceId:'C',verified:true,quote:'this is a fabricated quote'},
    {evidenceId:'D',verified:false,quote:'cross-region generalization remained unstable'},
  ];
  const out=await Pages.locate(quotes,prefix);
  assert.equal(out.get('A').pdfPage,2);assert.equal(out.get('B').pdfPage,3);
  assert.equal(out.get('C').pdfPage,null);assert.equal(out.get('C').location,'not_found');
  assert.equal(out.has('D'),false,'Unverified quote must not get PDF page');
  assert(calls<=8,'Binary page lookup should be bounded');
  console.log('Verified physical PDF page matching and no-invention fallback passed');
}

async function testChapters(){
  const md='# Survey\n\nPreface.\n\n## Introduction\n\nIntro one [P1].\n\n## Methods\n\nOriginal methods.\n\n### Subsection\n\nNested text.\n\n## Research Gaps\n\nOriginal gap text.\n\n## References\n\n[P1] Reference';
  const chosen=Chapters.eligibleSections(md).find(x=>x.title==='Methods');
  assert(chosen);
  const output=Chapters.replace(md,chosen.index,'## Methods\n\n**Revised methods** with evidence [P1].\n\n### Subsection\n\nNew nested text');
  assert(output.includes('**Revised methods**'));
  assert.equal(output.slice(0,chosen.start),md.slice(0,chosen.start));
  assert.equal(output.slice(output.indexOf('## Research Gaps')),md.slice(chosen.end));
  assert.throws(()=>Chapters.replace(md,chosen.index,'## Other major section\nContent.\n## Another'),/额外顶级章节/);
  assert(!Chapters.eligibleSections(md).some(x=>x.title==='References'));
  console.log('Conservative one-chapter replacement preserving other chapters passed');
}

function makeStore(){
  const objects=new Map();
  return {
    async save(v){objects.set(v.projectId,JSON.parse(JSON.stringify(v)));objects.set('latest',v.projectId);},
    async load(id){return objects.get(id)?JSON.parse(JSON.stringify(objects.get(id))):null;},
    async loadLatest(){return this.load(objects.get('latest'))},
    async clear(id){objects.delete(id);if(objects.get('latest')===id)objects.delete('latest');},
    objects,
  };
}

async function testCheckpointResumeAndSection(){
  const content=('本文研究拓扑。作者指出跨区域性能尚不稳定，跨区域性能尚不稳定。').repeat(130);
  const fixture={id:23,libraryID:1,deleted:false,isRegularItem:()=>true,
    getField:key=>({title:'Road topology extraction with graph networks',abstractNote:'Road extraction and limitation.',date:'2025'})[key]||'',
    getCreators:()=>[],
    getBestAttachment:async()=>({id:24,attachmentContentType:'application/pdf',attachmentText:Promise.resolve(content)}),
    getAttachments:()=>[24],
  };
  const store=makeStore();
  const calls=[];
  const zotero={Libraries:{userLibraryID:1},Items:{getAsync:async id=>id===23?fixture:null},
    Prefs:{get:()=>undefined,set:()=>{}},logError:()=>{},
    HTTP:{request:async(method,url,options)=>{
      if(method!=='POST')throw new Error('unexpected GET');
      const req=JSON.parse(options.body),prompt=req.messages.at(-1).content;
      calls.push(prompt);
      let answer;
      if(prompt.includes('Return JSON with exactly these array keys'))answer=JSON.stringify({methods:[],contributions:[],limitations:[{claim:'Generalization unstable',quote:'作者指出跨区域性能尚不稳定',interpretation:'author_stated'}],openProblems:[],counterEvidence:[]});
      else if(prompt.includes('Synthesize evidence for paper'))answer=JSON.stringify({methods:[],contributions:[],authorLimitations:['Generalization unstable'],unresolvedProblems:['Transfer'],evidenceIds:['P1-C1-E1-l']});
      else if(prompt.includes('Synthesize ONLY the supplied paper-level evidence'))answer=JSON.stringify({themes:[],establishedLimitations:[],possibleGaps:[{claim:'Transfer remains open',paperIds:['P1'],evidenceIds:['P1-C1-E1-l'],status:'inferred'}],counterExamples:[],uncertainties:[]});
      else answer='Revised paragraph with [P1] citation.';
      return {responseText:JSON.stringify({choices:[{message:{content:answer}}]})};
    }},
  };
  const sandbox={ReviewCore:Core,ReviewNetwork:Network,ReviewCheckpoints:Checkpoints,ReviewPages:Pages,ReviewChapters:Chapters,Zotero:zotero,URL,Promise,console,setTimeout,clearTimeout};
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../addon/content/review-engine.js'),'utf8'),sandbox);
  const rt=()=>sandbox.ReviewRuntime.create({zotero,selectedIDs:[23],libraryID:1,checkpointStore:store});
  const paper={...(await rt().hydrateInitialSelection())[0],id:'P1'};
  const question='跨域道路拓扑模型的泛化局限有哪些？';
  const settings={endpoint:'https://api.openai.com/v1/chat/completions',apiKey:'SECRET_TEST_KEY_DO_NOT_SAVE',model:'mock-model',chunkChars:1100,maxCharsPerPaper:6200,language:'zh-CN',proxyMode:'inherit'};
  let wasInterrupted=false;const a=rt();
  await assert.rejects(a.analyzeEvidence([paper],question,settings,event=>{
    if(event.type==='chunk'&&event.chunk===2){wasInterrupted=true;a.cancel();}
  }),/取消/);
  assert(wasInterrupted,'Must enter second chunk before interruption');
  const saved=await store.loadLatest();
  assert.equal(saved.analyses.length,1);
  assert.equal(saved.analyses[0].chunks.length,1);
  assert(!JSON.stringify([...store.objects.values()]).includes(settings.apiKey),'Never persist secrets in checkpoint');
  assert(!JSON.stringify([...store.objects.values()]).includes(content.slice(0,150)),'No full PDF text in checkpoint');
  const savedCalls=calls.length;
  const b=rt();const events=[];
  const completed=await b.analyzeEvidence([paper],question,settings,e=>events.push(e.type),{resume:true});
  assert.equal(completed.sourceCount,1);
  assert(events.includes('chunk-reused'),'Completed chunks must not be resent');
  assert(calls.length>savedCalls);
  const md='## Introduction\n\nOLD introduction.\n\n## Research Gaps\n\nOLD gap.\n\n## References\n\n[P1] Zhang';
  const updated=await b.regenerateChapter(completed,md,1,settings,{id:'gap',instruction:'Evidence review'});
  assert.equal(updated.draft.split('## Research Gaps')[0],md.split('## Research Gaps')[0]);
  assert.equal(updated.draft.slice(updated.draft.indexOf('## References')),md.slice(md.indexOf('## References')));
  assert(updated.draft.includes('Revised paragraph'));
  await b.saveProjectSnapshot(updated);
  assert((await store.loadLatest()).draft.includes('Revised paragraph'));
  const r=rt();await r.loadLatestCheckpoint();
  await r.saveProjectSnapshot({...updated,draft:updated.draft+' Additional edit.'});
  assert((await store.loadLatest()).draft.includes('Additional edit.'),'Reloading a completed project should allow saving revisions');
  console.log('Chunk checkpoint interruption, resume, no fulltext/keys at rest and chapter persistence passed');
}

(async()=>{await testProxy();await testPages();await testChapters();await testCheckpointResumeAndSection();})().catch(e=>{console.error(e);process.exitCode=1});
