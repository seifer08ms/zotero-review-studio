const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const Core=require('../addon/content/review-core.js');
const ReviewCheckpoints=require('../addon/content/review-checkpoints.js');
const ReviewPages=require('../addon/content/review-pages.js');
const ReviewChapters=require('../addon/content/review-chapters.js');
const ReviewNetwork=require('../addon/content/review-network.js');
const content='本文采用图神经网络提取道路拓扑并估计连通性。作者指出跨区域性能尚不稳定，尤其面对遮挡场景仍有明显退化。'.repeat(25);
let httpCalls=[];let notes=[];
const fixture={
  id:12,libraryID:1,deleted:false,
  isRegularItem:()=>true,
  getField:(field)=>({title:'Graph Road Extraction',abstractNote:'Road topology extraction and gaps',date:'2025',DOI:'10.1234/roads',url:''})[field]||'',
  getCreators:()=>[{lastName:'Zhang'}],
  getBestAttachment:async()=>({id:99,attachmentContentType:'application/pdf',attachmentText:Promise.resolve(content)}),
  getAttachments:()=>[99],
};
const zotero={
  Libraries:{userLibraryID:1},
  Items:{getAsync:async(id)=>id===12?fixture:null},
  Search:class{addCondition(){} async search(){return [12]}},
  Prefs:{get:()=>undefined,set:()=>{}},
  logError:(e)=>{throw e},
  Item:class {constructor(){} setNote(html){this.html=html}async saveTx(){this.id=17;notes.push(this)}},
  HTTP:{request:async(method,url,options)=>{
    httpCalls.push({method,url,body:options?.body});
    if(method==='GET')return {responseText:JSON.stringify({results:[{id:'https://openalex.org/W1',display_name:'Relevant Work',publication_year:2025,abstract_inverted_index:{'Network':[0],'connectivity':[1],'research':[2]},doi:'https://doi.org/10.0/xy',authorships:[{author:{display_name:'A. Smith'}}]}]})};
    const req=JSON.parse(options.body),p=req.messages.at(-1).content;
    let content;
    if(p.includes('Return JSON with exactly these array keys'))content=JSON.stringify({methods:[],contributions:[],limitations:[{claim:'Generalization remains difficult',quote:'作者指出跨区域性能尚不稳定',interpretation:'author_stated'}],openProblems:[],counterEvidence:[]});
    else if(p.includes('Synthesize evidence for paper'))content=JSON.stringify({methods:[],contributions:[],authorLimitations:['Cross domain performance'],inferredLimitations:[],unresolvedProblems:['Generalization'],contextAndScope:'Roads',evidenceIds:['P1-C1-E1-l'],disagreements:[],confidenceNotes:'Source matched'});
    else if(p.includes('Synthesize ONLY the supplied paper-level evidence'))content=JSON.stringify({themes:[],establishedLimitations:[],possibleGaps:[{claim:'Domain generalization',paperIds:['P1','P999'],evidenceIds:['P1-C1-E1-l','fabricated'],status:'mixed'}],counterExamples:[],uncertainties:[]});
    else content='## Research Gaps\nDomain generalization needs testing [P1].\n\n## References\n[P1] Zhang (2025). Graph Road Extraction.';
    return {responseText:JSON.stringify({choices:[{message:{content}}]})};
  }}
};
const sandbox={ReviewCore:Core,ReviewCheckpoints,ReviewPages,ReviewChapters,ReviewNetwork,Zotero:zotero,URL,Promise,console,setTimeout,clearTimeout};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../addon/content/review-engine.js'),'utf8'),sandbox);
const runtime=sandbox.ReviewRuntime.create({zotero,selectedIDs:[12],libraryID:1});
(async()=>{
  assert.equal((await runtime.hydrateInitialSelection()).length,1);
  const online=await runtime.searchOnline('network connectivity');
  assert.equal(online[0].source,'online');
  assert(online[0].abstract.includes('Network'));
  assert(!httpCalls.find(x=>x.method==='GET').url.includes('filter=type:article'));
  const reverse=await runtime.searchGapCandidates({claim:'Domain generalization remains open'},'road extraction',[12],()=>{});
  assert.equal(reverse.candidates[0].openAlexID,'https://openalex.org/W1');
  assert(reverse.query.includes('Domain generalization remains open'));
  const input={...(await runtime.hydrateInitialSelection())[0],id:'P1'};
  const template=Core.BUILT_IN_TEMPLATES[0];
  const output=await runtime.analyzeMany([input],'道路跨区域泛化还存在什么问题和研究空白？',{
    endpoint:'https://api.openai.com/v1/chat/completions',apiKey:'fake-key',
    model:'mock-model',chunkChars:3000,maxCharsPerPaper:6500,language:'zh-CN',
  },template,()=>{});
  assert.equal(output.sourceCount,1);
  assert.equal(output.synthesis.possibleGaps[0].supportingPaperCount,1);
  assert.deepEqual([...output.synthesis.possibleGaps[0].evidenceIds],['P1-C1-E1-l']);
  assert(!output.warnings.length);
  const beforeEvidence=httpCalls.filter(x=>x.method==='POST').length;
  const staged=await runtime.analyzeEvidence([input],'道路跨区域泛化还存在什么问题和研究空白？',{
    endpoint:'https://api.openai.com/v1/chat/completions',apiKey:'fake-key',
    model:'mock-model',chunkChars:3000,maxCharsPerPaper:6500,language:'zh-CN',
  },()=>{});
  assert.equal(staged.draft,'','Stage 1 must not generate draft');
  const evidenceCalls=httpCalls.slice(-1)[0];
  assert(!evidenceCalls.body.includes('scientific review writer'),'No automatic drafting');
  assert.equal(staged.sourceCount,1);
  const completed=await runtime.generateDraft(staged,{
    endpoint:'https://api.openai.com/v1/chat/completions',apiKey:'fake-key',
    model:'mock-model',language:'zh-CN',
  },template,()=>{});
  assert(completed.draft.includes('Research Gaps'));
  assert(httpCalls.filter(x=>x.method==='POST').length>beforeEvidence);
  // Incremental reuse must respect the extraction configuration and retry a
  // metadata-only paper, because a PDF may have been attached since the last run.
  const cfg={endpoint:'https://api.openai.com/v1/chat/completions',model:'mock-model',
    chunkChars:3000,maxCharsPerPaper:6500,language:'zh-CN',matrixExtraction:true};
  const reusedEvents=[];
  await runtime.analyzeEvidence([input],'道路跨区域泛化还存在什么问题和研究空白？',cfg,
    event=>reusedEvents.push(event.type),{previousResult:{
      question:'道路跨区域泛化还存在什么问题和研究空白？',
      analysisConfig:{...cfg,matrixExtraction:false},
      analyses:[{paper:input,summary:{},skipped:false}],
    }});
  assert(reusedEvents.includes('paper'),'A changed extraction configuration must not reuse old evidence');
  const retryEvents=[];
  await runtime.analyzeEvidence([input],'道路跨区域泛化还存在什么问题和研究空白？',cfg,
    event=>retryEvents.push(event.type),{previousResult:{
      question:'道路跨区域泛化还存在什么问题和研究空白？',analysisConfig:{...cfg,matrixExtraction:false},
      analyses:[{paper:input,summary:null,skipped:true,error:null}],
    }});
  assert(retryEvents.includes('paper'),'Metadata-only papers must be retried for a newly available PDF');
  const note=await runtime.saveNote(output.draft);
  assert.equal(note.id,17);
  assert(notes[0].html.includes('Research Gaps'));
  assert(httpCalls.filter(x=>x.method==='POST').length>=3);
  console.log('Mock end-to-end review pipeline passed');
})().catch(e=>{console.error(e);process.exitCode=1});
