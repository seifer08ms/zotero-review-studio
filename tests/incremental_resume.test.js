// Exercise the NEW atomic on-disk partial checkpoint path end-to-end.
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const Core=require('../addon/content/review-core.js');
const Profiles=require('../addon/content/review-profiles.js');
const Network=require('../addon/content/review-network.js');
const Checkpoints=require('../addon/content/review-checkpoints.js');
const Pages=require('../addon/content/review-pages.js');
const Chapters=require('../addon/content/review-chapters.js');
(async()=>{
  const fsMock=new Map();
  const io={
    makeDirectory:async()=>{},
    writeUTF8:async(filepath,str)=>{fsMock.set(filepath,str)},
    readUTF8:async filepath=>{if(!fsMock.has(filepath))throw Error('NS_ERROR_FILE_NOT_FOUND');return fsMock.get(filepath)},
    remove:async filepath=>{fsMock.delete(filepath)},
  };
  const store=Checkpoints.createStore({io,dir:'/mock/zotero/review',join:path.join});
  const fullText=('本文研究跨区域道路连通性。作者指出跨区域性能尚不稳定。').repeat(250);
  const item={id:22,libraryID:1,deleted:false,isRegularItem:()=>true,
    getField:k=>({title:'Road topology benchmark study',abstractNote:'Cross region study',year:'2025'})[k]||'',
    getCreators:()=>[],getAttachments:()=>[55],
    getBestAttachment:async()=>({id:55,attachmentContentType:'application/pdf',attachmentText:Promise.resolve(fullText)})};
  let chunkPrompts=0;
  const zotero={Libraries:{userLibraryID:1},Items:{getAsync:async id=>id===22?item:null},Prefs:{get:()=>null,set:()=>{}},
    logError:e=>{throw e},HTTP:{request:async(method,url,options)=>{
      const prompt=JSON.parse(options.body).messages.at(-1).content;
      let data;
      if(prompt.includes('Return JSON with exactly these array keys')){
        chunkPrompts++;
        data={methods:[],contributions:[],limitations:[{claim:'Limitation',quote:'作者指出跨区域性能尚不稳定',interpretation:'author_stated'}],openProblems:[],counterEvidence:[]};
      }else if(prompt.includes('Synthesize evidence for paper')){
        data={methods:[],contributions:[],authorLimitations:['Limitation'],evidenceIds:['P1-C1-E1-l']};
      }else if(prompt.includes('Synthesize ONLY the supplied paper-level evidence')){
        data={themes:[],establishedLimitations:[],possibleGaps:[{claim:'Transfer',paperIds:['P1'],evidenceIds:['P1-C1-E1-l']}],counterExamples:[],uncertainties:[]};
      }else throw Error('Unexpected prompt '+prompt.slice(0,100));
      return {responseText:JSON.stringify({choices:[{message:{content:JSON.stringify(data)}}]})};
    }}};
  const ctx={ReviewCore:Core,ReviewProfiles:Profiles,ReviewCheckpoints:Checkpoints,ReviewNetwork:Network,
    ReviewPages:Pages,ReviewChapters:Chapters,Zotero:zotero,URL,Promise,console,setTimeout,clearTimeout};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../addon/content/review-engine.js'),'utf8'),ctx);
  const runtime=()=>ctx.ReviewRuntime.create({zotero,selectedIDs:[22],libraryID:1,checkpointStore:store});
  const paper={...(await runtime().hydrateInitialSelection())[0],id:'P1'};
  const question='道路拓扑在跨地区泛化时还存在哪些问题？';
  const settings={endpoint:'https://api.test/chat/completions',model:'mock',apiKey:'DO_NOT_PERSIST_REAL_SECRET',
    chunkChars:1200,maxCharsPerPaper:6500,language:'zh-CN',proxyMode:'inherit'};
  const a=runtime();
  await assert.rejects(a.analyzeEvidence([paper],question,settings,event=>{
    if(event.type==='chunk'&&event.chunk===2)a.cancel();
  }),/取消/);
  const cp=await store.loadLatest();
  assert.equal(cp.analyses.length,1);
  assert.equal(cp.analyses[0].chunks.length,1);
  assert([...fsMock.keys()].some(k=>k.includes('.paper-P1.json')),'Partial sidecar must exist after interruption');
  const diskText=[...fsMock.values()].join('');
  assert(!diskText.includes(settings.apiKey));
  assert(!diskText.includes(fullText.slice(0,500)));
  const callsBefore=chunkPrompts;
  const b=runtime(),events=[];
  const done=await b.analyzeEvidence([paper],question,settings,e=>events.push(e.type),{resume:true});
  assert.equal(done.sourceCount,1);
  assert(events.includes('chunk-reused'),'Resume must skip an already processed PDF chunk');
  assert(chunkPrompts>callsBefore);
  const final=await store.loadLatest();
  assert(final.synthesis?.possibleGaps?.length===1);
  assert.equal(final.analyses[0].chunks.length,done.analyses[0].chunks.length);
  assert(![...fsMock.keys()].some(k=>k.includes('.paper-P1.json')),'Completed sidecar must be cleared');
  console.log('Atomic incremental chunk checkpoint, interruption and true resume passed');
})().catch(e=>{console.error(e);process.exitCode=1});
