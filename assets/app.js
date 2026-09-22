(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const $$ = selector => Array.from(document.querySelectorAll(selector));
  const N = NDAReview;
  let state = N.createCase();
  let step = 1;
  let view = 'review';
  let inputMode = 'file';
  let fullPreview = false;
  let changed = false;
  let toastTimer;
  let pendingDialog;
  let importing = false;
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const statusClass = value => value === '확정' ? 'confirmed' : value === '충돌' ? 'conflict' : '';
  function toast(message, error = false) {
    clearTimeout(toastTimer);
    $('#toast').textContent = message;
    $('#toast').classList.toggle('error', error);
    $('#toast').hidden = false;
    toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 5500);
  }
  function confirmAction(title, description, action = '계속') {
    if (pendingDialog) return Promise.resolve(false);
    $('#dialog-title').textContent = title;
    $('#dialog-description').textContent = description;
    $('#dialog-confirm').textContent = action;
    $('#confirm-dialog').showModal();
    return new Promise(resolve => { pendingDialog = resolve; });
  }
  function closeDialog(answer) {
    const resolve = pendingDialog;
    pendingDialog = null;
    $('#confirm-dialog').close();
    resolve?.(answer);
  }
  $('#dialog-confirm').addEventListener('click', () => closeDialog(true));
  $('#dialog-cancel').addEventListener('click', () => closeDialog(false));
  $('#confirm-dialog').addEventListener('cancel', event => { event.preventDefault(); closeDialog(false); });
  function hasContent() { return Boolean(state.document.text || state.result || N.FIELDS.some(key => state.fields[key]) || N.CONDITIONS.some(({id}) => Object.values(state.conditions[id]).some(v => typeof v === 'string' && v))); }
  function touch() {
    changed = true;
    if (state.result) state.resultStale = true;
    renderSummary();
    $('#result-stale').hidden = !state.resultStale || !state.result;
  }
  function setView(next) {
    view = next;
    $$('.view').forEach(el => { el.hidden = el.id !== `view-${next}`; });
    $$('.navigation [data-view]').forEach(el => {
      const active = el.dataset.view === next;
      el.classList.toggle('active', active);
      if (active) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
    });
    $('#page-label').textContent = {review: '계약 검토', checklist: '검토 체크리스트', prompt: '검토 프롬프트', guide: '사용 안내'}[next];
    window.scrollTo({top: 0, behavior: 'auto'});
  }
  function validateInput() {
    $('#document-error').textContent = '';
    $('#context-error').textContent = '';
    if (!state.document.text.trim()) {
      setView('review'); setStep(1, false);
      $('#document-error').textContent = '계약 원문을 업로드하거나 붙여넣어 주세요.';
      setInputMode('text'); $('#contract-text').focus(); return false;
    }
    if (state.document.text.length > N.MAX_TEXT) {
      toast('계약 원문은 최대 500,000자까지 입력할 수 있습니다.', true); return false;
    }
    if (!state.fields.ourCompany.trim()) {
      setView('review'); setStep(1, false);
      $('#context-error').textContent = '우리 회사의 정식 법인명을 입력해 주세요.';
      $('#our-company').focus(); return false;
    }
    return true;
  }
  function setStep(next, validate = true) {
    if (next > 1 && validate && !validateInput()) return;
    step = next;
    $$('.stage').forEach(el => { el.hidden = el.id !== `stage-${step}`; });
    $$('[data-step]').forEach(el => {
      const number = Number(el.dataset.step);
      el.classList.toggle('active', number === step);
      el.classList.toggle('visited', number < step);
      if (number === step) el.setAttribute('aria-current', 'step'); else el.removeAttribute('aria-current');
    });
    if (step === 2) renderConditions();
    if (step === 3) renderRequest();
    window.scrollTo({top: 0, behavior: 'auto'});
  }
  function setInputMode(mode) {
    inputMode = mode;
    $('#mode-file').classList.toggle('selected', mode === 'file');
    $('#mode-text').classList.toggle('selected', mode === 'text');
    $('#mode-file').setAttribute('aria-pressed', String(mode === 'file'));
    $('#mode-text').setAttribute('aria-pressed', String(mode === 'text'));
    $('#upload-panel').hidden = mode !== 'file' || Boolean(state.document.text);
    $('#text-panel').hidden = mode === 'file' && !state.document.text;
    $('#document-loaded').hidden = !state.document.name;
  }
  function renderDocument() {
    $('#contract-text').value = state.document.text;
    $('#document-name').textContent = state.document.name;
    $('#document-meta').textContent = `${state.document.text.length.toLocaleString('ko-KR')}자 · ${N.paragraphs(state.document.text).length}개 추출 문단`;
    $('#text-count').textContent = `${state.document.text.length.toLocaleString('ko-KR')}자`;
    $('#extraction-note').textContent = state.document.notes || '문서는 이 브라우저에서 처리되며, 자동으로 외부에 전송되지 않습니다.';
    setInputMode(inputMode);
  }
  function renderSummary() {
    $('#summary-name').textContent = state.fields.projectName.trim() || '새로운 NDA 검토';
    $('#case-id').textContent = state.caseId;
    $('#summary-document').textContent = state.document.text.trim() ? (state.document.name || '직접 입력한 원문') : '아직 입력하지 않았어요';
    $('#summary-company').textContent = state.fields.ourCompany.trim() || '입력 대기';
    $('#summary-flow').textContent = N.FLOW[state.fields.flow] || '확인 대기';
    const confirmed = N.CONDITIONS.filter(({id}) => N.conditionState(id, state.conditions[id]) === '확정').length;
    $('#confirmed-count').textContent = confirmed;
    $('#condition-progress').style.width = `${confirmed * 25}%`;
    $('#summary-conditions').innerHTML = N.CONDITIONS.map(({id, title}) => {
      const value = N.conditionState(id, state.conditions[id]);
      return `<li class="${statusClass(value)}"><span class="condition-label">${title}</span><span class="state-label">${value}</span></li>`;
    }).join('');
  }
  function selectOptions(values, selected, blankLabel) {
    return `<option value="">${blankLabel}</option>` + values.map(([value, label]) => `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label)}</option>`).join('');
  }
  function renderCondition(id) {
    const config = N.CONDITIONS.find(c => c.id === id);
    const c = state.conditions[id];
    const index = N.CONDITIONS.findIndex(c => c.id === id) + 1;
    const found = N.candidates(state.document.text, id);
    const value = N.conditionState(id, c);
    const chosen = ['keep', 'change'].includes(c.choice);
    let dispute = '';
    if (id === 'dispute' && chosen) {
      dispute = `<div class="dispute-details"><h3>분쟁해결 세부 조건</h3><div class="field"><label for="dispute-method">방식</label><select id="dispute-method" data-condition="dispute" data-key="method">${selectOptions([['court', '소송'], ['arbitration', '중재'], ['other', '기타']], c.method, '방식 확인 필요')}</select></div>`;
      if (c.method) {
        dispute += `<p class="helper-text" style="margin:14px 0">원문 유지 시에도 아래 항목을 확인해 주세요. 특정 항목을 적용 규칙에 맡긴다면 그 선택을 명시해 주세요.</p><div class="form-grid">`;
        for (const [key, label] of N.DISPUTE_FIELDS[c.method]) dispute += `<div class="field"><label for="dispute-${key}">${label}</label><input id="dispute-${key}" data-condition="dispute" data-detail="${key}" value="${escape(c.details[key] || '')}" placeholder="확인값 입력 · 기본값 없음" maxlength="10000"></div>`;
        dispute += '</div>';
      }
      dispute += '</div>';
    }
    return `<div class="card condition-card" id="condition-${id}"><div class="card-heading"><h2><span class="condition-number">0${index}</span>${config.title}</h2><span class="condition-state ${statusClass(value)}" data-status="${id}">${value}</span></div><p class="section-description">${config.description}</p>
      <details class="candidate-list"><summary>원문 관련 문단 후보 ${found.length}개 · 키워드 검색</summary><p class="helper-text">검색 후보는 법률적 판단이 아닙니다. 조항 전체와 다른 위치의 조건도 확인해 주세요.${found.length > 6 ? ' 처음 6개만 표시하며 나머지는 계약 원문에서 확인할 수 있습니다.' : ''}</p>${found.slice(0, 6).map((p, i) => `<div class="candidate"><span class="candidate-id">${p.id}</span><pre>${escape(p.text)}</pre><button class="button outline small" data-candidate="${id}" data-index="${i}">원문 확인란에 추가</button></div>`).join('')}${!found.length ? '<p class="helper-text">관련 키워드를 찾지 못했습니다. 조항이 없다는 뜻은 아니므로 원문을 확인해 주세요.</p>' : ''}</details>
      <div class="field"><label for="${id}-original">원문 조건과 근거 위치</label><textarea id="${id}-original" data-condition="${id}" data-key="original" rows="3" maxlength="30000" placeholder="전체 관련 조항을 확인하고 원문 조건·조항 번호를 입력하세요. 충돌하는 값이 있으면 모두 기록하세요.">${escape(c.original)}</textarea></div>
      <div class="field"><label for="${id}-choice">이번 건의 선택</label><select id="${id}-choice" data-condition="${id}" data-key="choice">${selectOptions([['keep', '원문 유지'], ['change', '변경'], ['undecided', '미정 · 추후 확인'], ['conflict', '충돌 · 상충하는 조건 확인 필요']], c.choice, '아직 확인하지 않았어요')}</select></div>
      ${id === 'survival' && c.choice === 'change' ? `<div class="field"><label for="survival-mode">존속 유형</label><select id="survival-mode" data-condition="survival" data-key="survivalMode">${selectOptions(['존속 없음', '유한 기간', '조건부 계속 보호', '무기한'].map(x => [x, x]), c.survivalMode, '유형을 선택하세요')}</select></div>` : ''}
      ${c.choice && c.choice !== 'keep' ? `<div class="field"><label for="${id}-target">${c.choice === 'change' ? '이번 건에 적용할 조건·범위' : '확인이 필요한 내용'}</label><textarea id="${id}-target" data-condition="${id}" data-key="target" maxlength="30000" rows="3" placeholder="${config.hint}">${escape(c.target)}</textarea></div>` : ''}${dispute}
      ${chosen ? `<label class="confirm-check"><input type="checkbox" data-condition="${id}" data-key="confirmed" ${c.confirmed ? 'checked' : ''}><span>위 선택과 입력 내용을 이번 건의 조건으로 확인합니다.</span></label>` : ''}<p class="condition-help" data-help="${id}"></p></div>`;
  }
  function renderConditions() {
    $('#condition-cards').innerHTML = N.CONDITIONS.map(c => renderCondition(c.id)).join('');
    N.CONDITIONS.forEach(c => updateConditionStatus(c.id));
  }
  function missingInput(id, c) {
    const missing = N.pendingDetails(id, c);
    if (c.choice === 'keep' && !c.original.trim()) missing.unshift('원문 조건과 근거');
    if (c.choice === 'change' && !c.target.trim()) missing.unshift('변경할 조건·적용 범위');
    return missing;
  }
  function updateConditionStatus(id) {
    const c = state.conditions[id];
    const value = N.conditionState(id, c);
    const badge = $(`[data-status="${id}"]`);
    if (badge) { badge.textContent = value; badge.className = `condition-state ${statusClass(value)}`; }
    const help = $(`[data-help="${id}"]`);
    const checkbox = $(`[data-condition="${id}"][data-key="confirmed"]`);
    if (checkbox) checkbox.checked = c.confirmed;
    if (help) {
      const missing = missingInput(id, c);
      help.textContent = ['keep', 'change'].includes(c.choice) ? (missing.length ? `남은 확인: ${missing.join(', ')}. 미확인 상태로도 검토 요청을 만들 수 있습니다.` : c.confirmed ? `이번 건에서 확인됨 · ${new Date(c.confirmedAt).toLocaleString('ko-KR')}` : '내용을 확인한 후 체크해 주세요. 선택만으로 확정되지 않습니다.') : '원문 값이나 과거 건의 조건을 자동으로 확정하지 않습니다.';
    }
    renderSummary();
  }
  function renderRequest() {
    const count = N.CONDITIONS.filter(({id}) => N.conditionState(id, state.conditions[id]) === '확정').length;
    $('#request-confirmed').textContent = `${count} / 4`;
    $('#request-status').classList.toggle('warning', count < 4);
    $('#request-status').textContent = count < 4 ? `${4 - count}개 조건에 확인이 남아 있습니다. 미확정값은 질문과 조건부 문안으로 처리하도록 요청하며, 체결용 완성본으로 표시하지 않습니다.` : '네 가지 조건의 사용자 확인을 기록했습니다. 원문과의 충돌 및 나머지 검토 항목은 별도로 검토해야 합니다.';
    $('#request-preview').textContent = fullPreview ? N.buildFullPrompt(state, NDA_SYSTEM_PROMPT) : N.buildCasePrompt(state);
    $('#preview-case').classList.toggle('selected', !fullPreview);
    $('#preview-full').classList.toggle('selected', fullPreview);
    $('#review-result').value = state.result;
    $('#result-stale').hidden = !state.resultStale || !state.result;
    $('#download-result').disabled = !state.result.trim();
  }
  function hydrate() {
    $$('[data-field]').forEach(el => { el.value = state.fields[el.dataset.field]; });
    renderDocument(); renderSummary(); renderConditions(); renderRequest();
    $('#document-error').textContent = ''; $('#context-error').textContent = '';
  }
  function resetConditions() {
    state.conditions = N.createCase().conditions;
    if (state.result) state.resultStale = true;
  }
  async function loadDocument(file) {
    if (!file || importing) return;
    if (!NDADocument.accepts(file.name)) { toast('DOC, DOCX, UTF-8 TXT 또는 MD 파일을 선택해 주세요. PDF·HWP는 텍스트로 변환 후 붙여넣어 주세요.', true); return; }
    if (file.size > 10 * 1024 * 1024) { toast('파일은 최대 10 MB까지 불러올 수 있습니다.', true); return; }
    importing = true;
    try {
      const buffer = await file.arrayBuffer();
      if (/\.docx?$/i.test(file.name)) toast('Word 본문과 참고 자료를 읽고 있습니다.');
      const extracted = await NDADocument.read(file.name, buffer);
      if (state.document.text && !await confirmAction('계약서를 바꿀까요?', '원문과 네 가지 조건의 입력을 새로 시작합니다. 거래 배경은 유지되며, 기존 검토 결과는 재확인 필요로 표시됩니다.', '계약서 변경')) return;
      Object.assign(state.document, extracted, {name: file.name});
      resetConditions(); inputMode = 'file';
      state.fields.documentState = ''; state.fields.documentScope = ''; state.fields.documentNotes = '';
      touch(); hydrate(); setView('review'); setStep(1, false);
      toast('문서를 불러왔습니다. 추출 본문과 문서 범위를 확인해 주세요.');
    } catch (error) { toast(error.message || '문서를 읽지 못했습니다.', true); }
    finally { importing = false; $('#document-file').value = ''; }
  }
  function filename(suffix, extension) {
    const title = (state.fields.projectName || state.caseId).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_').slice(0, 65).replace(/[. ]+$/g, '') || state.caseId;
    return `${title}_${suffix}.${extension}`;
  }
  function download(text, name, mime = 'text/plain;charset=utf-8') {
    const url = URL.createObjectURL(new Blob([text], {type: mime}));
    const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  async function copy(text) {
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
      else throw new Error('Clipboard API unavailable');
      toast('클립보드에 복사했습니다.');
    } catch {
      const input = document.createElement('textarea'); input.value = text; input.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.append(input); input.select();
      let success = false;
      try { success = document.execCommand('copy'); } catch { /* Fall back to download. */ }
      input.remove();
      toast(success ? '클립보드에 복사했습니다.' : '복사 권한이 없습니다. 다운로드를 사용하거나 미리보기의 텍스트를 직접 복사해 주세요.', !success);
    }
  }
  function saveCase() {
    if (importing) { toast('문서를 읽는 중입니다. 완료 후 저장해 주세요.'); return; }
    download(JSON.stringify(state, null, 2), filename('검토건', 'json'), 'application/json;charset=utf-8');
    changed = false;
    toast('검토 건 다운로드를 요청했습니다. 원문과 조건·결과가 포함됩니다.');
  }
  async function importCase(file) {
    if (!file || importing) return;
    importing = true;
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error('검토 건 파일이 너무 큽니다. 최대 20 MB까지 지원합니다.');
      const restored = N.restoreCase(JSON.parse(await file.text()));
      if (hasContent() && !await confirmAction('저장한 검토 건을 불러올까요?', '현재 탭의 입력을 덮어씁니다. 필요한 내용은 먼저 파일로 저장해 주세요. 저장 파일의 건 ID와 확인 상태를 복원합니다.', '불러오기')) return;
      state = restored; changed = false; inputMode = 'file'; hydrate(); setView('review'); setStep(1, false);
      toast('저장한 검토 건을 불러왔습니다.');
    } catch (error) { toast(error instanceof SyntaxError ? '올바른 JSON 파일이 아닙니다.' : error.message, true); }
    finally { importing = false; $('#case-file').value = ''; }
  }
  async function replaceCase(demo) {
    if (importing) { toast('문서를 읽는 중입니다. 잠시 후 다시 시도해 주세요.'); return; }
    if (hasContent() && !await confirmAction(demo ? '가상 예시를 불러올까요?' : '새로운 검토를 시작할까요?', '현재 탭의 입력이 초기화됩니다. 필요한 내용은 먼저 파일로 저장해 주세요. 이전 건의 조건은 새 계약에 승계되지 않습니다.', demo ? '예시 불러오기' : '새 검토 시작')) return;
    state = demo ? N.demoCase() : N.createCase(); changed = demo; inputMode = 'file'; fullPreview = false;
    hydrate(); setView('review'); setStep(1, false);
    toast(demo ? '가상의 상호 NDA 예시입니다. 네 가지 조건은 모두 미확인으로 시작합니다.' : '새 검토 건을 시작했습니다.');
  }
  $$('[data-view]').forEach(el => el.addEventListener('click', () => setView(el.dataset.view)));
  $$('[data-step], [data-go-step]').forEach(el => el.addEventListener('click', () => setStep(Number(el.dataset.step || el.dataset.goStep))));
  $('#next-conditions').addEventListener('click', () => setStep(2));
  $('#next-request').addEventListener('click', () => setStep(3));
  $('#mode-file').addEventListener('click', () => setInputMode('file'));
  $('#mode-text').addEventListener('click', () => { setInputMode('text'); $('#contract-text').focus(); });
  $('#change-file').addEventListener('click', () => $('#document-file').click());
  $('#document-file').addEventListener('change', event => loadDocument(event.target.files[0]));
  $('#case-file').addEventListener('change', event => importCase(event.target.files[0]));
  $('#import-case').addEventListener('click', () => $('#case-file').click());
  $('#save-case').addEventListener('click', saveCase);
  $('#save-case-bottom').addEventListener('click', saveCase);
  $('#new-case').addEventListener('click', () => replaceCase(false));
  $('#load-demo').addEventListener('click', () => replaceCase(true));
  $('.brand').addEventListener('click', event => { event.preventDefault(); setView('review'); });
  for (const eventName of ['dragenter', 'dragover']) $('#drop-zone').addEventListener(eventName, event => { event.preventDefault(); $('#drop-zone').classList.add('dragover'); });
  for (const eventName of ['dragleave', 'drop']) $('#drop-zone').addEventListener(eventName, event => { event.preventDefault(); $('#drop-zone').classList.remove('dragover'); });
  $('#drop-zone').addEventListener('drop', event => {
    if (event.dataTransfer.files.length !== 1) { toast('계약 파일을 하나씩 불러와 주세요.', true); return; }
    loadDocument(event.dataTransfer.files[0]);
  });
  // Prevent a file dropped outside the upload area from navigating away from unsaved work.
  window.addEventListener('dragover', event => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault(); });
  window.addEventListener('drop', event => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault(); });
  $$('[data-field]').forEach(el => {
    el.maxLength = 30000;
    el.addEventListener('input', () => {
      state.fields[el.dataset.field] = el.value;
      if (el.dataset.field === 'ourCompany') { N.invalidateConditions(state); $('#context-error').textContent = ''; }
      touch();
    });
  });
  $('#contract-text').maxLength = N.MAX_TEXT;
  $('#contract-text').addEventListener('input', event => {
    state.document.text = event.target.value;
    if (!state.document.name) state.document.method = '직접 붙여넣은 텍스트';
    else state.document.method = '불러온 원문을 화면에서 편집';
    const wasConfirmed = N.CONDITIONS.some(({id}) => state.conditions[id].confirmed);
    N.invalidateConditions(state);
    if (wasConfirmed) toast('원문이 변경되었습니다. 기존 조건의 원문 근거와 선택값을 다시 확인해 주세요.');
    $('#document-error').textContent = '';
    $('#text-count').textContent = `${state.document.text.length.toLocaleString('ko-KR')}자`;
    $('#document-meta').textContent = `${state.document.text.length.toLocaleString('ko-KR')}자 · 화면에서 편집됨`;
    touch();
  });
  $('#condition-cards').addEventListener('click', event => {
    const button = event.target.closest('[data-candidate]');
    if (!button) return;
    const id = button.dataset.candidate;
    const candidate = N.candidates(state.document.text, id)[Number(button.dataset.index)];
    if (!candidate) return;
    const addition = `[${candidate.id}] ${candidate.text}`;
    const c = state.conditions[id];
    if (c.original.includes(addition)) { toast('이미 추가한 문단입니다.'); return; }
    if (c.original.length + addition.length > 30000) { toast('원문 확인란은 최대 30,000자입니다. 필요한 범위를 직접 입력해 주세요.', true); return; }
    c.original = [c.original, addition].filter(Boolean).join('\n'); c.confirmed = false; c.confirmedAt = '';
    $(`#${id}-original`).value = c.original;
    updateConditionStatus(id); touch(); toast('관련 문단을 추가했습니다. 전체 조건을 확인한 후 선택해 주세요.');
  });
  $('#condition-cards').addEventListener('input', event => {
    const element = event.target;
    const id = element.dataset.condition;
    if (!id) return;
    const c = state.conditions[id];
    const key = element.dataset.key;
    if (key === 'confirmed') {
      const missing = missingInput(id, c);
      if (element.checked && missing.length) { element.checked = false; toast(`먼저 확인해 주세요: ${missing.join(', ')}`, true); return; }
      c.confirmed = element.checked; c.confirmedAt = c.confirmed ? new Date().toISOString() : '';
    } else {
      c.confirmed = false; c.confirmedAt = '';
      if (element.dataset.detail) c.details[element.dataset.detail] = element.value;
      else c[key] = element.value;
      if (key === 'choice') { c.target = ''; c.survivalMode = ''; c.method = ''; c.details = {}; }
      if (key === 'method') c.details = {};
    }
    if (['choice', 'method', 'survivalMode'].includes(key)) $(`#condition-${id}`).outerHTML = renderCondition(id);
    updateConditionStatus(id); touch();
  });
  $('#preview-case').addEventListener('click', () => { fullPreview = false; renderRequest(); });
  $('#preview-full').addEventListener('click', () => { fullPreview = true; renderRequest(); });
  $('#copy-request').addEventListener('click', () => { if (validateInput()) copy(N.buildFullPrompt(state, NDA_SYSTEM_PROMPT)); });
  $('#download-request').addEventListener('click', () => { if (validateInput()) { download(N.buildFullPrompt(state, NDA_SYSTEM_PROMPT), filename('검토요청', 'md'), 'text/markdown;charset=utf-8'); toast('전체 프롬프트와 계약 원문을 담은 요청 파일을 다운로드합니다.'); } });
  $('#copy-system').addEventListener('click', () => copy(NDA_SYSTEM_PROMPT));
  $('#review-result').maxLength = N.MAX_TEXT;
  $('#review-result').addEventListener('input', event => {
    state.result = event.target.value; state.resultStale = false; changed = true;
    $('#result-stale').hidden = true; $('#download-result').disabled = !state.result.trim();
  });
  $('#download-result').addEventListener('click', () => {
    if (!state.result.trim()) return;
    download(`# ${state.fields.projectName || 'NDA 검토 결과'}\n\n건 ID: ${state.caseId}\n출처: 사용자가 입력한 외부 검토 결과\n${state.resultStale ? '주의: 결과 입력 후 계약 또는 조건이 변경되어 재확인 필요\n' : ''}\n---\n\n${state.result}`, filename('검토결과', 'md'), 'text/markdown;charset=utf-8');
  });
  window.addEventListener('beforeunload', event => { if (changed && hasContent()) { event.preventDefault(); event.returnValue = ''; } });
  function renderChecklist(items, target) {
    $(target).innerHTML = items.map(([id, title, text]) => `<article class="check-item"><span class="check-id">${id}</span><div><h3>${title}</h3><p>${text}</p></div></article>`).join('');
  }
  renderChecklist(N.CORE, '#core-checklist'); renderChecklist(N.EXTRA, '#extra-checklist');
  $('#system-prompt').textContent = NDA_SYSTEM_PROMPT;
  hydrate();
})();
