(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const titles=['계약당사자','Affiliate','비밀정보 정의','사용 목적','비밀유지 의무','관계자 위반 책임','네 가지 예외','강제 공개','계약·존속기간','소유권·라이선스','보증 부인','반환·폐기','준거법','분쟁해결','Publicity','추가 계약 의무 없음','기타 조항 전체'];
  const fields=[['law','준거법','원하는 준거법을 입력하세요'],['dispute','분쟁해결','방식·기관·중재지·언어 등 원하는 조건'],['term','계약기간','원하는 기간과 기산점을 입력하세요'],['survival','비밀유지 존속기간','원하는 존속기간과 기산점 또는 존속 없음']];
  const state={file:null,item:null,review:null,final:null,step:1,maxStep:1,dirty:false,busy:false,retry:null,choices:{},status:null};
  const deferredPanels=new WeakMap();
  function deferPanel(id,render){
    const target=$(id),panel=target.closest('details');
    deferredPanels.delete(panel);target.replaceChildren();
    if(panel.open)target.innerHTML=render();
    else deferredPanels.set(panel,()=>{target.innerHTML=render();});
  }
  function clearReviewPanels(){
    for(const id of ['preference-results','checklist','edit-list']){
      const target=$(id),panel=target.closest('details');
      deferredPanels.delete(panel);panel.open=false;target.replaceChildren();
    }
  }
  document.addEventListener('toggle',event=>{
    if(!event.target.open)return;
    const render=deferredPanels.get(event.target);
    if(render){deferredPanels.delete(event.target);render();}
  },true);
  function error(value,retry=null){
    $('error-text').textContent=typeof value==='string'?value:value.message;const d=value?.diagnostic;
    $('error-diagnostic').hidden=!d;
    if(d){const stage={upload:'문서 읽기',analyze:'핵심정보 분석',review:'법률검토',finalize:'최종본 생성',request:'요청 처리'}[d.stage]||d.stage;$('error-diagnostic').innerHTML=`<p>${esc(stage)}${d.criterion?` · 검토 ${esc(d.criterion)}번`:''}${d.paragraphId?` · 위치: ${esc(d.paragraphId)}`:''}</p>${d.detail?`<p>${esc(d.detail)}</p>`:''}${d.sourceExcerpt||d.generatedQuote?`<details class="error-evidence"><summary>원문과 AI 인용 비교</summary><div class="comparison"><div><h4>원문 문단 · 최대 1,500자</h4><p>${esc(d.sourceExcerpt||'해당 문단을 찾을 수 없음')}</p></div><div><h4>AI가 인용한 문구 · 최대 1,500자</h4><p>${esc(d.generatedQuote||'인용 없음')}</p></div></div></details>`:''}<p><strong>해결 방법</strong> ${esc(d.action)}</p><p class="micro">${esc(d.code)}${d.requestId?` · 요청 ID ${esc(d.requestId)}`:''}</p>`;}
    $('error').hidden=false;state.retry=retry;$('retry-button').hidden=!retry;$('error').scrollIntoView?.({block:'nearest'});
  }
  function clearError(){$('error').hidden=true;state.retry=null;}
  function busy(title,description){$('busy-title').textContent=title;$('busy-description').textContent=description;$('busy-overlay').hidden=false;document.querySelector('.app-shell').inert=true;document.querySelector('.workspace-sidebar').inert=true;}
  async function perform(fn){if(state.busy)return;state.busy=true;clearError();try{await fn();}catch(e){error(e,e.diagnostic?.retryable===false?null:fn);}finally{state.busy=false;$('busy-overlay').hidden=true;document.querySelector('.app-shell').inert=false;document.querySelector('.workspace-sidebar').inert=false;if($('error').hidden)$(`step-${state.step}`).querySelector('h1')?.focus({preventScroll:true});}}
  async function api(url,options={}){
    if(location.protocol==='file:')throw new Error('파일을 직접 열어 화면을 보고 있습니다. start.cmd를 실행한 뒤 http://localhost:4173에서 검토 기능을 이용해 주세요.');
    let response;try{response=await fetch(url,{...options,headers:{'X-NDA-Request':'1',...(options.headers||{})}});}catch{throw new Error('로컬 서버에 연결할 수 없습니다. start.cmd 실행 상태를 확인해 주세요.');}
    let result;try{result=await response.json();}catch{throw new Error('서버 응답을 읽지 못했습니다. start.cmd로 실행한 주소인지 확인해 주세요.');}
    if(!response.ok){const e=new Error(result.error||'요청 처리에 실패했습니다.');e.diagnostic=result.diagnostic;e.status=response.status;throw e;}return result;
  }
  const post=(url,data={})=>api(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  function syncNavigation(){document.querySelectorAll('[data-stage]').forEach(button=>{const n=Number(button.dataset.stage);button.disabled=n>state.maxStep;button.classList.toggle('current',n===state.step);button.classList.toggle('done',n<state.step);if(n===state.step)button.setAttribute('aria-current','step');else button.removeAttribute('aria-current');});$('current-location').textContent=['새 계약 검토','검토 기준 설정','수정본 및 권고사항','최종 다운로드'][state.step-1];}
  function showStep(step){state.step=step;state.maxStep=Math.max(state.maxStep,step);for(let i=1;i<=4;i++)$(`step-${i}`).hidden=i!==step;document.querySelectorAll('.stepper li').forEach(li=>{const n=Number(li.dataset.step);li.classList.toggle('active',n===step);li.classList.toggle('done',n<step);if(n===step)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});syncNavigation();$('demo-banner').hidden=!state.item?.isDemo;window.scrollTo?.({top:0,behavior:'instant'});const h=$(`step-${step}`).querySelector('h1');h.setAttribute('tabindex','-1');if(!state.busy)h.focus({preventScroll:true});}
  function evidence(list){return list?.length?`<details class="evidence"><summary>원문 근거 보기</summary>${list.map(e=>`<blockquote>${esc(e.quote)}<cite>${esc(e.paragraphId)}</cite></blockquote>`).join('')}</details>`:'';}
  function notices(list){return list?.length?`<div class="notice"><ul>${[...new Set(list)].map(t=>`<li>${esc(t)}</li>`).join('')}</ul></div>`:'';}
  function selectFile(file){
    clearError();if(!file)return;
    if(!/\.(docx|doc)$/i.test(file.name)){removeFile();error('DOCX 또는 DOC 파일을 선택해 주세요.');return;}
    if(!file.size||file.size>10*1024*1024){removeFile();error('0바이트를 초과하고 10MB 이하인 파일을 선택해 주세요.');return;}
    state.file=file;state.item=null;state.review=null;state.final=null;state.maxStep=1;state.dirty=false;syncNavigation();$('demo-banner').hidden=true;$('selected-file').hidden=false;$('file-name').textContent=file.name;$('file-size').textContent=`${(file.size/1024).toFixed(1)} KB`;$('upload-button').disabled=false;$('drop-zone').classList.add('has-file');
  }
  function removeFile(){state.file=null;state.item=null;state.review=null;state.final=null;state.maxStep=1;state.dirty=false;state.choices={};syncNavigation();$('file-input').value='';$('selected-file').hidden=true;$('upload-button').disabled=true;$('drop-zone').classList.remove('has-file');}
  async function upload(){
    if(!state.file)throw new Error('파일을 먼저 선택해 주세요.');
    busy('문서를 읽고 있습니다.','원본을 보관하고 계약서의 텍스트와 문단을 확인합니다.');
    if(!state.item)state.item=await api(`/api/cases?name=${encodeURIComponent(state.file.name)}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:state.file});
    busy('계약의 핵심정보를 분석하고 있습니다.','당사자, 보호 방향, 준거법·분쟁해결 및 기간을 확인합니다.');
    try{state.item=await post(`/api/cases/${state.item.id}/analyze`);}catch(e){if(e.status===404)state.item=null;throw e;}
    renderFacts();showStep(2);
  }
  async function openDemo(){busy('예시 계약을 준비하고 있습니다.','가상의 계약으로 실제 DOCX 생성 흐름을 체험합니다.');state.item=await post('/api/demo');state.review=null;state.final=null;state.maxStep=2;state.choices={};renderFacts();showStep(2);}
  function renderFacts(){
    clearReviewPanels();
    const item=state.item,f=item.facts;$('preferences-form').reset();state.dirty=false;$('stale-notice').hidden=true;
    $('document-summary').innerHTML=`<span class="file-icon">W</span><span class="filename">${esc(item.name)}</span><span class="micro">${item.paragraphCount}개 본문 문단</span>`;
    $('facts-warnings').innerHTML=notices([...f.warnings,...(!f.parties.length?['계약당사자를 확인하지 못했습니다. 당사자 정보가 있는 문서를 업로드해 주세요.']:[])]);
    $('party-list').innerHTML=f.parties.map((p,i)=>`<label class="party-card"><span class="party-top"><input type="radio" name="company" value="${esc(p.id)}" required><span>${esc(p.name)}</span></span><dl class="party-info"><dt>설립국</dt><dd>${esc(p.jurisdiction||'명시되지 않음')}</dd><dt>역할</dt><dd>${esc(p.role||'확인 필요')}</dd></dl>${evidence(p.evidence)}</label>`).join('');
    const type={mutual:'상호 NDA',unilateral:'일방 NDA',asymmetric:'비대칭 NDA',unclear:'유형 확인 필요'}[f.ndaType];
    $('nda-type').innerHTML=`<span class="pill">${esc(type)}</span><span>${esc(f.ndaExplanation)}</span>${evidence(f.ndaEvidence)}`;
    $('condition-list').innerHTML=fields.map(([key,label,placeholder])=>`<div class="condition-card"><h3>${label}${f[key].indefinite?'<span class="pill attention">기한 확인 필요</span>':''}</h3><div class="original-value"><span class="value-label">현재 계약 내용</span>${esc(f[key].value)}</div>${evidence(f[key].evidence)}<label for="override-${key}">대체할 내용 · 비워두면 원문 유지</label><textarea id="override-${key}" name="${key}" rows="2" maxlength="2000" placeholder="${placeholder}"></textarea></div>`).join('');
    $('purpose-original').innerHTML=`<span class="value-label">현재 사용 목적</span>${esc(f.purpose.value)}${evidence(f.purpose.evidence)}`;
    $('purpose-assessment').innerHTML=`<span class="pill ${f.purposeAssessment.status==='adequate'?'':'attention'}">${({adequate:'적정',needs_revision:'수정 권장',unclear:'확인 필요'})[f.purposeAssessment.status]}</span><p>${esc(f.purposeAssessment.reason)}</p>`;
    $('existing-revisions').hidden=!item.hasRevisions;$('accept-existing').required=item.hasRevisions;$('review-button').disabled=!f.parties.length;
  }
  function preferenceInput(){
    const company=document.querySelector('input[name=company]:checked');
    if(!company)throw new Error('대리하는 회사를 선택해 주세요.');
    return {companyId:company.value,overrides:Object.fromEntries(fields.map(([key])=>[key,$(`override-${key}`).value.trim()])),purposeText:$('purpose-text').value.trim(),acceptExistingRevisions:$('accept-existing').checked};
  }
  async function review(){const input=preferenceInput();busy('우리 회사의 입장에서 검토하고 있습니다.','17개 기준을 검토하고 Word 변경내용 추적으로 작성합니다. 문서 길이에 따라 몇 분이 걸릴 수 있으며, 결과가 길면 자동으로 다시 요청합니다.');state.review=await post(`/api/cases/${state.item.id}/review`,input);state.choices={};state.final=null;state.dirty=false;state.maxStep=3;$('stale-notice').hidden=true;renderReview();showStep(3);}
  function setLink(id,url,name){$(id).href=url;$(id).download=name;}
  function renderReview(){
    const r=state.review;$('review-summary').textContent=r.summary;
    const party=state.item.facts.parties.find(p=>p.id===document.querySelector('input[name=company]:checked')?.value);
    $('review-context').textContent=`대리 회사: ${party?.name||'확인 필요'} · ${state.item.name}${r.questions.length?` · 확인 필요 ${r.questions.length}건`:''}${r.reused?' · 동일 조건의 이전 결과':''}`;
    $('recommendation-toolbar').hidden=!r.recommendations.length;
    $('review-metrics').innerHTML=`<div class="metric"><span>검토 항목</span><strong>17</strong><small>개</small></div><div class="metric"><span>본문 변경</span><strong>${r.edits.length}</strong><small>건</small></div><div class="metric"><span>추가 권고</span><strong>${r.recommendations.length}</strong><small>건</small></div>`;
    $('review-questions').innerHTML=notices(r.questions);setLink('download-v1',r.files.v1,`${baseName()}-v1.docx`);
    const prefLabels={purpose:'사용 목적',law:'준거법',dispute:'분쟁해결',term:'계약기간',survival:'존속기간'},prefStatus={kept:'원문 유지',applied:'반영',already_satisfied:'이미 충족',needs_confirmation:'확인 필요'};
    deferPanel('preference-results',()=>r.preferences.map(p=>`<article class="preference-result"><h3>${prefLabels[p.field]} <span class="pill ${p.status==='needs_confirmation'?'attention':''}">${prefStatus[p.status]}</span></h3><p class="micro">입력: ${esc(r.userPreferences?.[p.field]||'없음')}</p><p>${esc(p.interpreted)}</p><p class="muted">${esc(p.reason)}</p>${evidence(p.evidence)}</article>`).join(''));
    $('other-clause-list').innerHTML=r.otherClauses.length?r.otherClauses.map(c=>`<article class="other-clause"><div class="rec-title"><span class="pill quiet">${esc(c.clause||c.evidence[0]?.paragraphId)}</span><h3>${esc(c.title)}</h3><span class="pill ${c.assessment==='attention'?'attention':'quiet'}">${c.assessment==='attention'?'특이사항':'유지 가능'}</span></div><p>${esc(c.summary)}</p><p class="muted">${esc(c.impact)}</p>${evidence(c.evidence)}</article>`).join(''):'<p class="muted">1–16번 외의 추가 실질 조항이 없습니다.</p>';
    const labels={ok:'유지',changed:'수정',attention:'확인',not_applicable:'해당 없음'};
    deferPanel('checklist',()=>[...r.checklist].sort((a,b)=>a.number-b.number).map(c=>`<div class="check-row"><span class="check-number">${String(c.number).padStart(2,'0')}</span><strong>${esc(titles[c.number-1])}</strong><span class="pill ${c.status==='attention'?'attention':c.status==='ok'||c.status==='not_applicable'?'quiet':''}">${labels[c.status]}</span><p>${esc(c.reason)}</p></div>`).join(''));
    deferPanel('edit-list',()=>r.edits.length?r.edits.map(e=>`<article class="edit-card"><span class="pill">${e.note?'본문 검토 메모':`검토 ${e.criteria.join(' · ')}번`}</span><p>${esc(e.reason)}</p><div class="comparison"><div><h4>${e.action==='insert_after'?'삽입 위치의 원문':'수정 전'}</h4><p>${esc(e.original)}</p></div><div class="after"><h4>${e.action==='insert_after'?'추가 문구':'수정 후'}</h4><p>${esc(e.replacement)}</p></div></div></article>`).join(''):'<p class="empty-state">자동 수정 사항이 없습니다.</p>');
    $('recommendation-list').innerHTML=r.recommendations.length?r.recommendations.map((rec,i)=>`<article class="recommendation"><div class="rec-title"><span class="pill attention">${esc(rec.clause||rec.evidence.paragraphId)}</span><h3>${esc(rec.title)}</h3></div><p class="rec-impact">${esc(rec.impact)}</p>${evidence([rec.evidence])}<p class="rec-reason">${esc(rec.reason)}</p><div class="rec-proposal"><strong>권장 수정 문구</strong>${esc(rec.edit.replacement)}</div><fieldset class="choice-row" data-recommendation="${esc(rec.id)}"><legend class="sr-only">${esc(rec.title)} 채택 여부</legend><label><input type="radio" name="recommendation-${i}" value="adopt"> 채택</label><label><input type="radio" name="recommendation-${i}" value="reject"> 미채택</label><label><input type="radio" name="recommendation-${i}" value="defer" checked> 보류</label></fieldset></article>`).join(''):'<div class="empty-state">별도로 선택할 추가 권고사항이 없습니다. 1차 검토 내용을 최종본으로 생성할 수 있습니다.</div>';
    updateSelection();
  }
  function updateSelection(){const counts={adopt:0,reject:0,defer:0};for(const r of state.review.recommendations)counts[state.choices[r.id]||'defer']++;$('selection-summary').textContent=`채택 ${counts.adopt}건 · 미채택 ${counts.reject}건 · 보류 ${counts.defer}건`;return counts;}
  function invalidateFinal(){state.final=null;state.maxStep=3;syncNavigation();}
  function chooseAll(choice){if(!state.review)return;for(const rec of state.review.recommendations)state.choices[rec.id]=choice;document.querySelectorAll('#recommendation-list .choice-row input').forEach(input=>{input.checked=input.value===choice;});invalidateFinal();updateSelection();}
  function baseName(){return state.item.name.replace(/\.(docx|doc)$/i,'');}
  async function finalize(){busy('최종 수정본을 만들고 있습니다.','기본 수정에 채택한 권고만 더합니다. 원본과 1차 수정본도 유지됩니다.');const selected=state.review.recommendations.filter(r=>state.choices[r.id]==='adopt').map(r=>r.id);state.final=await post(`/api/cases/${state.item.id}/finalize`,{reviewId:state.review.reviewId,selected});state.final.generatedAt=new Date().toLocaleString('ko-KR');renderFinal();showStep(4);}
  function renderFinal(){
    const r=state.review,f=state.final,counts=updateSelection();$('final-filename').textContent=`${baseName()}-v2.docx`;$('final-count').textContent=`기본 변경 ${r.edits.length}건 · 추가 채택 ${f.adopted.length}건`;
    setLink('download-v2',f.file,`${baseName()}-v2.docx`);setLink('download-original',r.files.original,state.item.name);setLink('download-baseline',r.files.baseline,`${baseName()}-baseline.docx`);setLink('download-v1-again',r.files.v1,`${baseName()}-v1.docx`);
    const omitted=r.recommendations.filter(rec=>!f.adopted.some(a=>a.id===rec.id));
    $('final-adopted').innerHTML=`<h3>반영한 추가 권고사항</h3>${f.adopted.length?`<ul>${f.adopted.map(a=>`<li>${esc(a.title)}</li>`).join('')}</ul>`:'<p class="muted">추가 채택 없이 기본 검토 수정본을 생성했습니다.</p>'}${omitted.length?`<div class="not-adopted"><h3>반영하지 않은 권고사항</h3><ul>${omitted.map(rec=>`<li>${esc(rec.title)} · ${state.choices[rec.id]==='reject'?'미채택':'보류'}</li>`).join('')}</ul></div>`:''}<p class="micro">미채택 ${counts.reject}건 · 보류 ${counts.defer}건은 반영하지 않았습니다.<br>V2 · ${esc(f.generatedAt)} 생성</p>`;
    $('final-questions').innerHTML=notices(r.questions);
  }
  function reset(){clearError();clearReviewPanels();state.item=null;state.review=null;state.final=null;state.choices={};removeFile();showStep(1);}
  async function deleteCase(){busy('검토 자료를 삭제하고 있습니다.','이 서버에 보관된 원본과 수정본을 삭제합니다.');await api(`/api/cases/${state.item.id}`,{method:'DELETE'});reset();}
  function openSetup(){const d=$('setup-dialog');if(d.showModal)d.showModal();else d.setAttribute('open','');}
  function preferencesChanged(){if(!state.review)return;state.dirty=true;state.maxStep=2;state.final=null;$('stale-notice').hidden=false;syncNavigation();}
  async function checkStatus(){
    try{const s=await api('/api/status');state.status=s;$('connection-status').innerHTML=`<i></i>${s.aiConfigured?'AI 연결 준비':'예시 체험 가능'}`;$('connection-status').title=s.aiKeySource==='file'?'API 키 파일에서 키를 불러왔습니다.':s.aiConfigured?'서버 환경변수에서 키를 불러왔습니다.':'API 키 설정이 필요합니다.';$('connection-status').classList.toggle('ready',s.aiConfigured);$('setup-notice').hidden=s.aiConfigured;$('setup-notice-text').textContent='실제 문서 검토는 API 키 연결 후 사용할 수 있습니다. 예시 체험으로 전체 흐름을 먼저 확인하세요.';$('converter-status').textContent=s.docConverter?`DOC 변환 준비됨 · ${s.docConverter}`:'DOC 변환에는 Microsoft Word 또는 LibreOffice가 필요합니다. DOCX는 바로 업로드할 수 있습니다.';}
    catch{$('connection-status').innerHTML='<i></i>서버 연결 필요';$('setup-notice').hidden=false;$('setup-notice-text').textContent='화면을 사용하려면 start.cmd 실행 후 http://localhost:4173에 접속하세요.';$('converter-status').textContent='서버 연결 후 DOC 변환 기능의 설치 상태를 확인할 수 있습니다.';}
  }
  $('file-input').addEventListener('change',e=>selectFile(e.target.files[0]));$('remove-file').addEventListener('click',removeFile);
  const zone=$('drop-zone');zone.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target===zone){e.preventDefault();$('file-input').click();}});
  zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('dragging');});zone.addEventListener('dragleave',()=>zone.classList.remove('dragging'));zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('dragging');if(e.dataTransfer.files.length!==1){error('한 번에 하나의 계약서를 선택해 주세요.');return;}selectFile(e.dataTransfer.files[0]);});
  $('upload-button').addEventListener('click',()=>perform(upload));$('demo-button').addEventListener('click',()=>perform(openDemo));
  $('preferences-form').addEventListener('submit',e=>{e.preventDefault();if($('preferences-form').reportValidity())perform(review);});
  $('preferences-form').addEventListener('input',preferencesChanged);$('preferences-form').addEventListener('change',preferencesChanged);
  $('recommendation-list').addEventListener('change',e=>{const group=e.target.closest('[data-recommendation]');if(group){state.choices[group.dataset.recommendation]=e.target.value;invalidateFinal();updateSelection();}});
  $('select-all').addEventListener('click',()=>chooseAll('adopt'));$('clear-selection').addEventListener('click',()=>chooseAll('defer'));
  document.querySelectorAll('[data-stage]').forEach(button=>button.addEventListener('click',()=>{const next=Number(button.dataset.stage);if(!state.busy&&next<=state.maxStep){clearError();showStep(next);}}));
  $('guide-button').addEventListener('click',()=>{const d=$('guide-dialog');if(d.showModal)d.showModal();else d.setAttribute('open','');});$('close-guide').addEventListener('click',()=>{$('guide-dialog').close?.();$('guide-dialog').removeAttribute('open');});
  $('finalize-button').addEventListener('click',()=>perform(finalize));$('back-preferences').addEventListener('click',()=>{clearError();showStep(2);});$('back-recommendations').addEventListener('click',()=>{clearError();showStep(3);});document.querySelectorAll('.restart').forEach(b=>b.addEventListener('click',reset));$('delete-case').addEventListener('click',()=>perform(deleteCase));
  $('setup-button').addEventListener('click',openSetup);$('setup-inline').addEventListener('click',openSetup);$('close-setup').addEventListener('click',()=>{$('setup-dialog').close?.();$('setup-dialog').removeAttribute('open');});$('dismiss-error').addEventListener('click',clearError);$('retry-button').addEventListener('click',()=>{const fn=state.retry;if(fn)perform(fn);});
  document.querySelectorAll('a[download]').forEach(a=>a.addEventListener('click',async e=>{
    e.preventDefault();try{const res=await fetch(a.href);if(!res.ok){const data=await res.json();throw new Error(data.error||'다운로드에 실패했습니다.');}const blob=await res.blob(),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=a.download;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}catch(e){error(e.message);}
  }));
  checkStatus();
})();
