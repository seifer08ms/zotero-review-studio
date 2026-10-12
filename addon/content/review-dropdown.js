/* An opaque, keyboard-accessible dropdown for HTML selects embedded in Zotero XUL.
 * The original select remains the source of truth, with its existing change handlers.
 * Only a single fixed-position popup can exist, above all scrollable panels.
 */
var ReviewDropdown = (function () {
  'use strict';
  const HTML='http://www.w3.org/1999/xhtml';
  const widgets=new Map();
  let active=null, portal=null, initialized=false;
  const make=(tag,cls,text)=>{
    const x=document.createElementNS(HTML,tag);
    if(cls)x.className=cls;
    if(text!==undefined)x.textContent=text;
    return x;
  };
  // The dialog is an XHTML subtree inside a XUL window.  Zotero's global
  // XUL skin can win over a stylesheet selector for native form controls,
  // so the source select is hidden inline as well as by review.css.  Keeping
  // it in the DOM preserves the existing change handlers and option model.
  function hideSourceSelect(select){
    select.classList.add('rs-native-select');
    select.tabIndex=-1;
    select.setAttribute('aria-hidden','true');
    select.style.setProperty('display','none','important');
    select.style.setProperty('visibility','hidden','important');
    select.style.setProperty('pointer-events','none','important');
  }
  function sourceSelects(){
    const found=[];const seen=new Set();
    const add=list=>{for(const select of Array.from(list||[])){
      if(!seen.has(select)){seen.add(select);found.push(select);}
    }};
    // In Zotero the dialog is XHTML embedded in a XUL document.  The
    // namespace-aware lookup is required on Gecko XML documents; the CSS
    // selector alone can miss html:select elements there.
    try{add(document.getElementsByTagNameNS(HTML,'select'));}catch(_){ }
    try{add(document.querySelectorAll('select'));}catch(_){ }
    try{add(document.querySelectorAll('[local-name="select"]'));}catch(_){ }
    return found;
  }
  const optionsOf=select=>Array.from(select.options||[]).filter(o=>!o.hidden);

  function refresh(select){
    const item=widgets.get(select);if(!item)return;
    const selected=optionsOf(select).find(o=>o.selected)||optionsOf(select)[0];
    item.button.textContent=selected?.textContent?.trim()||'请选择…';
    item.button.disabled=!!select.disabled;
    item.button.title=selected?.textContent?.trim()||'';
    item.button.setAttribute('aria-expanded',active?.select===select?'true':'false');
    if(active?.select===select)drawOptions(active);
  }

  function close(){
    if(!active)return;
    const entry=active;active=null;
    entry.button.setAttribute('aria-expanded','false');
    if(portal){portal.classList.add('hidden');portal.replaceChildren();}
  }

  function choose(select,value){
    if(select.disabled)return;
    if(select.value!==value){
      select.value=value;
      select.dispatchEvent(new Event('change',{bubbles:true}));
    }
    close();refreshAll();
    widgets.get(select)?.button.focus();
  }

  function drawOptions(entry){
    if(!portal)return;
    portal.replaceChildren();
    const opts=optionsOf(entry.select);
    opts.forEach((opt,i)=>{
      const b=make('button','rs-dropdown-option',opt.textContent.trim());
      b.type='button'; b.setAttribute('role','option');
      // Reset platform button skin explicitly.  Without this, the XUL
      // theme may paint a transparent/native option surface above the portal.
      b.style.setProperty('appearance','none');
      b.style.setProperty('-moz-appearance','none');
      b.id='rs-option-'+entry.select.id+'-'+i;
      b.setAttribute('aria-selected',String(opt.value===entry.select.value));
      b.disabled=opt.disabled;
      if(opt.value===entry.select.value)b.classList.add('current');
      b.addEventListener('click',event=>{event.stopPropagation();choose(entry.select,opt.value);});
      portal.appendChild(b);
    });
  }

  function position(entry){
    const rect=entry.button.getBoundingClientRect();
    const screenH=window.innerHeight||document.documentElement.clientHeight||700;
    const screenW=window.innerWidth||document.documentElement.clientWidth||1100;
    const desired=Math.min(292,Math.max(52,(portal.children.length||1)*37+8));
    const below=screenH-rect.bottom-10;
    const above=rect.top-10;
    const useAbove=below<Math.min(185,desired)&&above>below;
    const available=Math.max(80,useAbove?above:below);
    const height=Math.min(desired,available);
    const width=Math.min(Math.max(rect.width,210),screenW-20);
    portal.style.left=Math.max(10,Math.min(rect.left,screenW-width-10))+'px';
    portal.style.top=(useAbove?Math.max(5,rect.top-height-5):Math.min(screenH-height-5,rect.bottom+5))+'px';
    portal.style.width=width+'px';
    portal.style.maxHeight=height+'px';
    portal.dataset.position=useAbove?'above':'below';
  }

  function open(select){
    if(select.disabled)return;
    const entry=widgets.get(select);
    if(!entry)return;
    if(active?.select===select){close();return;}
    close();active=entry;
    drawOptions(entry);
    position(entry);
    portal.classList.remove('hidden');
    entry.button.setAttribute('aria-expanded','true');
    const selected=portal.querySelector('.current');
    selected?.scrollIntoView?.({block:'nearest'});
  }

  function onKey(event,select){
    if(select.disabled)return;
    const opts=optionsOf(select).filter(o=>!o.disabled);
    if(!opts.length)return;
    const current=Math.max(0,opts.findIndex(o=>o.value===select.value));
    if(event.key==='Escape'){close();event.preventDefault();return;}
    if(event.key==='Enter'||event.key===' '){event.preventDefault();open(select);return;}
    let index=null;
    if(event.key==='ArrowDown')index=Math.min(opts.length-1,current+1);
    else if(event.key==='ArrowUp')index=Math.max(0,current-1);
    else if(event.key==='Home')index=0;
    else if(event.key==='End')index=opts.length-1;
    if(index!==null){event.preventDefault();choose(select,opts[index].value);}
  }

  function mount(select){
    if(!select||widgets.has(select)||!select.parentNode)return;
    const shell=make('div','rs-picker');
    const btn=make('button','rs-picker-button');
    btn.type='button';btn.setAttribute('aria-haspopup','listbox');
    btn.setAttribute('aria-expanded','false');
    btn.style.setProperty('appearance','none');
    btn.style.setProperty('-moz-appearance','none');
    const label=select.getAttribute('aria-label')||select.id||'选择';
    btn.setAttribute('aria-label',label);
    select.parentNode.insertBefore(shell,select);
    shell.appendChild(select); shell.appendChild(btn);
    hideSourceSelect(select);
    widgets.set(select,{select,button:btn});
    btn.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();open(select);});
    btn.addEventListener('keydown',event=>onKey(event,select));
    select.addEventListener('change',()=>refresh(select));
    if(typeof MutationObserver!=='undefined'){
      const observer=new MutationObserver(()=>refresh(select));
      observer.observe(select,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['disabled','selected','label']});
      widgets.get(select).observer=observer;
    }
    refresh(select);
  }

  function refreshAll(){for(const select of widgets.keys())refresh(select);}
  function init(){
    if(initialized)return;initialized=true;
    portal=make('div','rs-dropdown-portal hidden');
    portal.setAttribute('role','listbox');
    portal.setAttribute('aria-label','下拉选项');
    portal.style.setProperty('appearance','none');
    portal.style.setProperty('-moz-appearance','none');
    portal.style.setProperty('pointer-events','auto');
    document.documentElement.appendChild(portal);
    for(const select of sourceSelects()) mount(select);
    document.addEventListener('pointerdown',event=>{
      if(active && !portal.contains(event.target) && !active.button.contains(event.target))close();
    },true);
    // Closes before a scrolled panel can move away from its popup anchor.
    document.addEventListener('scroll',event=>{
      if(active && event.target!==portal && !portal.contains(event.target))close();
    },true);
    window.addEventListener('resize',close);
    window.addEventListener('blur',close);
  }
  return {init,mount,refreshAll,close};
})();
if(typeof module!=='undefined'&&module.exports)module.exports=ReviewDropdown;
