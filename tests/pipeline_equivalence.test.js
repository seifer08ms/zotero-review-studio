const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const legacy=path.resolve(__dirname,'fixtures/v0.3.0');
const CoreNew=require('../addon/content/review-core.js');
const CoreOld=require('./fixtures/v0.3.0/addon/content/review-core.js');
const CPOld=require('./fixtures/v0.3.0/addon/content/review-checkpoints.js');
const CPNew=require('../addon/content/review-checkpoints.js');
const Network=require('../addon/content/review-network.js');
const Pages=require('../addon/content/review-pages.js');
const Chapters=require('../addon/content/review-chapters.js');
const sentence=('Authors explicitly report that transfer across regions is still unstable. '+
  'A well controlled benchmark indicates boundary reconstruction can fail in sparse areas. ');
const source=sentence.repeat(110);
function run(old){
  const prompts=[];
  const item={id:100,libraryID:1,deleted:false,isRegularItem:()=>true,
    getField:f=>({title:'Regional robustness in connectivity networks',abstractNote:'Robustness problems and methodological limits',year:'2025',DOI:'10.0/1'})[f]||'',
    getCreators:()=>[{lastName:'Wang'}],
    getBestAttachment:async()=>({id:101,attachmentContentType:'application/pdf',attachmentText:Promise.resolve(source)}),
    getAttachments:()=>[101]};
  const zotero={Libraries:{userLibraryID:1},Items:{getAsync:async id=>id===100?item:null},Prefs:{get:()=>undefined,set:()=>{}},logError:()=>{},
    HTTP:{request:async(_method,_url,req)=>{
      const payload=JSON.parse(req.body);
      prompts.push(payload);
      const prompt=payload.messages.at(-1).content;
      let data;
      if(prompt.includes('Return JSON with exactly these array keys')){
        data={methods:[],contributions:[],limitations:[{claim:'The cross-region transfer remains limited',
          quote:'transfer across regions is still unstable',interpretation:'author_stated'}],openProblems:[],counterEvidence:[]};
      }else if(prompt.includes('Synthesize evidence for paper')){
        data={methods:[],contributions:[],authorLimitations:['Transfer unstable'],inferredLimitations:[],
          unresolvedProblems:['Domain adaptation'],evidenceIds:['P1-C1-E1-l'],confidenceNotes:'Supported'};
      }else if(prompt.includes('Synthesize ONLY the supplied paper-level evidence')){
        data={themes:[],establishedLimitations:[{claim:'Cross region transfer limitations',paperIds:['P1'],evidenceIds:['P1-C1-E1-l'],status:'author_stated'}],possibleGaps:[],counterExamples:[],uncertainties:[]};
      }else return {responseText:JSON.stringify({choices:[{message:{content:'## Gap analysis\nEvidence [P1]\n\n## References\n[P1] Citation.'}}]})};
      return {responseText:JSON.stringify({choices:[{message:{content:JSON.stringify(data)}}]})};
    }}};
  const core=old?CoreOld:CoreNew;
  const cp=old?CPOld:CPNew;
  const ctx={ReviewCore:core,ReviewCheckpoints:cp,ReviewNetwork:Network,ReviewPages:Pages,
    ReviewChapters:Chapters,Zotero:zotero,URL,Promise,console,setTimeout,clearTimeout};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(old?legacy:root,'addon/content/review-engine.js'),'utf8'),ctx);
  return {prompts,zotero,create:()=>ctx.ReviewRuntime.create({zotero,selectedIDs:[100],libraryID:1})};
}
(async()=>{
  const older=run(true),newer=run(false);
  const question='What are verified cross-region connectivity limitations?';
  const settings={endpoint:'https://api.example.test/v1/chat/completions',apiKey:'local-test-key',model:'mock',
    chunkChars:1800,maxCharsPerPaper:7400,language:'en',proxyMode:'inherit'};
  const template=CoreNew.BUILT_IN_TEMPLATES[0];
  async function workflow(env){
    const rt=env.create();const papers=[{...(await rt.hydrateInitialSelection())[0],id:'P1'}];
    const evidence=await rt.analyzeEvidence(papers,question,settings,()=>{});
    return rt.generateDraft(evidence,settings,template,()=>{});
  }
  const previous=await workflow(older);
  const latest=await workflow(newer);
  assert.equal(older.prompts.length,newer.prompts.length,'Model request count must remain unchanged');
  assert.deepEqual(newer.prompts,older.prompts,'Every outbound prompt and parameter must be identical');
  const canonical=v=>JSON.parse(JSON.stringify(v));
  assert.deepEqual(canonical(latest.analyses),canonical(previous.analyses));
  assert.deepEqual(canonical(latest.synthesis),canonical(previous.synthesis));
  assert.equal(latest.draft,previous.draft);
  assert.deepEqual(canonical(latest.warnings),canonical(previous.warnings));
  assert.equal(latest.sourceCount,previous.sourceCount);
  console.log(`Exact end-to-end equivalence: ${newer.prompts.length} same model requests, unchanged evidence, Gap and draft`);
})().catch(e=>{console.error(e);process.exitCode=1});
