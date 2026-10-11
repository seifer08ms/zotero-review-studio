#!/usr/bin/env python3
"""Reproducible Chromium smoke, using the genuine v0.3.0 and optimized UI scripts.
Figures are browser-simulation metrics, not Zotero runtime heap or CPU results.
"""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

here=Path(__file__).resolve().parent.parent
baseline=here/'tests/fixtures/v0.3.0'


def sample(root):
    text=(root/'tests/ui-smoke.html').read_text(encoding='utf-8')
    hook="  window.addEventListener('DOMContentLoaded',()=>void init(),{once:true});"
    assert text.count(hook)==1
    return text.replace(hook,'  window.__auditUI={renderGaps,renderEvidence};\n'+hook)


def measure(page):
    return page.evaluate('''async ()=>{
        function mkData(){
          const analyses=[];
          for(let i=1;i<=35;i++){
            const chunks=[];
            for(let k=1;k<=10;k++){
              const claims=[];
              for(let j=1;j<=12;j++){
                const suffix=j%4===0?'l':'m';
                claims.push({evidenceId:`P${i}-C${k}-E${j}-${suffix}`,kind:'limitations',
                  claim:'Study-specific limitations in complex benchmark datasets',quote:'evidence sentence with the matching source quote',
                  verified:true,interpretation:'author_stated', pdfPage:j%3===0?4:undefined});
              }
              chunks.push({index:k,claims});
            }
            analyses.push({paper:{id:'P'+i,title:'A detailed scholarly methods review paper '+i},
              sourceQuality:'fulltext',coverage:1,attachmentID:100+i,truncated:false,chunks});
          }
          const synthesis={};
          for(const kind of ['themes','establishedLimitations','possibleGaps','counterExamples','uncertainties']){
            synthesis[kind]=Array.from({length:10},(_,j)=>({claim:`Gap ${kind} ${j}`,status:'author_stated',
              paperIds:['P1','P2','P3'],evidenceIds:[`P1-C1-E${j%12+1}-m`,`P2-C1-E${j%12+1}-m`]}));
          }
          return {analyses,synthesis,question:'Research gaps in geographical neural methods'};
        }
        const result=mkData();
        const gapTimes=[], evidenceTimes=[];
        for(let repeat=0;repeat<5;repeat++){
          const gapStart=performance.now();
          window.__auditUI.renderGaps(result);
          gapTimes.push(performance.now()-gapStart);
          const evidenceStart=performance.now();
          window.__auditUI.renderEvidence(result);
          evidenceTimes.push(performance.now()-evidenceStart);
        }
        gapTimes.sort((a,b)=>a-b);
        evidenceTimes.sort((a,b)=>a-b);
        const gapMs=gapTimes[2], evidenceMs=evidenceTimes[2];
        const count=()=>document.querySelectorAll('#evidenceView *').length;
        const summary={gapMs:+gapMs.toFixed(2),evidenceMs:+evidenceMs.toFixed(2),
          evidenceDOMNodes:count(),gapDOMNodes:document.querySelectorAll('#gapView *').length,
          totalClaims:35*10*12,
          firstPaperCount:document.querySelectorAll('#evidenceView .evidence-line').length};
        const first=document.querySelector('#evidenceView details');
        if(first){
          first.open=true;
          await new Promise(r=>setTimeout(r,60));
          summary.afterExpandNodes=count();
          summary.afterExpandClaims=document.querySelectorAll('#evidenceView .evidence-line').length;
          first.open=false;
          await new Promise(r=>setTimeout(r,60));
          summary.afterCollapseNodes=count();
          summary.afterCollapseClaims=document.querySelectorAll('#evidenceView .evidence-line').length;
        }
        return summary;
    }''')


if __name__=='__main__':
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
        outcomes={}
        for tag,root in [('baseline',baseline),('optimized',here)]:
            page=browser.new_page(viewport={'width':1440,'height':900})
            errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.set_content(sample(root),wait_until='load')
            page.wait_for_selector('#selectedList .paper-line')
            outcomes[tag]=measure(page)
            assert not errors,(tag,errors)
            page.close()
        browser.close()
        assert outcomes['baseline']['totalClaims']==outcomes['optimized']['totalClaims']
        assert outcomes['baseline']['firstPaperCount']==4200
        assert outcomes['optimized']['firstPaperCount']==0
        assert outcomes['optimized']['afterExpandClaims']==120
        assert outcomes['optimized']['afterCollapseClaims']==0
        assert outcomes['optimized']['evidenceDOMNodes']<outcomes['baseline']['evidenceDOMNodes']*.08
        print(json.dumps(outcomes,ensure_ascii=False,indent=2))
