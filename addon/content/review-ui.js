/* Chrome dialog UI for Zotero Review Studio. Uses textContent exclusively for untrusted text. */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  const bridge = window.arguments && window.arguments[0];
  if (!bridge?.zotero) {
    window.addEventListener('DOMContentLoaded',()=>alert('无法读取 Zotero 上下文，请从 Zotero 工具菜单重新打开。'),{once:true});
    return;
  }
  const z = bridge.zotero;
  const rt = ReviewRuntime.create(bridge);
  if(typeof ReviewChatGPT!=='undefined')ReviewChatGPT.configure(z);
  const state = {
    included: new Map(), suggestions: [], templates: [],
    busy:false, result:null, progressLines:[], language:'zh-CN',
    exemplar:null, exemplarResult:null, pendingTemplateMeta:null,
    apiProfiles:[],activeAPIId:'',sessionKeys:new Map(),apiTested:new Map(),analysisFingerprint:null,
    latestCheckpoint:null,restoredProjectID:null,draftSaveTimer:null,

  };

  function elm(tag, cls, content) {
    const x = document.createElement(tag);
    if (cls) x.className = cls;
    if (content !== undefined) x.textContent = String(content);
    return x;
  }
  function clear(node) { while(node.firstChild) node.removeChild(node.firstChild); }
  function feedback(text, alertUser=false) {
    byId('runState').textContent=String(text||'');
    if (alertUser) alert(text);
  }
  function keyOf(p) { return p.source==='local' ? 'local:'+p.itemID : 'online:'+(p.openAlexID||p.doi||p.title); }
  function isIncluded(p) { return state.included.has(keyOf(p)); }
  function setIncluded(p,on) {
    if (on) state.included.set(keyOf(p),p);
    else state.included.delete(keyOf(p));
    renderIncluded();
    updateSuggestionChecks();
    updateRunOverview();
  }
  function chooseExemplar(p) {
    if(state.busy || p?.source!=='local') return;
    state.exemplar=p;
    // A reference paper teaches the writing architecture. It does not become
    // scientific evidence unless the user deliberately rechecks the checkbox.
    state.included.delete(keyOf(p));
    byId('exemplarSelection').textContent=(p.title||'无标题')+' · '+(p.year||'未知年份');
    byId('exemplarStatus').textContent='已作为写作范例（不自动纳入新综述的证据池）。需要 PDF 文本层和模型 API。';
    byId('extractExemplarBtn').disabled=false;
    renderIncluded();renderSuggestions();updateRunOverview();
  }

  function includedPapers() { return [...state.included.values()]; }
  function currentFingerprint(){return JSON.stringify({question:byId('question').value.trim(),papers:[...state.included.keys()].sort()});}
  function evidenceStale(){return !!state.result&&state.analysisFingerprint!==currentFingerprint();}

  function pill(text) { return elm('span','small-badge',text); }
  function renderPaper(p,sourceMode) {
    const row=elm('div','paper-line');
    const check=elm('input'); check.type='checkbox'; check.checked=isIncluded(p);
    check.disabled=state.busy;
    check.addEventListener('change',()=>setIncluded(p,check.checked));
    row.appendChild(check);
    const detail=elm('div');
    const title=elm('div','paper-title',p.title||'无标题');
    title.title=p.title||'';
    detail.appendChild(title);
    const author=p.authors?.[0]||'作者未知';
    detail.appendChild(elm('div','paper-meta',`${author} · ${p.year||'年份未知'} · ${p.source==='online'?'在线候选':'本地 Zotero'}`));
    const badges=elm('div','badges');
    if (p.source==='online') {
      badges.appendChild(pill(p.abstract?.length>40?'仅摘要':'仅元数据'));
      if(p.oaURL)badges.appendChild(pill('可找到 OA PDF 链接（需先导入到 Zotero 才能全文分析）'));
    } else badges.appendChild(pill('本地：PDF 优先，缺失则仅摘要'));
    if (sourceMode==='suggestion')badges.appendChild(pill(`相关度 ${p.relevance||0}`));
    if(p.doi)badges.appendChild(pill('DOI'));
    detail.appendChild(badges);
    if (p.source==='local') {
      const actions=elm('div','paper-actions');
      const select=elm('button','btn miniature',state.exemplar?.itemID===p.itemID?'✓ 当前范例':'设为范例综述');
      select.type='button';
      select.disabled=state.busy;
      select.addEventListener('click',(event)=>{
        event.stopPropagation();
        chooseExemplar(p);
      });
      actions.appendChild(select);
      detail.appendChild(actions);
    }
    row.appendChild(detail);
    return row;
  }

  function renderIncluded() {
    const items=includedPapers();
    byId('selectedCount').textContent=items.length+' 篇';
    byId('sourceCount').textContent=items.length+' 篇纳入';
    const root=byId('selectedList');clear(root);
    if(!items.length){ root.appendChild(elm('p','empty','当前尚未选择论文。先在 Zotero 中选论文，或在下方补充检索。')); return; }
    items.forEach(p=>root.appendChild(renderPaper(p,'included')));
    updateRunOverview();
  }
  function renderSuggestions() {
    const root=byId('suggestionList');clear(root);
    if (!state.suggestions.length) { root.appendChild(elm('p','empty','没有匹配的候选论文。试试更精确的技术关键词。'));return; }
    for(const p of state.suggestions)root.appendChild(renderPaper(p,'suggestion'));
  }
  function updateSuggestionChecks() {
    // Re-render keeps library/online selection states in sync with the main list.
    if(state.suggestions.length)renderSuggestions();
  }
  function setDiscoveryBusy(on) {
    byId('localSearchBtn').disabled=on||state.busy;
    byId('onlineSearchBtn').disabled=on||state.busy;
    byId('autoDiscoverBtn').disabled=on||state.busy;
  }
  async function discovery(kind) {
    const query=byId('searchTerms').value.trim() || byId('question').value.trim();
    if(query.length<3){alert('请先输入较具体的检索关键词');return;}
    setDiscoveryBusy(true);
    byId('discoveryStatus').textContent=(kind==='local'?'正在检索 Zotero 库':kind==='both'?'正在检索 Zotero 与 OpenAlex':'正在检索 OpenAlex')+'…';
    try{
      let results=[];
      if (kind==='both') {
        const ids=includedPapers().filter(p=>p.source==='local').map(p=>p.itemID);
        const outcomes=await Promise.allSettled([
          rt.searchLibrary(query,ids,35),
          rt.searchOnline(query,14),
        ]);
        const failures=outcomes.filter(x=>x.status==='rejected');
        for (const result of outcomes) if(result.status==='fulfilled')results.push(...result.value);
        if(!results.length && failures.length)throw failures[0].reason;
        if(failures.length)byId('discoveryStatus').textContent='其中一项检索失败，已展示另一来源的候选。';
        results.sort((a,b)=>(b.relevance||0)-(a.relevance||0));
      } else {
        results=kind==='local'
          ?await rt.searchLibrary(query,includedPapers().filter(p=>p.source==='local').map(p=>p.itemID),35)
          :await rt.searchOnline(query,14);
      }
      const seen=new Set();
      state.suggestions=results.filter(x=>{
        const key=keyOf(x);
        if(seen.has(key)||isIncluded(x))return false;
        seen.add(key); return true;
      });
      byId('discoveryStatus').textContent=`检索到 ${state.suggestions.length} 篇候选；请勾选需要纳入的文献`;
      renderSuggestions();
      updateRunOverview();
    } catch(e){
      byId('discoveryStatus').textContent='检索失败：'+(e.message||e);
    } finally{setDiscoveryBusy(false)}
  }

  function customTemplates() {
    try{
      const v=JSON.parse(rt.getPref('customTemplates','[]'));
      return Array.isArray(v)?v.filter(x=>x?.id&&x.name&&x.instruction).slice(0,30):[];
    }catch(_){return []}
  }
  function fillTemplates(preferred) {
    state.templates=[...ReviewCore.BUILT_IN_TEMPLATES,...customTemplates()];
    const select=byId('templateSelect'), old=preferred||select.value||'gap';
    clear(select);
    for(const template of state.templates){
      const option=elm('option',null,template.name);
      option.value=template.id;
      select.appendChild(option);
    }
    select.value=state.templates.some(t=>t.id===old)?old:'gap';
    refreshDropdowns();
  }
  function saveCustomTemplate(){
    const name=byId('customTemplateName').value.trim();
    const instruction=byId('customTemplateInstruction').value.trim();
    if(!name||instruction.length<35){alert('请填写模板名称，以及至少 35 字的综述结构和写作要求');return;}
    const arr=customTemplates();
    const id=state.pendingTemplateMeta ? 'custom-exemplar-'+Date.now()
      : byId('templateSelect').value.startsWith('custom-')?byId('templateSelect').value:'custom-'+Date.now();
    const entry={id,name:name.slice(0,65),instruction:instruction.slice(0,10500)};
    if(state.pendingTemplateMeta)Object.assign(entry,state.pendingTemplateMeta);
    const i=arr.findIndex(t=>t.id===id);
    if(i>=0)arr[i]=entry; else arr.push(entry);
    while(arr.length>30)arr.shift();
    rt.setPref('customTemplates',JSON.stringify(arr));
    state.pendingTemplateMeta=null;
    fillTemplates(id);
    byId('templatePanel').classList.add('hidden');
  }
  function openTemplateEditor() {
    const chosen=state.templates.find(t=>t.id===byId('templateSelect').value);
    byId('customTemplateName').value=chosen?.id.startsWith('custom-')?chosen.name:'';
    byId('customTemplateInstruction').value=chosen?.instruction||'';
    state.pendingTemplateMeta=null;
    byId('templatePanel').classList.remove('hidden');
  }
  function deleteTemplate(){
    const id=byId('templateSelect').value;
    if(!id.startsWith('custom-')) {alert('内置模板无法删除');return;}
    if(!confirm('删除当前自定义模板？'))return;
    rt.setPref('customTemplates',JSON.stringify(customTemplates().filter(t=>t.id!==id)));
    fillTemplates('gap');
    byId('templatePanel').classList.add('hidden');
  }

  // API profiles are saved separately from keys. A key is persisted only after
  // explicit opt-in; otherwise it lives in this window's in-memory session map.
  function profileById(id) { return state.apiProfiles.find(p=>p.id===id); }
  function activeProfile() { return profileById(state.activeAPIId)||state.apiProfiles[0]; }
  function storedProfileKey(p) {
    if(state.sessionKeys.has(p.id)) return state.sessionKeys.get(p.id)||'';
    return p.rememberKey ? String(rt.getPref('profileSecret.'+p.id,'')||'') : '';
  }
  function refreshDropdowns(){ReviewDropdown?.refreshAll?.();}
  function fillProfileSelectors() {
    for(const id of ['apiProfileSelect','activeProfileQuick']) {
      const select=byId(id);clear(select);
      for(const p of state.apiProfiles) {
        const option=elm('option',null,ReviewProfiles.label(p));
        option.value=p.id;
        select.appendChild(option);
      }
      select.value=state.activeAPIId;
    }
    byId('consentProvider').textContent=activeProfile()?.name||'当前 API';
    refreshDropdowns();
  }
  function fillProviderPresets() {
    const select=byId('apiProvider');clear(select);
    for(const preset of ReviewProfiles.PRESETS){
      const option=elm('option',null,preset.name);option.value=preset.id;select.appendChild(option);
    }
    refreshDropdowns();
  }
  function updateGatewayVisibility(){
    byId('gatewayLabel').classList.toggle('hidden',byId('apiRoute').value!=='gateway');
  }
  function updateProxyVisibility(){
    const custom=byId('proxyMode').value==='custom';
    for(const id of ['proxyTypeLabel','proxyHostLabel','proxyPortLabel'])byId(id).classList.toggle('hidden',!custom);
    byId('proxyDNSLabel').classList.toggle('hidden',!custom||byId('proxyType').value!=='socks5');
  }
  function isOfficial(){return byId('apiProvider').value==='chatgpt';}
  function showChatGPTFields(){
    const official=isOfficial();
    for(const id of ['chatgptAuthBox'])byId(id).classList.toggle('hidden',!official);
    for(const id of ['endpointLabel','apiKeyLabel','apiRouteLabel','rememberKeyLabel']){
      byId(id).classList.toggle('hidden',official);
    }
    if(official){byId('gatewayLabel').classList.add('hidden');}
    else updateGatewayVisibility();
    const login=(typeof ReviewChatGPT!=='undefined')?ReviewChatGPT.status():{connected:false};
    byId('chatgptAuthStatus').textContent=login.connected
      ?('已授权 ChatGPT 账户'+(login.email?'：'+login.email:'')+'；可以测试或分析')
      :'尚未授权。点击“使用 ChatGPT 登录”，在 OpenAI 官方页面同意后即可使用。';
    byId('signInChatGPT').textContent=login.connected?'重新授权 ChatGPT':'使用 ChatGPT 登录';
    byId('signOutChatGPT').disabled=!login.connected||state.busy;
    byId('refreshChatGPTModels').disabled=!login.connected||state.busy;
    refreshDropdowns();
  }
  async function loginChatGPT(){
    if(state.busy)return;
    const button=byId('signInChatGPT');button.disabled=true;
    byId('chatgptAuthStatus').textContent='正在打开 OpenAI 官方授权页面，请在浏览器登录并确认权限…';
    try{
      await ReviewChatGPT.signIn(getSettings());
      byId('dataConsent').checked=false;
      const settings=getSettings();
      try{
        const models=await ReviewChatGPT.listModels(settings);
        const selected=byId('model').value.trim();
        if(models.length && !models.some(m=>m.id===selected))byId('model').value=models[0].id;
      }catch(e){byId('settingsStatus').textContent='已登录，但读取模型目录失败：'+e.message;}
      saveSettings({silent:true});
      showChatGPTFields();
      byId('settingsStatus').textContent='官方 ChatGPT 登录成功。建议点击“测试当前 API”，再进行全文分析。';
    }catch(e){byId('chatgptAuthStatus').textContent='登录失败：'+(e.message||e);}
    finally{button.disabled=false;updateRunOverview();}
  }
  async function logoutChatGPT(){
    if(state.busy)return;
    if(!confirm('要退出本插件中的 ChatGPT 授权吗？其他 API 配置不会删除。'))return;
    try{await ReviewChatGPT.signOut(getSettings());}
    catch(e){byId('settingsStatus').textContent='提示：'+e.message;}
    byId('dataConsent').checked=false;
    showChatGPTFields();updateRunOverview();
  }
  async function listChatGPTModels(){
    const btn=byId('refreshChatGPTModels');btn.disabled=true;
    byId('settingsStatus').textContent='正在读取 ChatGPT 官方模型目录…';
    try{
      const choices=await ReviewChatGPT.listModels(getSettings());
      if(!choices.length)throw new Error('当前账号没有返回可列出的模型');
      const existing=byId('model').value;
      if(!choices.some(x=>x.id===existing))byId('model').value=choices[0].id;
      byId('settingsStatus').textContent='已读取 '+choices.length+' 个模型；当前选择：'+byId('model').value+'。可编辑模型名称。';
      saveSettings({silent:true});
    }catch(e){byId('settingsStatus').textContent='读取模型失败：'+e.message;}
    finally{showChatGPTFields();btn.disabled=!ReviewChatGPT.isConnected();updateRunOverview();}
  }
  function renderProfile(p){
    if(!p) return;
    byId('apiProfileName').value=p.name;
    byId('apiProvider').value=p.provider;
    byId('endpoint').value=p.endpoint;
    byId('model').value=p.model;
    byId('apiRoute').value=p.route;
    byId('gatewayEndpoint').value=p.gatewayEndpoint||'';
    byId('proxyMode').value=p.proxyMode||'inherit';
    byId('proxyType').value=p.proxyType||'http';
    byId('proxyHost').value=p.proxyHost||'127.0.0.1';
    byId('proxyPort').value=p.proxyPort||7890;
    byId('proxyRemoteDNS').checked=p.proxyRemoteDNS!==false;
    byId('timeoutSeconds').value=Math.round(p.timeoutMs/1000);
    byId('jsonMode').checked=p.jsonMode!==false;
    byId('rememberKey').checked=p.rememberKey===true;
    byId('apiKey').value=storedProfileKey(p);
    updateGatewayVisibility();
    updateProxyVisibility();
    fillProfileSelectors();
    showChatGPTFields();
    byId('settingsStatus').textContent='当前配置：'+p.name+'；模型 '+p.model;
    updateRunOverview();
  }
  function readProfileForm() {
    const p=activeProfile();
    if(!p)throw new Error('缺少 API 配置');
    return ReviewProfiles.sanitize({
      ...p,
      name:byId('apiProfileName').value.trim()||p.name,
      provider:byId('apiProvider').value,
      endpoint:byId('endpoint').value.trim(),
      model:byId('model').value.trim(),
      route:byId('apiRoute').value,
      gatewayEndpoint:byId('gatewayEndpoint').value.trim(),
      proxyMode:byId('proxyMode').value,
      proxyType:byId('proxyType').value,
      proxyHost:byId('proxyHost').value.trim(),
      proxyPort:byId('proxyPort').value.trim(),
      proxyRemoteDNS:byId('proxyRemoteDNS').checked,
      timeoutMs:Math.max(5,Math.min(300,Number(byId('timeoutSeconds').value)||120))*1000,
      jsonMode:byId('jsonMode').checked,
      rememberKey:byId('rememberKey').checked,
    });
  }
  function storeProfileDraft() {
    const p=readProfileForm();
    const i=state.apiProfiles.findIndex(x=>x.id===p.id);
    if(i>=0)state.apiProfiles[i]=p;
    state.sessionKeys.set(p.id,byId('apiKey').value.trim());
    return p;
  }
  function persistAPIProfiles() {
    const rtSave=(id,value)=>rt.setPref(id,value);
    ReviewProfiles.save(rtSave,state.apiProfiles,state.activeAPIId);
    for(const p of state.apiProfiles){
      const key=storedProfileKey(p);
      rt.setPref('profileSecret.'+p.id,p.rememberKey?key:'');
    }
    // Clear the old single-key preference after migrating to multiple profiles.
    rt.setPref('apiKey','');
  }
  function saveGeneralSettings(){
    const s=getGeneralSettings();
    for(const id of ['chunkChars','maxCharsPerPaper','maxTemplateChars'])rt.setPref(id,String(s[id]));
    rt.setPref('analysisLanguage',s.language);
  }
  function getGeneralSettings(){
    return {
      chunkChars:Math.max(2000,Math.min(24000,Number(byId('chunkChars').value)||11000)),
      maxCharsPerPaper:Math.max(5000,Math.min(1000000,Number(byId('maxCharsPerPaper').value)||180000)),
      maxTemplateChars:Math.max(16000,Math.min(1000000,Number(byId('maxTemplateChars').value)||280000)),
      language:byId('language').value==='en'?'en':'zh-CN',
    };
  }
  function loadSettings() {
    const s=rt.settings();
    ['chunkChars','maxCharsPerPaper','maxTemplateChars'].forEach(id=>byId(id).value=s[id]??'');
    byId('language').value=s.language==='en'?'en':'zh-CN';
    fillProviderPresets();
    const loaded=ReviewProfiles.load((name,fallback)=>rt.getPref(name,fallback));
    state.apiProfiles=loaded.profiles;
    state.activeAPIId=loaded.activeId;
    if(loaded.migratedKey)state.sessionKeys.set(loaded.activeId,loaded.migratedKey);
    renderProfile(activeProfile());
    updateRunOverview();
  }
  function getSettings() {
    const profile=readProfileForm();
    const endpoint=ReviewProfiles.validate(profile);
    return {
      ...getGeneralSettings(),
      profileName:profile.name,
      provider:profile.provider,
      endpoint,
      model:profile.model,
      apiKey:profile.provider==='chatgpt'?'':byId('apiKey').value.trim(),
      jsonMode:profile.jsonMode,
      timeoutMs:profile.timeoutMs,
      route:profile.route,
      proxyMode:profile.proxyMode,proxyType:profile.proxyType,
      proxyHost:profile.proxyHost,proxyPort:profile.proxyPort,
      proxyRemoteDNS:profile.proxyRemoteDNS,
    };
  }
  function saveSettings(options={}) {
    const silent=options.silent===true;
    const profile=storeProfileDraft();
    try {ReviewProfiles.validate(profile);} catch(e){
      if(!silent){byId('settingsStatus').textContent='配置尚不完整：'+e.message;return false;}
      // Allow saving a draft while switching; activation will validate before use.
    }
    saveGeneralSettings();
    persistAPIProfiles();
    fillProfileSelectors();
    updateRunOverview();
    if(!silent)byId('settingsStatus').textContent=profile.provider==='chatgpt'
      ?'设置已保存；ChatGPT 登录凭据保存在 Zotero 加密凭据库，不需要 API Key'
      :profile.rememberKey?'设置已保存；此配置密钥以明文保存在本机 Zotero 偏好中'
      :'设置已保存；密钥仅留在当前窗口，不写入磁盘';
    return true;
  }
  function switchAPI(id){
    if(!profileById(id)||state.busy)return;
    if(id===state.activeAPIId){fillProfileSelectors();return;}
    saveSettings({silent:true});
    state.activeAPIId=id;
    byId('dataConsent').checked=false; // consent applies to the selected provider
    renderProfile(activeProfile());
    persistAPIProfiles();
    byId('settingsStatus').textContent='已切换至 '+activeProfile().name+'；发送论文前需重新确认数据传输同意';
    updateRunOverview();
  }
  function addAPIProfile(clone=false){
    if(state.busy||state.apiProfiles.length>=30){alert('最多可保存 30 套 API 配置');return;}
    saveSettings({silent:true});
    const current=activeProfile();
    const p=clone
      ?ReviewProfiles.sanitize({...current,id:ReviewProfiles.create(current.provider).id,
        name:current.name+' · 副本',rememberKey:false})
      :ReviewProfiles.create('chatgpt','新模型配置 '+(state.apiProfiles.length+1));
    state.apiProfiles.push(p);
    state.activeAPIId=p.id;
    state.sessionKeys.set(p.id,''); // cloning intentionally excludes credentials
    byId('dataConsent').checked=false;
    persistAPIProfiles();renderProfile(p);
    byId('settingsPanel').classList.remove('hidden');
    byId('settingsStatus').textContent='已创建配置，填写接口和密钥后点击保存/测试。复制配置不会复制密钥。';
  }
  function deleteAPIProfile(){
    if(state.busy)return;
    if(state.apiProfiles.length===1){alert('至少保留一套 API 配置');return;}
    const p=activeProfile();
    if(!confirm('删除 API 配置“'+p.name+'”？本机已保存的对应密钥也会清除。'))return;
    state.apiProfiles=state.apiProfiles.filter(x=>x.id!==p.id);
    state.sessionKeys.delete(p.id);
    rt.setPref('profileSecret.'+p.id,'');
    state.activeAPIId=state.apiProfiles[0].id;
    byId('dataConsent').checked=false;
    persistAPIProfiles();renderProfile(activeProfile());
  }
  async function testActiveAPI(){
    if(state.busy)return;
    let settings;
    try {settings=getSettings();}catch(e){byId('settingsStatus').textContent='不能测试：'+e.message;return;}
    if(settings.provider==='chatgpt' && !ReviewChatGPT.isConnected()){
      byId('settingsStatus').textContent='请先点击“使用 ChatGPT 登录”，完成官方授权';
      byId('settingsPanel').classList.remove('hidden');return;
    }
    if(settings.provider!=='chatgpt' && !settings.apiKey && !/localhost|127\.0\.0\.1|\[::1\]/.test(settings.endpoint)){
      if(!confirm('没有填写 API Key。确认当前服务无需密钥并发送一次测试请求吗？'))return;
    }
    const button=byId('testAPI');button.disabled=true;
    byId('settingsStatus').textContent='测试中…只发送一段固定的短提示词，不发送论文或摘要。';
    try{
      const outcome=await rt.testConnection(settings);
      state.apiTested.set(state.activeAPIId,{time:Date.now(),model:settings.model});
      saveSettings({silent:true});
      byId('settingsStatus').textContent='✓ '+settings.profileName+' 连接成功（'+outcome.durationMs+' ms），模型返回：'+outcome.reply;
    }catch(e){byId('settingsStatus').textContent='✗ 连接失败：'+(e.message||e)}
    finally{button.disabled=false;updateRunOverview()}
  }
  function updateRunOverview(){
    const root=byId('runChecklist');if(!root)return;
    const included=state.included.size;
    const question=byId('question').value.trim();
    const p=activeProfile();
    let apiValid=false;
    try {ReviewProfiles.validate(readProfileForm());apiValid=true;} catch (_) {}
    const tested=state.apiTested.get(state.activeAPIId);
    const checks=[
      {ok:included>0,title:included+' 篇论文已选'},
      {ok:question.length>=12,title:question.length>=12?'研究问题已填写':'需要具体研究问题'},
      {ok:apiValid && (p.provider!=='chatgpt'||ReviewChatGPT.isConnected()),
        title:p.provider==='chatgpt' && !ReviewChatGPT.isConnected()?'需要先登录 ChatGPT':apiValid?'当前模型：'+p.name:'API 配置尚不完整'},
      {ok:!!tested,title:tested?'API 已测试（本次会话）':'建议先测试 API（可选）'},
      {ok:byId('dataConsent').checked,title:byId('dataConsent').checked?'已确认数据传输':'待确认数据传输'},
    ];
    clear(root);
    for(const check of checks)root.appendChild(elm('span',check.ok?'ready':'missing',(check.ok?'✓ ':'○ ')+check.title));
    const g=getGeneralSettings();
    // A chunk can end at a nearby sentence boundary and overlap the previous
    // chunk, so using maxChars/chunkSize would underestimate the upper bound.
    const lowerStep=Math.max(1000,Math.floor(g.chunkChars*.67)-Math.min(350,Math.floor(g.chunkChars/6)));
    const cap=Math.ceil(g.maxCharsPerPaper/lowerStep)+1;
    const calls=included*(cap+1)+Math.ceil(included/5)+(included>5?1:0);
    byId('runEstimate').textContent=included
      ?'模型请求量提醒：按当前上限约最多 '+calls+' 次证据/Gap 请求（不含重试、后续初稿/范例提炼）；实际取决于全文长度及文本分块。建议先用 3–5 篇试运行。'
      :'先从 Zotero 选论文，或用左侧“补充检索”纳入文献。';
    const latest=state.latestCheckpoint;
    const canResume=!!latest&&latest.status!=='evidence-complete'&&latest.status!=='finished';
    if(byId('checkpointStatus'))byId('checkpointStatus').textContent=latest
      ?'本地项目 '+String(latest.updatedAt||'').slice(0,16)+' · '+(latest.status==='evidence-complete'?'Gap 已完成':'可续跑')
      :'没有已保存的项目';
    if(byId('restoreCheckpointBtn'))byId('restoreCheckpointBtn').disabled=state.busy||!latest;
    if(byId('clearCheckpointBtn'))byId('clearCheckpointBtn').disabled=state.busy||!latest;
    if(byId('resumeCheckpointBtn')){
      let same=false;
      if(canResume&&question.length>=12){
        try{
          const jobs=includedPapers().map((paper,i)=>({...paper,id:'P'+(i+1)}));
          same=ReviewCheckpoints.matches(latest,jobs,question,getSettings());
        }catch(_){}
      }
      byId('resumeCheckpointBtn').disabled=state.busy||!same;
    }
    const stale=evidenceStale();
    byId('workflowStage').textContent=stale?'文献或问题已变化 · 请重新分析':state.result?'Gap 已分析 · 可生成初稿':'准备分析';
    if(byId('generateDraftBtn'))byId('generateDraftBtn').disabled=state.busy||!state.result||stale;
    if(byId('regenerateDraftBtn'))byId('regenerateDraftBtn').disabled=state.busy||!state.result||stale||!state.result.draft;
    if(byId('locatePagesBtn'))byId('locatePagesBtn').disabled=state.busy||!state.result||stale;
    if(byId('regenerateChapterBtn'))byId('regenerateChapterBtn').disabled=state.busy||!state.result||stale||!byId('draftOutput').value.trim();
  }

  function setBusy(on){
    state.busy=on;
    for(const id of ['runBtn','localSearchBtn','onlineSearchBtn','autoDiscoverBtn','saveNoteBtn','extractExemplarBtn','saveTemplateBtn','templateEditorBtn','generateDraftBtn','regenerateDraftBtn','regenerateChapterBtn','locatePagesBtn','restoreCheckpointBtn','resumeCheckpointBtn','clearCheckpointBtn','chapterSelect','apiProfileSelect','activeProfileQuick','testAPI','addAPIProfile','cloneAPIProfile','deleteAPIProfile']){
      const el=byId(id);if(el)el.disabled=on;
    }
    for(const id of ['saveSettings','apiProvider','apiProfileName','endpoint','model',
      'apiRoute','gatewayEndpoint','proxyMode','proxyType','proxyHost','proxyPort','proxyRemoteDNS','apiKey','rememberKey','jsonMode','timeoutSeconds',
      'chunkChars','maxCharsPerPaper','maxTemplateChars','language','templateSelect',
      'question','searchTerms']) {
      const input=byId(id);if(input)input.disabled=on;
    }
    byId('cancelBtn').disabled=!on;
    if(!on) byId('extractExemplarBtn').disabled=!state.exemplar;
    showChatGPTFields();
    refreshDropdowns();
    renderIncluded(); renderSuggestions();updateRunOverview();
  }
  function log(text){
    state.progressLines.push(`${new Date().toLocaleTimeString()}  ${text}`);
    if(state.progressLines.length>140)state.progressLines.shift();
    byId('logBox').textContent=state.progressLines.join('\n');
    byId('logBox').scrollTop=byId('logBox').scrollHeight;
  }
  function onProgress(event){
    const label=event.paper?.title?.slice(0,70)||'';
    let pct=Number(byId('analysisProgress').value)||0;
    switch(event.type){
      case 'paper':
        log(`开始论文 ${event.index}/${event.total}：${label}`);
        pct=Math.max(pct,Math.round(70*(event.index-1)/event.total));
        break;
      case 'chunk':
        log(`  提取证据：第 ${event.chunk}/${event.total} 块`);
        byId('currentStage').textContent=`${label} · 块 ${event.chunk}/${event.total}`;
        break;
      case 'paper-reused':log(`  ✓ 恢复已完成证据卡：${label}`);break;
      case 'chunk-reused':log(`  ✓ 跳过已保存的第 ${event.chunk}/${event.total} 块`);break;
      case 'group-reused':log(`  ✓ 复用已保存的第 ${event.index}/${event.total} 组`);break;
      case 'page-paper':log(`正在从 PDF 精确匹配 ${label} 的 ${event.count} 处证据页码…`);break;
      case 'chapter':log('正在单独重写章节：'+event.title);break;
      case 'paper-reduce':log('  正在形成该论文的证据卡…');break;
      case 'paper-error':log('  ⚠ 该论文未能分析：'+event.error);break;
      case 'group':
        log(`跨论文证据归纳：组 ${event.index}/${event.total}`);
        pct=Math.max(pct,75+Math.round(12*event.index/event.total));
        break;
      case 'synthesis':log('正在合并多个主题组的共同 Gap 和反例…');pct=90;break;
      case 'draft':log('跨论文归纳完成，正在生成综述初稿…');pct=95;break;
      case 'exemplar-chunk':
        log(`范例综述结构提取：第 ${event.index}/${event.total} 块`);
        byId('currentStage').textContent='范例 PDF：结构信息块 '+event.index+'/'+event.total;
        pct=Math.max(pct,Math.round(event.index/event.total*78));
        break;
      case 'exemplar-reduce':
        log(`范例结构归纳：组 ${event.index}/${event.total}`);
        pct=Math.max(pct,79+Math.round(event.index/event.total*13));
        break;
      case 'exemplar-template':
        log('正在抽象写作章节、图表功能与 Gap 论证框架（不复制原综述文字）…');
        pct=94;
        break;
    }
    byId('analysisProgress').value=pct;
    byId('runState').textContent=event.type==='draft'?'生成初稿':event.type==='group'?'跨论文分析':'正在分析';
  }


  async function startExemplarExtraction() {
    if(state.busy)return;
    const exemplar=state.exemplar;
    if(!exemplar){alert('请先把某篇 Zotero 本地综述论文设为范例');return;}
    if(!byId('dataConsent').checked){
      byId('settingsPanel').classList.remove('hidden');
      alert('请先勾选知情同意：提炼模板时也会将所选范例 PDF 的文本片段发送给你配置的模型服务。');
      return;
    }
    let settings;
    try {settings=getSettings();}
    catch(e){byId('settingsPanel').classList.remove('hidden');alert('请检查当前 API 配置：'+e.message);return;}
    saveSettings({silent:true});
    settings.maxTemplateChars=Math.min(1000000,Math.max(16000,settings.maxTemplateChars));
    if(!confirm(`即将从 Zotero 读取范例综述《${exemplar.title.slice(0,90)}》的 PDF 文本，逐块发送到 ${settings.endpoint} 提炼写作模板。不会把该综述自动加入新综述参考文献，也不会直接复制原文。确认开始吗？`))return;
    setBusy(true);
    state.progressLines=[];
    byId('logBox').textContent='';
    byId('progressPanel').classList.remove('hidden');
    byId('introPanel').classList.add('hidden');
    byId('analysisProgress').value=0;
    byId('runState').textContent='提炼范例';
    byId('currentStage').textContent='开始读取范例综述 PDF';
    byId('exemplarStatus').textContent='正在读取 PDF 全文、逐块提炼章节组织…';
    try {
      const result=await rt.extractExemplar(exemplar,settings,onProgress);
      state.exemplarResult=result;
      state.pendingTemplateMeta={
        origin:'exemplar',sourceItemID:exemplar.itemID,
        sourceTitle:exemplar.title,sourceCoverage:result.coverage,
      };
      byId('exemplarReportOutput').value=result.report;
      byId('exemplarReportQuality').textContent=`已分析范例 PDF 文本 ${result.processedCharacters.toLocaleString()} / ${result.textCharacters.toLocaleString()} 字符，共 ${result.chunkCount} 块；覆盖约 ${Math.round(result.coverage*100)}%${result.truncated?'（中部有未分析内容）':''}。模板仅迁移结构，不复制原论文内容。`;
      byId('exemplarReportPanel').classList.remove('hidden');
      byId('customTemplateName').value=result.template.name;
      byId('customTemplateInstruction').value=result.template.instruction;
      byId('templatePanel').classList.remove('hidden');
      byId('analysisProgress').value=100;
      byId('runState').textContent='范例模板待确认';
      byId('exemplarStatus').textContent='结构提炼完成。请审阅右侧结构分析与写作模板，修改后点击“保存自定义模板”。';
      log('范例模板结构分析已完成；等待你审阅、编辑并保存。');
    } catch(e){
      if(rt.isCancelled()){log('已停止提炼，不保存部分模板。');byId('exemplarStatus').textContent='已停止';}
      else{
        log('范例提炼失败：'+(e.message||e));
        byId('exemplarStatus').textContent='提炼失败：'+(e.message||e);
        alert('提炼失败：'+(e.message||e));
      }
    }finally{setBusy(false)}
  }

  async function startAnalysis(resume=false){
    if(state.busy)return;
    const question=byId('question').value.trim();
    if(question.length<12){alert('请写出更具体的研究问题（至少 12 字）');return;}
    const papers=includedPapers();
    if(!papers.length){alert('请先选择至少一篇论文');return;}
    if(papers.length>35){alert('第一版为控制上下文和费用，每次最多处理 35 篇，请分批进行');return;}
    if(!byId('dataConsent').checked){
      byId('settingsPanel').classList.remove('hidden');
      alert('请先查看模型接口，并明确勾选“我了解发送所选全文片段至所选模型服务”。');return;
    }
    let settings;
    try {settings=getSettings();}
    catch(e){alert('请先填写有效的 API 网址和模型：'+e.message);byId('settingsPanel').classList.remove('hidden');return;}
    if(settings.provider==='chatgpt' && !ReviewChatGPT.isConnected()){
      byId('settingsStatus').textContent='请先点击“使用 ChatGPT 登录”，完成官方授权';
      byId('settingsPanel').classList.remove('hidden');return;
    }
    if(settings.provider!=='chatgpt' && !settings.apiKey && !/localhost|127\.0\.0\.1|\[::1\]/.test(settings.endpoint)){
      if(!confirm('云端 API Key 为空。确认当前服务无需 API Key 吗？'))return;
    }
    const template=state.templates.find(t=>t.id===byId('templateSelect').value)||state.templates[0];
    saveSettings({silent:true});
    if(resume){
      const current=state.latestCheckpoint;
      const jobs=papers.map((paper,i)=>({...paper,id:'P'+(i+1)}));
      if(!ReviewCheckpoints.matches(current,jobs,question,settings)){
        alert('要从断点续跑，必须恢复相同的论文、研究问题及模型/分块设置。请先点击“恢复上次项目与选文献”。');return;
      }
    }
    state.result=null;state.progressLines=[];
    byId('logBox').textContent='';
    byId('progressPanel').classList.remove('hidden');
    byId('introPanel').classList.add('hidden');
    byId('analysisProgress').value=0;
    byId('currentStage').textContent='开始逐篇分析';
    byId('resultsPanel').classList.add('hidden');
    setBusy(true);
    try{
      const jobs=papers.map((p,i)=>({...p,id:'P'+(i+1)}));
      log(`已确认 ${jobs.length} 篇；模型 ${settings.profileName} / ${settings.model}；先提取证据与 Gap，不生成初稿`);
      log('外部来源缺少本地 PDF 时，只能做摘要分析，报告会明确区分');
      const result=await rt.analyzeEvidence(jobs,question,settings,onProgress,{resume});
      state.latestCheckpoint=await rt.loadLatestCheckpoint();
      state.result=result;
      state.analysisFingerprint=currentFingerprint();
      byId('analysisProgress').value=100;
      log(`证据与 Gap 分析完成：${result.sourceCount} 篇可分析，${result.metadataOnly} 篇缺正文/摘要。可先核对证据，再按模板生成初稿。`);
      byId('runState').textContent='Gap 已完成 · 等待生成初稿';
      showResults(result);
    } catch(e){
      if(rt.isCancelled()){log('用户已停止；每个已完成的文本块已保存在本机。可以重新打开插件续跑。');feedback('已停止 · 可续跑');}
      else {log('分析中断：'+(e.message||e)); feedback('分析失败');alert('分析失败：'+(e.message||e));}
    } finally{
      try{state.latestCheckpoint=await rt.loadLatestCheckpoint();}catch(e){log('读取缓存失败：'+e.message)}
      setBusy(false);updateRunOverview();
    }
  }

  async function generateReviewDraft(){
    if(state.busy)return;
    if(!state.result){alert('请先完成证据与 Gap 分析');return;}
    if(evidenceStale()){alert('当前研究问题或纳入的文献已改变。为保证引用对应，请重新运行“分析证据与 Gap”，再生成初稿。');return;}
    if(!byId('dataConsent').checked){
      byId('settingsPanel').classList.remove('hidden');
      alert('请再次确认：所选模型将收到此前逐篇提炼的证据摘要，以生成综述初稿。');return;
    }
    let settings;
    try {settings=getSettings();}catch(e){alert('请检查 API 设置：'+e.message);byId('settingsPanel').classList.remove('hidden');return;}
    const template=state.templates.find(t=>t.id===byId('templateSelect').value)||state.templates[0];
    if(!confirm('使用 '+settings.profileName+' / '+settings.model+' 按模板“'+template.name+'”生成综述初稿？这不会重新读取或逐块处理 PDF，但会向当前模型发送现有证据摘要。'))return;
    saveSettings({silent:true});
    setBusy(true);
    byId('progressPanel').classList.remove('hidden');
    byId('analysisProgress').value=92;
    byId('currentStage').textContent='根据已确认的 Gap 和证据卡生成初稿';
    try{
      const result=await rt.generateDraft(state.result,settings,template,onProgress);
      state.result=result;
      byId('draftOutput').value=result.draft||'';
      updateChapterChoices();
      byId('copyDraftBtn').disabled=false;
      byId('saveNoteBtn').disabled=false;
      byId('analysisProgress').value=100;
      byId('runState').textContent='初稿已生成 · 可编辑';
      log('初稿完成：'+template.name+'（未重新提取 PDF）；可更换模板再次生成。');
      renderGaps(result);
      showTab('draft');
    }catch(e){
      if(rt.isCancelled()){log('已停止生成初稿；之前的 Gap 与证据仍然保留。');}
      else{log('初稿生成失败：'+(e.message||e));alert('初稿生成失败：'+(e.message||e));}
    }finally{setBusy(false);updateRunOverview()}
  }

  function updateChapterChoices(){
    const sel=byId('chapterSelect'),old=sel.value;
    clear(sel);
    const contents=byId('draftOutput').value;
    for(const section of ReviewChapters.eligibleSections(contents)){
      const option=elm('option',null,section.title);option.value=String(section.index);sel.appendChild(option);
    }
    if([...sel.options].some(x=>x.value===old))sel.value=old;
    byId('regenerateChapterBtn').disabled=state.busy||!state.result||evidenceStale()||!sel.options.length;
    refreshDropdowns();
  }
  async function regenerateSelectedChapter(){
    if(state.busy||!state.result||evidenceStale())return;
    if(!byId('dataConsent').checked){alert('请先确认使用当前 API 处理已有证据卡');return;}
    let settings;try{settings=getSettings();}catch(e){alert(e.message);return;}
    const selection=Number(byId('chapterSelect').value);
    const oldText=byId('draftOutput').value;
    let chapter;
    try{chapter=ReviewChapters.preview(oldText,selection);}catch(e){alert(e.message);return;}
    if(!confirm('仅重新生成“'+chapter.title+'”章节吗？其它章节及你手工修改的文字将保持不变。'))return;
    const template=state.templates.find(t=>t.id===byId('templateSelect').value)||state.templates[0];
    setBusy(true);
    try{
      const result=await rt.regenerateChapter(state.result,oldText,selection,settings,template,onProgress);
      state.result=result;
      byId('draftOutput').value=result.draft;
      await rt.saveProjectSnapshot(result);
      updateChapterChoices();showTab('draft');renderGaps(result);
      log('已单独重写：'+chapter.title+'；其它章节未改变。');
    }catch(e){alert('本章节重写失败，原文未改变：'+(e.message||e));}
    finally{setBusy(false);updateRunOverview()}
  }
  async function restoreLatestCheckpoint(){
    if(state.busy||!state.latestCheckpoint)return;
    const cp=state.latestCheckpoint;
    if(!confirm('从本地恢复“'+cp.input?.question?.slice(0,75)+'”及 '+(cp.input?.papers?.length||0)+' 篇文献？这将替换当前未保存的文献选择与研究问题。'))return;
    state.included.clear();
    for(const paper of cp.input.papers||[])state.included.set(keyOf(paper),paper);
    byId('question').value=cp.input.question||'';
    // Restore the analysis settings, but never restore an API key.
    for(const id of ['chunkChars','maxCharsPerPaper'])byId(id).value=String(cp.input.settings[id]||'');
    byId('language').value=cp.input.settings.language||'zh-CN';
    state.restoredProjectID=cp.projectId;
    state.result=null;
    if(cp.synthesis){
      state.result={analyses:cp.analyses||[],synthesis:cp.synthesis,question:cp.input.question,
        draft:cp.draft||'',templateId:cp.templateId||null,
        sourceCount:(cp.analyses||[]).filter(a=>a.summary&&!a.skipped).length,
        metadataOnly:(cp.analyses||[]).filter(a=>a.skipped).length,
        warnings:[],projectId:cp.projectId};
    }
    renderIncluded();renderSuggestions();
    state.analysisFingerprint=state.result?currentFingerprint():null;
    if(state.result)showResults(state.result);
    const current=activeProfile();
    const saved=cp.input.settings;
    if(current.model!==saved.model||ReviewProfiles.effectiveEndpoint(current)!==saved.endpoint){
      byId('checkpointStatus').textContent='请切换至原模型 '+saved.model+'；并确认研究设置';
      byId('settingsPanel').classList.remove('hidden');
    }
    log('已恢复项目。本地仅包含已完成的证据卡，不含原文 PDF 和 API 密钥。');
    updateRunOverview();
  }
  async function locatePagesForGap(gap=null){
    if(state.busy||!state.result||evidenceStale())return;
    if(!confirm('将逐篇重新提取相关 PDF 文本前缀以核对原文所在文件页码。长篇 PDF 可能耗时数分钟，且不会上传 PDF 到其他平台。继续吗？'))return;
    setBusy(true);
    byId('progressPanel').classList.remove('hidden');
    byId('pageStatus').textContent='正在定位文件页码…';
    try{
      const allowed=gap?new Set(gap.evidenceIds||[]):null;
      const status=await rt.locateGapPages(state.result,onProgress,allowed);
      byId('pageStatus').textContent='真实匹配 '+status.exact+' 处 · 无法定位 '+status.missing+' 处';
      renderGaps(state.result);renderEvidence(state.result);
      log('PDF 页码定位完成；仅展示真实匹配结果，可能与论文印刷页码不同。');
    }catch(e){byId('pageStatus').textContent='页码定位异常：'+(e.message||e);}
    finally{setBusy(false);updateRunOverview()}
  }
  function showTab(tab){
    for(const el of document.querySelectorAll('.tab'))el.classList.toggle('current',el.dataset.tab===tab);
    const views={gaps:'gapView',evidence:'evidenceView',draft:'draftView'};
    for(const id of ['gapView','evidenceView','draftView'])byId(id).classList.toggle('hidden',id!==views[tab]);
  }
  function appendClaimsGroup(root,title,claims,known,evidence){
    if(!Array.isArray(claims)||!claims.length)return;
    root.appendChild(elm('h3','group-heading',title));
    claims.forEach((g,i)=>{
      const c=elm('article','gap-card');
      c.appendChild(elm('h3',null,`${i+1}. ${g.claim||String(g)}`));
      const refs=(g.paperIds||[]).filter(x=>known.has(x));
      c.appendChild(elm('div','note-label',`${g.status||'需核验'} · 支持文献 ${refs.length} 篇 · ${refs.map(x=>'['+x+']').join(', ')||'未提供可靠 ID'}`));
      if(g.evidenceIds?.length){
        const container=elm('div','gap-cites');
        for(const id of g.evidenceIds.slice(0,16)){
          const hit=evidence.get(id);
          const page=hit?.claim?.pdfPage;
          const button=elm('button','btn secondary',id+(page?' · PDF p.'+page:''));
          button.type='button';
          button.title=page?'点击在 PDF 中跳转到文件页码 '+page:'尚未定位 PDF 文件页码';
          button.addEventListener('click',()=>{
            if(page&&hit.analysis.attachmentID){
              void z.Reader.open(hit.analysis.attachmentID,{pageIndex:page-1})
                .catch(()=>alert('无法自动跳转，请打开附件并导航至 PDF 文件第 '+page+' 页'));
            }else {
              showTab('evidence');
              const paperID=hit?.analysis?.paper?.id;
              const details=[...byId('evidenceView').querySelectorAll('details.evidence-paper')]
                .find(x=>x.dataset.paperId===paperID);
              if(details){details.open=true;details.scrollIntoView({block:'nearest'});}
            }
          });
          container.appendChild(button);
        }
        c.appendChild(container);
        const locate=elm('button','btn text','定位本条 Gap 的 PDF 页码');
        locate.type='button';locate.disabled=state.busy;
        locate.addEventListener('click',()=>void locatePagesForGap(g));
        c.appendChild(locate);
      }
      root.appendChild(c);
    });
  }
  function renderGaps(result){
    const root=byId('gapView');clear(root);
    const valid=result.analyses.filter(a=>!a.skipped);
    root.appendChild(elm('h2',null,`跨论文研究空白 · ${valid.length} 篇已分析文献`));
    root.appendChild(elm('p','helper','按文献证据归纳，不等于对整个学科进行了穷尽检索。支持数量仅在本次纳入样本中统计。'));
    const s=result.synthesis||{};
    // A single lookup table serves every Gap theme and citation button.
    const known=new Set(valid.map(a=>a.paper.id));
    const evidence=new Map();
    for(const a of result.analyses){
      for(const claim of ReviewCore.flattenPaperEvidence(a)){
        evidence.set(claim.evidenceId,{claim,analysis:a});
      }
    }
    appendClaimsGroup(root,'共同局限 / 作者明确陈述的限制',s.establishedLimitations,known,evidence);
    appendClaimsGroup(root,'潜在 Research Gaps（需要进一步验证）',s.possibleGaps,known,evidence);
    appendClaimsGroup(root,'方法主题与共识',s.themes,known,evidence);
    appendClaimsGroup(root,'反例、分歧和不同适用边界',s.counterExamples,known,evidence);
    appendClaimsGroup(root,'仍然不确定的结论',s.uncertainties,known,evidence);
    if(result.warnings?.length)root.appendChild(elm('p','note-label','⚠ 初稿包含未经来源列表确认的引用 ID：'+result.warnings.join(', ')));
  }
  function renderEvidence(result){
    const root=byId('evidenceView');clear(root);
    root.appendChild(elm('h2',null,'逐篇全文提取结果 · 原文证据'));
    // Avoid retaining thousands of quote nodes when the user is only reading
    // the Gap overview. Details are built on expansion and released on close.
    const kinds={methods:'方法',contributions:'贡献',limitations:'局限',openProblems:'未解问题',counterEvidence:'反例'};
    for(const a of result.analyses){
      const card=elm('details','evidence-paper');
      card.dataset.paperId=String(a.paper.id);
      const quality=a.sourceQuality==='fulltext'?'PDF 全文':a.sourceQuality==='abstract'?'仅摘要':'无法分析';
      const claimCount=(a.chunks||[]).reduce((n,ch)=>n+(ch.claims||[]).length,0);
      const title=elm('summary','evidence-summary',`[${a.paper.id}] ${a.paper.title} · ${quality} · 已分析 ${Math.round(a.coverage*100)}% · ${claimCount} 条证据${a.warning||a.error?' ⚠':''}`);
      card.appendChild(title);
      let content=null;
      card.addEventListener('toggle',()=>{
        if(!card.open){
          if(content){content.remove();content=null;}
          return;
        }
        if(content)return;
        content=elm('div','evidence-paper-detail');
        content.appendChild(elm('div','source-status',`${quality} · 已分析 ${Math.round(a.coverage*100)}% 可取得文本${a.truncated?' · 因单篇字符上限截断':''}`));
        if(a.warning||a.error)content.appendChild(elm('p',null,'⚠ '+(a.warning||a.error)));
        const findings=ReviewCore.flattenPaperEvidence(a);
        if(!findings.length)content.appendChild(elm('p',null,'未抽取到经引用的证据。'));
        for(const claim of findings){
          const row=elm('div','evidence-line');
          row.appendChild(elm('p',null,`${kinds[claim.kind]||claim.kind} · ${claim.interpretation==='inferred'?'模型推断':'作者陈述'} · ${claim.evidenceId}\n${claim.claim}`));
          const q=elm('p','evidence-quote'+(claim.verified?'':' unverified'),
            `${claim.verified?'✓ 原文可匹配':'⚠ 引文未能在该块中精确匹配'}：“${claim.quote||'无原文'}”`);
          row.appendChild(q);
          if(claim.pdfPage){
            const link=elm('button','btn secondary evidence-page-link','PDF 文件第 '+claim.pdfPage+' 页 ↗');
            link.type='button';link.addEventListener('click',()=>{
              void z.Reader.open(a.attachmentID,{pageIndex:claim.pdfPage-1})
                .catch(()=>alert('无法自动跳页，请打开 PDF 到文件第 '+claim.pdfPage+' 页'));
            });
            row.appendChild(link);
          }else if(claim.verified&&a.sourceQuality==='fulltext'){
            row.appendChild(elm('span','subtle','页码未定位；可在 Gap 页点击“定位”'));
          }
          content.appendChild(row);
        }
        card.appendChild(content);
      });
      root.appendChild(card);
    }
  }
  function showResults(result){
    byId('resultsPanel').classList.remove('hidden');
    renderGaps(result);renderEvidence(result);
    byId('draftOutput').value=result.draft||'';
    byId('copyDraftBtn').disabled=!result.draft;
    byId('saveNoteBtn').disabled=!result.draft;
    byId('regenerateDraftBtn').disabled=!result.draft;
    updateChapterChoices();
    showTab('gaps');
  }

  function wire(){
    byId('settingsBtn').addEventListener('click',()=>{byId('settingsPanel').classList.toggle('hidden');ReviewDropdown.close();});
    byId('closeSettings').addEventListener('click',()=>byId('settingsPanel').classList.add('hidden'));
    byId('saveSettings').addEventListener('click',()=>saveSettings());
    byId('testAPI').addEventListener('click',()=>void testActiveAPI());
    byId('signInChatGPT').addEventListener('click',()=>void loginChatGPT());
    byId('signOutChatGPT').addEventListener('click',()=>void logoutChatGPT());
    byId('refreshChatGPTModels').addEventListener('click',()=>void listChatGPTModels());
    byId('apiProfileSelect').addEventListener('change',()=>switchAPI(byId('apiProfileSelect').value));
    byId('activeProfileQuick').addEventListener('change',()=>switchAPI(byId('activeProfileQuick').value));
    byId('addAPIProfile').addEventListener('click',()=>addAPIProfile(false));
    byId('cloneAPIProfile').addEventListener('click',()=>addAPIProfile(true));
    byId('deleteAPIProfile').addEventListener('click',deleteAPIProfile);
    byId('apiRoute').addEventListener('change',()=>{updateGatewayVisibility();byId('dataConsent').checked=false;updateRunOverview();});
    byId('proxyMode').addEventListener('change',()=>{updateProxyVisibility();byId('dataConsent').checked=false;updateRunOverview();});
    byId('proxyType').addEventListener('change',()=>{updateProxyVisibility();byId('dataConsent').checked=false;updateRunOverview();});
    byId('apiProvider').addEventListener('change',()=>{
      const preset=ReviewProfiles.preset(byId('apiProvider').value);
      byId('endpoint').value=preset.endpoint;
      byId('model').value=preset.model;
      byId('apiProfileName').value=preset.name;
      byId('apiKey').value='';byId('rememberKey').checked=false;
      byId('dataConsent').checked=false;
      byId('settingsStatus').textContent=preset.id==='chatgpt'
        ?'请选择“使用 ChatGPT 登录”；无需 API Key。'
        :'已应用服务商预设。请填写该服务的 API Key，然后保存或测试。';
      showChatGPTFields();
      refreshDropdowns();
      updateRunOverview();
    });
    for(const id of ['question','model','apiProfileName','endpoint','gatewayEndpoint','apiKey','proxyHost','proxyPort','proxyType','proxyRemoteDNS','chunkChars','maxCharsPerPaper','apiRoute']) {
      byId(id)?.addEventListener('input',()=>{
        if(['endpoint','gatewayEndpoint','apiKey','proxyHost','proxyPort','proxyType','proxyRemoteDNS'].includes(id))byId('dataConsent').checked=false;
        updateRunOverview();
      });
    }
    byId('dataConsent').addEventListener('change',updateRunOverview);
    byId('templateEditorBtn').addEventListener('click',openTemplateEditor);
    byId('closeTemplateEditor').addEventListener('click',()=>byId('templatePanel').classList.add('hidden'));
    byId('saveTemplateBtn').addEventListener('click',saveCustomTemplate);
    byId('deleteTemplateBtn').addEventListener('click',deleteTemplate);
    byId('extractExemplarBtn').addEventListener('click',()=>void startExemplarExtraction());
    byId('editGeneratedTemplateBtn').addEventListener('click',()=>byId('templatePanel').classList.remove('hidden'));
    byId('closeExemplarReport').addEventListener('click',()=>byId('exemplarReportPanel').classList.add('hidden'));
    byId('localSearchBtn').addEventListener('click',()=>void discovery('local'));
    byId('onlineSearchBtn').addEventListener('click',()=>void discovery('online'));
    byId('autoDiscoverBtn').addEventListener('click',()=>void discovery('both'));
    byId('runBtn').addEventListener('click',()=>void startAnalysis(false));
    byId('restoreCheckpointBtn').addEventListener('click',()=>void restoreLatestCheckpoint());
    byId('resumeCheckpointBtn').addEventListener('click',()=>void startAnalysis(true));
    byId('clearCheckpointBtn').addEventListener('click',async()=>{
      const cp=state.latestCheckpoint;if(!cp||state.busy)return;
      if(!confirm('删除上次项目的本地中间结果？不会删除 Zotero 论文或笔记。'))return;
      await rt.clearCheckpoint(cp.projectId);state.latestCheckpoint=null;
      updateRunOverview();
    });
    byId('locatePagesBtn').addEventListener('click',()=>void locatePagesForGap());
    byId('regenerateChapterBtn').addEventListener('click',()=>void regenerateSelectedChapter());
    byId('draftOutput').addEventListener('input',()=>{
      if(state.result){
        state.result.draft=byId('draftOutput').value;
        if(state.draftSaveTimer)clearTimeout(state.draftSaveTimer);
        state.draftSaveTimer=setTimeout(()=>{
          state.draftSaveTimer=null;
          void rt.saveProjectSnapshot(state.result).catch(e=>log('保存草稿失败：'+e.message));
        },1500);
      }
      updateChapterChoices();
    });
    byId('generateDraftBtn').addEventListener('click',()=>void generateReviewDraft());
    byId('regenerateDraftBtn').addEventListener('click',()=>void generateReviewDraft());
    byId('cancelBtn').addEventListener('click',()=>{rt.cancel();log('停止请求已收到，将在当前网络请求结束后停止。')});
    byId('copyDraftBtn').addEventListener('click',()=>{
      try{z.Utilities.Internal.copyTextToClipboard(byId('draftOutput').value);alert('Markdown 已复制到剪贴板');}
      catch(e){alert('复制失败：'+e.message)}
    });
    byId('saveNoteBtn').addEventListener('click',async()=>{
      const text=byId('draftOutput').value.trim();if(!text){alert('请先生成综述初稿');return;}
      if(!confirm('将当前初稿保存为 Zotero 库中的一条独立笔记？（不会覆盖已有论文或笔记）'))return;
      try{const note=await rt.saveNote(text);alert('已保存为 Zotero 笔记，条目 ID：'+note.id);}
      catch(e){alert('保存笔记失败：'+(e.message||e));}
    });
    for(const tab of document.querySelectorAll('.tab'))tab.addEventListener('click',()=>showTab(tab.dataset.tab));
    byId('copyDraftBtn').disabled=true;
    byId('saveNoteBtn').disabled=true;
    byId('generateDraftBtn').disabled=true;
    byId('regenerateDraftBtn').disabled=true;
    window.addEventListener('unload',()=>{
      if(state.draftSaveTimer)clearTimeout(state.draftSaveTimer);
      // Also attempt to persist the current user's Markdown edits on close.
      if(state.result?.draft)void rt.saveProjectSnapshot(state.result).catch(()=>{});
      rt.cancel();
    });
  }
  async function init(){
    ReviewDropdown.init();
    try{ReviewChatGPT.restore();}catch(e){byId('chatgptAuthStatus').textContent='凭据库不可用：'+e.message;}
    wire();loadSettings();fillTemplates();renderIncluded();updateRunOverview();
    refreshDropdowns();
    try{state.latestCheckpoint=await rt.loadLatestCheckpoint();}
    catch(e){byId('checkpointStatus').textContent='本地项目读取失败：'+e.message;}
    try{
      const initial=await rt.hydrateInitialSelection();
      for(const item of initial)setIncluded(item,true);
      if(initial.length>0)byId('discoveryStatus').textContent='已从 Zotero 接收 '+initial.length+' 篇选中文献';
      else byId('discoveryStatus').textContent='当前没有所选论文；可从库内检索补充';
      updateRunOverview();
    }catch(e){byId('discoveryStatus').textContent='无法读取初始选中文献：'+(e.message||e)}
  }
  window.addEventListener('DOMContentLoaded',()=>void init(),{once:true});
})();
