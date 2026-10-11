/* Local, resumable project checkpoints. No API secrets or entire PDF text stored. */
var ReviewCheckpoints=(function(){
  'use strict';
  const VERSION=1;
  function signature(papers,question,settings){
    return JSON.stringify({question:String(question||'').trim(),papers:papers.map(p=>({source:p.source,itemID:p.itemID||null,openAlexID:p.openAlexID||null,doi:p.doi||'',title:p.title||''})),
      extraction:{endpoint:settings.endpoint,model:settings.model,chunkChars:settings.chunkChars,maxCharsPerPaper:settings.maxCharsPerPaper,language:settings.language}});
  }
  function sourceFingerprint(chunks){
    // Non-cryptographic fingerprint only for detecting edited/replaced PDFs at resume.
    // The original PDF text is not persisted.
    let a=0x811c9dc5,b=0x9e3779b9;
    for(const chunk of chunks||[]){
      const text=String(chunk.text||'');
      for(let i=0;i<text.length;i++){
        const code=text.charCodeAt(i);
        a=Math.imul(a^code,0x01000193)>>>0;
        b=Math.imul(b+code,0x85ebca6b)>>>0;
      }
    }
    return a.toString(16)+':'+b.toString(16);
  }
  function projectID(sig){
    let a=0x811c9dc5,b=0x9e3779b9;
    for(let i=0;i<sig.length;i++){
      a=Math.imul(a^sig.charCodeAt(i),0x01000193)>>>0;
      b=Math.imul(b+(sig.charCodeAt(i)*31),0x85ebca6b)>>>0;
    }
    return 'review-'+a.toString(16).padStart(8,'0')+'-'+b.toString(16).padStart(8,'0');
  }
  function cleanInput({papers,question,settings}){
    // Never copy the API key or proxy passwords into checkpoints.
    return {question:String(question||''),papers:JSON.parse(JSON.stringify(papers)),
      settings:{endpoint:settings.endpoint,model:settings.model,chunkChars:settings.chunkChars,
        maxCharsPerPaper:settings.maxCharsPerPaper,language:settings.language,profileName:settings.profileName||''}};
  }
  function createStore({io,dir,join}){
    if(!io||!dir||!join)throw new Error('缺少本地持久存储接口');
    const pathFor=id=>join(dir,id+'.json');
    async function ensure(){await io.makeDirectory(dir,{ignoreExisting:true});}
    async function writeAtomic(path,value){
      await ensure();
      const body=JSON.stringify(value);
      const tmp=path+'.tmp';
      await io.writeUTF8(path,body,{tmpPath:tmp});
    }
    async function readFile(path){
      try{return JSON.parse(await io.readUTF8(path));}
      catch(e){
        if(/not found|no such file|NS_ERROR_FILE_NOT_FOUND/i.test(String(e)))return null;
        throw e;
      }
    }
    return {
      async save(checkpoint){
        if(checkpoint.version!==VERSION||!checkpoint.projectId||!checkpoint.signature)
          throw new Error('保存中间结果的数据格式不正确');
        checkpoint.updatedAt=new Date().toISOString();
        await writeAtomic(pathFor(checkpoint.projectId),checkpoint);
        await writeAtomic(pathFor('latest'),{version:VERSION,projectId:checkpoint.projectId,updatedAt:checkpoint.updatedAt});
        return checkpoint;
      },
      async load(id){const raw=await readFile(pathFor(id));return raw?.version===VERSION?raw:null;},
      async loadLatest(){
        const index=await readFile(pathFor('latest'));
        return index?.projectId?this.load(index.projectId):null;
      },
      async clear(id){
        try{await io.remove(pathFor(id),{ignoreAbsent:true});}catch(_){}
        const latest=await readFile(pathFor('latest'));
        if(latest?.projectId===id)await io.remove(pathFor('latest'),{ignoreAbsent:true});
      },
    };
  }
  function createInitial(papers,question,settings){
    const sig=signature(papers,question,settings);
    return {version:VERSION,projectId:projectID(sig),signature:sig,
      input:cleanInput({papers,question,settings}),analyses:[],groups:[],synthesis:null,
      draft:'',templateId:null,status:'processing',updatedAt:new Date().toISOString()};
  }
  function matches(stored,papers,question,settings){
    return !!stored&&stored.version===VERSION&&stored.signature===signature(papers,question,settings);
  }
  return {VERSION,signature,projectID,sourceFingerprint,createInitial,createStore,matches};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ReviewCheckpoints;
