const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {performance} = require('node:perf_hooks');
const baselineRoot = path.resolve(__dirname, './fixtures/v0.3.0');
const optimizedRoot = path.resolve(__dirname, '..');
const load = (root, file) => require(path.join(root, 'addon/content', file));
const oldCore = load(baselineRoot,'review-core.js');
const newCore = load(optimizedRoot,'review-core.js');
const oldPages = load(baselineRoot,'review-pages.js');
const newPages = load(optimizedRoot,'review-pages.js');
const oldCheckpoint = load(baselineRoot,'review-checkpoints.js');
const newCheckpoint = load(optimizedRoot,'review-checkpoints.js');

function claimFixture(){
  const phrase='跨区域道路拓扑泛化能力仍然缺乏充分验证 no reliable cross-region transfer test';
  const source='本文综述了技术路线。'.repeat(460)+phrase+'\n'+('学术研究需要可核对的原文。').repeat(460);
  const rows={};
  for (const kind of ['methods','contributions','limitations','openProblems','counterEvidence']){
    rows[kind]=Array.from({length:3},(_,i)=>({claim:kind+' issue '+i,
      quote:i===2?'fabricated evidence passage':phrase,
      interpretation:i%2?'inferred':'author_stated'}));
  }
  return {source,rows};
}
function reportMedian(fn,rounds=5){
  const arr=[];
  for(let i=0;i<rounds;i++){
    const start=performance.now();fn();arr.push(performance.now()-start);
  }
  arr.sort((a,b)=>a-b);
  return +arr[Math.floor(arr.length/2)].toFixed(2);
}

async function testClaims(){
  const {source,rows}=claimFixture();
  assert.deepEqual(newCore.cleanClaims(rows,source,'P1',1),oldCore.cleanClaims(rows,source,'P1',1),
    'Every extracted claim, ID and verification flag must remain identical');
  for(let j=0;j<16;j++){
    const arr=structuredClone(rows);
    arr.limitations[j%3].quote=['nonexistent source','跨区域道路拓扑泛化能力仍然缺乏充分验证',
      'no reliable cross-region transfer test','此处应该不匹配'][j%4];
    assert.deepEqual(newCore.cleanClaims(arr,source,'P1',j+1),oldCore.cleanClaims(arr,source,'P1',j+1));
  }
  // Search order and similarity scores must remain bit-for-bit identical.
  const query='topology repair cross domain remote sensing';
  const ranker=newCore.makePaperRanker(query);
  for(let i=0;i<250;i++){
    const paper={title:(i%2?'topology repair':'cross domain')+' study '+i,
      abstract:'multi-sensor remote sensing benchmark '+i,keywords:'network gap'};
    assert.equal(ranker(paper),oldCore.rankPaper(query,paper));
    assert.equal(newCore.rankPaper(query,paper),oldCore.rankPaper(query,paper));
  }
  const iterations=140;
  const msBaseline=reportMedian(()=>{for(let i=0;i<iterations;i++)oldCore.cleanClaims(rows,source,'P1',i);});
  const msOptimized=reportMedian(()=>{for(let i=0;i<iterations;i++)newCore.cleanClaims(rows,source,'P1',i);});
  return {iterations,chars:source.length,claims:15,baselineMs:msBaseline,optimizedMs:msOptimized};
}

async function testPages(){
  const count=350;
  const pages=Array.from({length:count},(_,i)=>`PAGE ${i+1}. ${'background research generalization. '.repeat(6)} STRIPE${i+1}uniqueEvidenceLine${i+1} NARRATIVE`);
  const pageNumbers=[1,3,7,14,25,38,49,66,85,106,121,148,169,196,224,259,292,336,350];
  const quotes=pageNumbers.map((page,i)=>({evidenceId:'E'+i,verified:true,quote:`STRIPE${page}uniqueEvidenceLine${page}`}));
  quotes.push({evidenceId:'NOMATCH',verified:true,quote:'there is no such reliable passage anywhere'});
  const runner=async Pages=>{
    let count=0;
    const readPrefix=async n=>{count++;return {text:pages.slice(0,n).join('\n'),totalPages:pages.length};};
    const results=await Pages.locate(quotes,readPrefix,{maxQuotes:20,maxCalls:145});
    return {calls:count,results:Object.fromEntries(results)};
  };
  const old=await runner(oldPages),next=await runner(newPages);
  assert.deepEqual(next.results,old.results,'Physical page position and verification status must not change');
  assert(next.calls<=old.calls,'Shared binary search should not use more PDFWorker prefix calls');
  assert.equal(next.results.NOMATCH.location,'not_found');
  // Single-page, empty quote list, low call-budget and unverified evidence.
  const one=await newPages.locate([{evidenceId:'X',verified:true,quote:'chapter introduction words'}],
    async()=>({text:'chapter introduction words',totalPages:1}));
  assert.equal(one.get('X').pdfPage,1);
  assert.equal((await newPages.locate([],async()=>{throw Error('should not be called')})).size,0);
  const low=await newPages.locate(quotes,async n=>({text:pages.slice(0,n).join('\n'),totalPages:count}),{maxCalls:1});
  const lowOld=await oldPages.locate(quotes,async n=>({text:pages.slice(0,n).join('\n'),totalPages:count}),{maxCalls:1});
  assert.deepEqual(Object.fromEntries(low),Object.fromEntries(lowOld),
    'Low-budget page lookup must preserve baseline statuses and order');
  return {pages:count,quotes:quotes.length,baselinePDFPrefixCalls:old.calls,optimizedPDFPrefixCalls:next.calls};
}

function virtualDisk(){
  const files=new Map();let bytesWritten=0,writes=0;
  return {
    files,get bytesWritten(){return bytesWritten;},get writes(){return writes;},
    io:{
      async makeDirectory(){},
      async writeUTF8(file,body){bytesWritten+=Buffer.byteLength(body);writes++;files.set(file,body);},
      async readUTF8(file){if(!files.has(file))throw Error('NS_ERROR_FILE_NOT_FOUND');return files.get(file);},
      async remove(file){files.delete(file)}
    },
  };
}
function paper(i){return {id:'P'+(i+1),source:'local',title:'Article '+i,itemID:i+1000,authors:['Author'],year:'2024'};}
function analysis(p){return {paper:p,chunks:[],sourceQuality:'fulltext',coverage:1,attachmentID:p.itemID+2000,summary:null};}
function addChunk(entry,index){
  entry.chunks.push({index,claims:Array.from({length:10},(_,k)=>({
    evidenceId:`${entry.paper.id}-C${index}-E${k}-l`,verified:true,
    claim:'Evidence and limitation '+k+' '+('methodological comparison. '.repeat(6)),
    quote:'source text describing genuine tradeoffs. '.repeat(4)}))});
}
async function runStorage(which,papersN=35,chunksN=10){
  const disk=virtualDisk();const cpSystem=which==='baseline'?oldCheckpoint:newCheckpoint;
  const store=cpSystem.createStore({io:disk.io,dir:'/zotero/profile/review',join:path.join});
  const papers=Array.from({length:papersN},(_,i)=>paper(i));
  const settings={endpoint:'https://example.com/v1/chat/completions',model:'model',apiKey:'NEVER_SAVE_THIS_KEY',chunkChars:11000,maxCharsPerPaper:180000,language:'en'};
  const checkpoint=cpSystem.createInitial(papers,'What is not yet solved?',settings);
  await store.save(checkpoint);
  for(const p of papers){
    const a=analysis(p);checkpoint.analyses.push(a);
    for(let j=0;j<chunksN;j++){
      addChunk(a,j+1);
      if(which==='optimized')await store.savePartialAnalysis(checkpoint,a);
      else await store.save(checkpoint);
    }
    a.summary={unresolvedProblems:['generalization'],evidenceIds:[p.id+'-C1-E1-l']};
    if(which==='optimized')await store.save(checkpoint,p.id);
    else await store.save(checkpoint);
  }
  checkpoint.status='evidence-complete';checkpoint.synthesis={possibleGaps:[{claim:'more research'}]};
  await store.save(checkpoint);
  const loaded=await store.loadLatest();
  assert.equal(loaded.analyses.length,papersN);
  assert.equal(loaded.analyses.at(-1).chunks.length,chunksN);
  assert(!JSON.stringify([...disk.files.values()]).includes('NEVER_SAVE_THIS_KEY'));
  return {disk,store,loaded,totalBytes:disk.bytesWritten,writes:disk.writes};
}
async function testCheckpoint(){
  const base=await runStorage('baseline');const next=await runStorage('optimized');
  assert.deepEqual(next.loaded.analyses,base.loaded.analyses,'Recovered paper analyses must match exactly');
  assert.deepEqual(next.loaded.synthesis,base.loaded.synthesis);
  assert(next.totalBytes<base.totalBytes*0.5,'Incremental checkpoints must materially reduce IO');
  // Simulated crash during chunk 3: full project snapshot contains no new data,
  // sidecar must recover the partial and a new run must IGNORE the old sidecar.
  const cpSystem=newCheckpoint,disk=virtualDisk();
  const store=cpSystem.createStore({io:disk.io,dir:'/test',join:path.join});
  const settings={endpoint:'https://api.test',model:'M',chunkChars:11000,maxCharsPerPaper:180000,language:'en'};
  const docs=[paper(0),paper(1)];const cp=cpSystem.createInitial(docs,'Test recovery',settings);
  await store.save(cp);
  const a=analysis(docs[0]);cp.analyses.push(a);
  addChunk(a,1);await store.savePartialAnalysis(cp,a);
  addChunk(a,2);await store.savePartialAnalysis(cp,a);
  const recovered=await store.loadLatest();
  assert.equal(recovered.analyses[0].chunks.length,2);
  const again=cpSystem.createInitial(docs,'Test recovery',settings);
  assert.equal(again.projectId,cp.projectId);
  assert.notEqual(again.runId,cp.runId);
  await store.save(again);
  const isolated=await store.loadLatest();
  assert.equal(isolated.analyses.length,0,'Old sidecar from same signature must not contaminate a new run');
  // Interruption AFTER the consolidated project has been atomically saved,
  // but BEFORE its stale sidecar is deleted must keep the newer summary.
  const newPart=analysis(docs[0]);addChunk(newPart,1);
  again.analyses=[newPart];
  await store.savePartialAnalysis(again,newPart);
  newPart.summary={methods:['verified final reducer'],evidenceIds:['P1-C1-E1-l']};
  const originalRemove=disk.io.remove;
  disk.io.remove=async pathname=>{
    if(pathname.endsWith('.paper-P1.json'))throw Error('simulated crash before sidecar removal');
    return originalRemove(pathname);
  };
  await assert.rejects(store.save(again,'P1'),/simulated crash/);
  const safe=await store.loadLatest();
  assert.deepEqual(safe.analyses[0].summary,newPart.summary,
    'A stale sidecar must never overwrite a newer full-paper summary');
  disk.io.remove=originalRemove;
  await store.clear(cp.projectId);
  assert.equal((await store.loadLatest()),null);
  // A real v0.3.0 schema checkpoint has no runId; it must still load.
  const legacyDisk=virtualDisk();
  const oldStore=oldCheckpoint.createStore({io:legacyDisk.io,dir:'/legacy',join:path.join});
  const newStore=newCheckpoint.createStore({io:legacyDisk.io,dir:'/legacy',join:path.join});
  const oldProject=oldCheckpoint.createInitial(docs,'Legacy checkpoint',settings);
  oldProject.analyses.push({...analysis(docs[0]),skipped:true,warning:'PDF absent'});
  await oldStore.save(oldProject);
  const loadedLegacy=await newStore.loadLatest();
  assert.equal(loadedLegacy.runId,undefined);
  assert.deepEqual(loadedLegacy.analyses,oldProject.analyses);
  return {papers:35,chunksPerPaper:10,baselineMB:+(base.totalBytes/1048576).toFixed(2),
    optimizedMB:+(next.totalBytes/1048576).toFixed(2),
    diskReductionPct:+(100*(base.totalBytes-next.totalBytes)/base.totalBytes).toFixed(1),
    baselineWrites:base.writes,optimizedWrites:next.writes};
}

async function main(){
  const claims=await testClaims();
  const pages=await testPages();
  const checkpoint=await testCheckpoint();
  const out={claims,pages,checkpoint};
  console.log('Performance regression and recovery tests passed');
  console.log(JSON.stringify(out,null,2));
}
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1});
module.exports={testClaims,testPages,testCheckpoint};
