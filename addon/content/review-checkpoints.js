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
    function paperPath(projectId,paperId){
      // Paper IDs are generated locally (P1, P2 ...), never an untrusted path.
      if(!/^[A-Za-z0-9_-]{1,80}$/.test(String(paperId)))
        throw new Error('不安全的论文缓存 ID');
      return join(dir,projectId+'.paper-'+paperId+'.json');
    }
    async function ensure(){await io.makeDirectory(dir,{ignoreExisting:true});}
    async function writeAtomic(path,value){
      await ensure();
      const body=JSON.stringify(value);
      await io.writeUTF8(path,body,{tmpPath:path+'.tmp'});
    }
    async function readFile(path){
      try{return JSON.parse(await io.readUTF8(path));}
      catch(e){
        if(/not found|no such file|NS_ERROR_FILE_NOT_FOUND/i.test(String(e)))return null;
        throw e;
      }
    }
    async function markLatest(checkpoint){
      checkpoint.updatedAt=new Date().toISOString();
      await writeAtomic(pathFor('latest'),{
        version:VERSION,projectId:checkpoint.projectId,updatedAt:checkpoint.updatedAt
      });
    }
    return {
      // Full snapshot is written at project creation, after each PAPER, and
      // after synthesis. Per-chunk checkpoints use much smaller atomic sidecars.
      async save(checkpoint,completedPaperID=null){
        if(checkpoint.version!==VERSION||!checkpoint.projectId||!checkpoint.signature)
          throw new Error('保存中间结果的数据格式不正确');
        checkpoint.updatedAt=new Date().toISOString();
        checkpoint.checkpointSerial=(Number(checkpoint.checkpointSerial)||0)+1;
        await writeAtomic(pathFor(checkpoint.projectId),checkpoint);
        if(completedPaperID){
          await io.remove(paperPath(checkpoint.projectId,completedPaperID),{ignoreAbsent:true});
        }
        await markLatest(checkpoint);
        return checkpoint;
      },
      async savePartialAnalysis(checkpoint,analysis){
        if(checkpoint.version!==VERSION||!checkpoint.projectId||!checkpoint.runId||!analysis?.paper?.id)
          throw new Error('增量断点数据格式不正确');
        checkpoint.checkpointSerial=(Number(checkpoint.checkpointSerial)||0)+1;
        await writeAtomic(paperPath(checkpoint.projectId,analysis.paper.id),{
          version:VERSION,projectId:checkpoint.projectId,runId:checkpoint.runId,
          checkpointSerial:checkpoint.checkpointSerial,
          paperId:analysis.paper.id,analysis
        });
        await markLatest(checkpoint);
        return checkpoint;
      },
      async load(id){
        const raw=await readFile(pathFor(id));
        if(raw?.version!==VERSION)return null;
        // Compatibility: projects saved by v0.3.0 have no runId or sidecars.
        // Only merge sidecars belonging to the SAME analysis run, never stale
        // fragments from a previous run with the same project signature.
        if(raw.runId && Array.isArray(raw.input?.papers)){
          const sidecars=await Promise.all(raw.input.papers.map(async p=>{
            try{return await readFile(paperPath(id,p.id));}
            catch(_){return null;}
          }));
          for(const part of sidecars){
            if(!part||part.version!==VERSION||part.runId!==raw.runId||
               part.projectId!==id||!part.analysis?.paper||
               part.paperId!==part.analysis.paper.id)continue;
            // If the full project was already written but its sidecar deletion
            // was interrupted, the newer full snapshot takes precedence.
            if((Number(part.checkpointSerial)||0)<=(Number(raw.checkpointSerial)||0))continue;
            raw.checkpointSerial=part.checkpointSerial;
            if(!Array.isArray(raw.analyses))raw.analyses=[];
            const i=raw.analyses.findIndex(a=>a.paper?.id===part.paperId);
            if(i<0)raw.analyses.push(part.analysis);
            else raw.analyses[i]=part.analysis;
          }
        }
        return raw;
      },
      async loadLatest(){
        const index=await readFile(pathFor('latest'));
        const value=index?.projectId?await this.load(index.projectId):null;
        if(value&&index.updatedAt)value.updatedAt=index.updatedAt;
        return value;
      },
      async clear(id){
        try{await io.remove(pathFor(id),{ignoreAbsent:true});}catch(_){}
        // Remove sidecars for this project without enumerating Zotero library.
        // Paper IDs are from its saved checkpoint (if present) or 1..35.
        for(let i=1;i<=35;i++){
          try{await io.remove(paperPath(id,'P'+i),{ignoreAbsent:true});}catch(_){}
        }
        const latest=await readFile(pathFor('latest'));
        if(latest?.projectId===id)await io.remove(pathFor('latest'),{ignoreAbsent:true});
      },
    };
  }
  function createInitial(papers,question,settings){
    const sig=signature(papers,question,settings);
    return {version:VERSION,projectId:projectID(sig),signature:sig,
      checkpointSerial:0,
      runId:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),
      input:cleanInput({papers,question,settings}),analyses:[],groups:[],synthesis:null,
      draft:'',templateId:null,status:'processing',updatedAt:new Date().toISOString()};
  }
  function matches(stored,papers,question,settings){
    return !!stored&&stored.version===VERSION&&stored.signature===signature(papers,question,settings);
  }
  return {VERSION,signature,projectID,sourceFingerprint,createInitial,createStore,matches};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ReviewCheckpoints;
