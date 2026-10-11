const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Core = require('../addon/content/review-core.js');
const ReviewCheckpoints=require('../addon/content/review-checkpoints.js');
const ReviewPages=require('../addon/content/review-pages.js');
const ReviewChapters=require('../addon/content/review-chapters.js');
const ReviewNetwork=require('../addon/content/review-network.js');
const exemplarText = [
  '1. Introduction. Survey scope and inclusion criteria. '.repeat(55),
  '\n2. Taxonomy. Group methods by assumptions, costs and data requirements. '.repeat(45),
  '\n3. Method comparisons. Compare benchmark datasets and experimental settings. '.repeat(45),
  '\n4. Open challenges. Remaining bottlenecks and evaluation bias. '.repeat(45),
  '\n5. Future research. Validation protocols and limitations. '.repeat(45),
  '\n6. Conclusions. Summary of research paths. '.repeat(45),
].join('\n');
let externalCalls=0;
let noteSaves=0;
let memorySettings={};
const referenceItem = {
  id:41,libraryID:1,deleted:false,
  isRegularItem:()=>true,
  getField:k=>({title:'Existing Survey on Topology',abstractNote:'survey',DOI:'10.0/survey',year:'2024'})[k]||'',
  getCreators:()=>[{lastName:'Author'}],
  getBestAttachment:async()=>({id:42,attachmentContentType:'application/pdf',attachmentText:Promise.resolve(exemplarText)}),
  getAttachments:()=>[42],
};
const fakeModel = (prompt)=>{
  if(prompt.includes('EXISTING REVIEW PAPER titled')) {
    return JSON.stringify({
      observedHeadings:[{heading:'Taxonomy',purpose:'classify methods',level:1}],
      argumentMoves:['scope to taxonomy to gap assessment'],
      classificationAxes:['assumptions','inputs'],
      comparisonPatterns:['comparison of datasets'],
      gapAnalysisPatterns:['empirical shortcomings to validation plans'],
      visualizationPatterns:['method comparison table'],
      uncertainties:[],
    });
  }
  if(prompt.includes('Synthesize these observed STRUCTURAL findings')) {
    return JSON.stringify({observedHeadings:[],argumentMoves:['scoping','taxonomy'],classificationAxes:['inputs'],comparisonPatterns:['experiments'],gapAnalysisPatterns:['validation'],visualizationPatterns:['matrix'],uncertainties:[]});
  }
  if(prompt.includes('Develop an EDITABLE, REUSABLE')) {
    return JSON.stringify({
      reviewArchetype:'Taxonomy-led methods review with research gaps',
      structuralAnalysis:{
        sectionSequence:[{title:'Introduction',purpose:'scope'},{title:'Methods',purpose:'comparison'}],
        argumentFlow:['problem framing','taxonomy','comparison','future directions'],
        classificationStrategy:'methods organized by assumptions',
        comparisonAxes:['datasets','robustness'],
        gapAnalysisMethod:'separate observed method limits from potential open issues',
        tableFigureFunctions:['redesigned evidence matrix'],strengths:['clear organizing logic'],
        limitations:['not comprehensive'],uncertainties:['some charts not recoverable'],
      },
      template:{
        name:'Taxonomy Based Review',
        sections:[
          {title:'Scope & Questions',objective:'define inclusion scope',evidenceRequirements:['selection protocol']},
          {title:'Method Families',objective:'organize categories',subsections:['assumptions']},
          {title:'Critical Comparison',objective:'compare evaluations',comparisonAxes:['robustness']},
          {title:'Contradictions and Gaps',objective:'contrast verified limits against open problems'},
          {title:'Future Research',objective:'derive falsifiable experiments'},
        ],
        writingRules:['new topic only; no copied results'],
        gapChecklist:['author stated vs inferred','look for counterexamples'],
        recommendedTables:['method-by-evidence matrix'],
      }
    });
  }
  throw new Error('Unexpected prompt '+prompt.slice(0,140));
};
const z={
  Libraries:{userLibraryID:1},
  Items:{getAsync:async id=>id===41?referenceItem:null},
  Prefs:{get:(key)=>memorySettings[key],set:(key,val)=>memorySettings[key]=val},
  Search:class{addCondition(){} async search(){return [41]}},
  HTTP:{request:async(method,url,options)=>{
    assert.equal(method,'POST');
    assert.equal(options.followRedirects,false);
    assert.equal(options.logBodyLength,0);
    externalCalls++;
    const req=JSON.parse(options.body);
    return {responseText:JSON.stringify({choices:[{message:{content:fakeModel(req.messages.at(-1).content)}}]})};
  }},
  logError:e=>{throw e},
  Item:class{async saveTx(){noteSaves++}},
};
const sandbox={ReviewCore:Core,ReviewCheckpoints,ReviewPages,ReviewChapters,ReviewNetwork,Zotero:z,URL,Promise,console,setTimeout,clearTimeout};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../addon/content/review-engine.js'),'utf8'),sandbox);
const run=sandbox.ReviewRuntime.create({zotero:z,selectedIDs:[41],libraryID:1});
(async()=>{
  const p=(await run.hydrateInitialSelection())[0];
  const steps=[];
  const result=await run.extractExemplar(p,{
    endpoint:'https://api.openai.com/v1/chat/completions',model:'mock-model',apiKey:'sample-key',
    chunkChars:3100,maxTemplateChars:16000,language:'zh-CN',
  },event=>steps.push(event));
  assert.equal(result.sourceQuality,'fulltext');
  assert(result.coverage<1, 'sampling coverage must be flagged');
  assert(result.truncated);
  assert(result.chunkCount>=3);
  assert(steps.some(s=>s.type==='exemplar-template'));
  assert(externalCalls>4);
  assert(result.template.instruction.includes('Gap'));
  assert(result.template.sections.length>=5);
  assert(result.report.includes('Taxonomy'));
  assert.equal(noteSaves,0,'exemplar operation must not save bibliography evidence');
  assert(!result.template.instruction.includes(exemplarText.slice(0,70)),'do not copy source prose');
  assert.throws(()=>Core.normalizeExemplarTemplate({template:{sections:[]}},'test',1),/至少 3 个有效章节/);
  const many=await run.extractExemplar(p,{
    endpoint:'https://api.openai.com/v1/chat/completions',model:'mock-model',apiKey:'sample-key',
    chunkChars:1200,maxTemplateChars:16000,language:'zh-CN',
  },event=>steps.push(event));
  assert(many.chunkCount>9);
  assert(steps.some(s=>s.type==='exemplar-reduce'),'hierarchical reducer should execute for long source');
  const noPdf={...p,itemID:91};
  await assert.rejects(()=>run.extractExemplar(noPdf,{maxTemplateChars:16000},()=>{}),/Zotero 条目不存在/);
  console.log('Review exemplar pipeline, hierarchical reduction, and validation tests passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
