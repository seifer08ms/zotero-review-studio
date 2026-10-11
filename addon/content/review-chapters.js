/* Markdown section boundaries for conservative, section-only regeneration. */
var ReviewChapters=(function(){
  'use strict';
  function sections(text){
    const source=String(text||'');
    const all=[];const regex=/^(#{1,3})[ \t]+(.+?)\s*$/gm;
    let m;
    while((m=regex.exec(source)))all.push({level:m[1].length,title:m[2].trim(),start:m.index,headingEnd:regex.lastIndex});
    if(!all.length)return [];
    const level=all.some(x=>x.level===2)?2:Math.min(...all.map(x=>x.level));
    const candidates=all.filter(x=>x.level===level);
    return candidates.map((entry,i)=>({ ...entry,index:i,end:candidates[i+1]?.start??source.length,
      text:source.slice(entry.start,candidates[i+1]?.start??source.length)}));
  }
  function eligibleSections(md){
    return sections(md).filter(x=>!/^\s*(references|bibliography|参考文献|文献目录|参考资料|致谢|acknowledge)/i.test(x.title));
  }
  function sectionBody(raw,reference){
    const text=String(raw||'').trim();
    const lines=text.split(/\r?\n/);
    // Models sometimes repeat the heading. Reuse the ORIGINAL heading verbatim.
    if(/^#{1,3}\s/.test(lines[0]||''))lines.shift();
    const out=lines.join('\n').trim();
    if(!out)throw new Error('模型没有返回本节正文，不替换原内容');
    // Reject outputs with new peer-level sections; never silently overwrite next chapter.
    const peers=sections(out).filter(x=>x.level<=reference.level);
    if(peers.length)throw new Error('模型返回了额外顶级章节，请重试；当前章节未修改');
    return out;
  }
  function replace(md,index,response){
    const source=String(md||'');
    const chosen=eligibleSections(source).find(x=>x.index===Number(index));
    if(!chosen)throw new Error('没有找到需要重写的章节');
    const head=source.slice(chosen.start,chosen.headingEnd).trimEnd();
    const text=head+'\n\n'+sectionBody(response,chosen)+'\n\n';
    return source.slice(0,chosen.start)+text+source.slice(chosen.end);
  }
  function preview(md,index){const chosen=eligibleSections(md).find(x=>x.index===Number(index));if(!chosen)throw new Error('请选择章节');return chosen;}
  return {sections,eligibleSections,replace,preview};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ReviewChapters;
