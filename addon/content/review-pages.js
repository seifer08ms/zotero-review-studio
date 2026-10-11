/* Identify PHYSICAL PDF pages of quote-verified evidence by searching the
 * Zotero PDFWorker's text extraction for the first prefix containing a quote.
 * No LLM-generated page numbers are trusted. No PDF prefix text is persisted.
 */
var ReviewPages=(function(){
  'use strict';
  function normalize(str){return String(str||'').normalize('NFKC').toLowerCase().replace(/[\s\u00ad-]+/g,'');}
  function exactMatch(quote,text){
    const q=normalize(quote);
    return q.length>=12&&normalize(text).includes(q);
  }
  async function locate(quotes,readPrefix,options={}){
    const wanted=(quotes||[]).filter(q=>q?.evidenceId&&q?.verified&&q?.quote);
    const max=Math.max(1,Math.min(100,Number(options.maxQuotes)||20));
    const budget=Math.max(1,Math.min(1000,Number(options.maxCalls)||140));
    const selected=wanted.slice(0,max);
    // Canonicalize each citation once; the original PDFWorker prefix budget,
    // binary search and page-number behavior remain untouched.
    const normalizedQuotes=selected.map(x=>({id:x.evidenceId,quote:normalize(x.quote)}));
    const result=new Map();
    if(!selected.length)return result;
    let calls=0;
    const cache=new Map();
    // Cache only membership bitsets; not dozens of enormous extracted prefixes.
    async function check(page){
      if(cache.has(page))return cache.get(page);
      if(calls>=budget)throw new Error('页码定位请求预算已耗尽');
      calls++;
      const raw=await readPrefix(page);
      const text=normalize(raw?.text||'');
      const found=new Set(normalizedQuotes.filter(x=>text.includes(x.quote)).map(x=>x.id));
      const value={found,totalPages:Number(raw?.totalPages)||0};
      cache.set(page,value);return value;
    }
    const first=await check(1);
    const total=Math.trunc(first.totalPages);
    if(total<1||total>20000)throw new Error('无法获取 PDF 的真实页数，不能可靠定位');
    for(const quote of selected){
      if(first.found.has(quote.evidenceId)){
        result.set(quote.evidenceId,{pdfPage:1,location:'verified_pdf'});
        options.onLocated?.(quote.evidenceId,1);
        continue;
      }
      try {
        let low=2,high=total;
        const entire=await check(total);
        if(!entire.found.has(quote.evidenceId)){
          result.set(quote.evidenceId,{pdfPage:null,location:'not_found'});continue;
        }
        while(low<high){
          const mid=Math.floor((low+high)/2);
          const hit=(await check(mid)).found.has(quote.evidenceId);
          if(hit)high=mid;else low=mid+1;
        }
        result.set(quote.evidenceId,{pdfPage:low,location:'verified_pdf'});
        options.onLocated?.(quote.evidenceId,low);
      }catch(e){
        if(/预算/.test(String(e))) {
          result.set(quote.evidenceId,{pdfPage:null,location:'budget_exceeded'});
          break;
        }
        result.set(quote.evidenceId,{pdfPage:null,location:'error'});
      }
    }
    return result;
  }
  return {normalize,exactMatch,locate};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ReviewPages;
