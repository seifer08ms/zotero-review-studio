window.alerts=[];window.alert=(msg)=>window.alerts.push(msg);
window.confirm=()=>true;
let fakePref={};let remoteCalls=[];
let item={id:12,libraryID:1,deleted:false,isRegularItem:()=>true,
 getField:(k)=>({title:'Topology Road Extraction Study',abstractNote:'Study of roads and networks',date:'2025',DOI:'10.1234/r',url:''})[k]||'',
 getCreators:()=>[{lastName:'Zhang'}],getBestAttachment:async()=>({id:99,attachmentContentType:'application/pdf',attachmentText:Promise.resolve(('Current methods reconstruct topology for roads. Authors note poor cross region generalization and inaccurate road connectivity in occluded scenes. ').repeat(25))}),getAttachments:()=>[99]};
window.Zotero={DataDirectory:{dir:'/tmp/studio-smoke'},PDFWorker:{getFullText:async()=>({text:'',totalPages:1})},Libraries:{userLibraryID:1},Items:{getAsync:async id=>id===12?item:null},
 Prefs:{get:k=>fakePref[k],set:(k,val)=>fakePref[k]=val},
 Search:class{addCondition(){}async search(){return [12]}},
 logError:e=>console.log('ZOTERO ERROR',e),
 Utilities:{Internal:{copyTextToClipboard:s=>{window.copied=s}}},
 Item:class{async saveTx(){this.id=100}setNote(h){this.html=h}},
 HTTP:{request:async(method,url,options)=>{
  remoteCalls.push({method,url,body:options?.body||''});
  if(method==='GET')return {responseText:JSON.stringify({results:[]})};
  const req=JSON.parse(options.body),prompt=req.messages.at(-1).content;
  let out;
  if(prompt==='OK')out='OK';
  else if(prompt.includes('Return JSON with exactly these array keys'))out=JSON.stringify({methods:[],contributions:[],limitations:[{claim:'Limited generalization',quote:'poor cross region generalization',interpretation:'author_stated'}],openProblems:[],counterEvidence:[]});
  else if(prompt.includes('Synthesize evidence for paper'))out=JSON.stringify({methods:[],contributions:[],authorLimitations:['Cross region'],inferredLimitations:[],unresolvedProblems:['Topology'],contextAndScope:'roads',evidenceIds:['P1-C1-E1-l'],disagreements:[],confidenceNotes:'verified'});
  else if(prompt.includes('Synthesize ONLY the supplied paper-level evidence'))out=JSON.stringify({themes:[],establishedLimitations:[],possibleGaps:[{claim:'Robust topology across domains',paperIds:['P1'],evidenceIds:['P1-C1-E1-l'],status:'inferred'}],counterExamples:[],uncertainties:[]});
  else out='## Research Gaps\nDomain generalization needs better evaluation [P1].';
  return {responseText:JSON.stringify({choices:[{message:{content:out}}]})};
 }}}
window.arguments=[{zotero:window.Zotero,selectedIDs:[12],libraryID:1}];
window._debugFake={prefs:fakePref,calls:remoteCalls};

window.IOUtils={makeDirectory:async()=>{},writeUTF8:async()=>{},readUTF8:async()=>{throw Error('NS_ERROR_FILE_NOT_FOUND')},remove:async()=>{}};
window.PathUtils={join:(...a)=>a.join('/')};
