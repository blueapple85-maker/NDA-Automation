const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom'),{createServer}=require('../server/index.cjs');
const root=path.join(__dirname,'..');
async function until(fn){for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20));}throw new Error('UI state did not arrive');}
test('four-screen UI: required selections, blank overrides, default defer, adopt, final links',async t=>{
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`,requests=[];
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:base,runScripts:'outside-only'});t.after(()=>dom.window.close());
  dom.window.scrollTo=()=>{};dom.window.fetch=(url,options)=>{requests.push({url,options});return fetch(new URL(url,base),options);};dom.window.eval(fs.readFileSync(path.join(root,'assets/studio.js'),'utf8'));
  const doc=dom.window.document,$=id=>doc.getElementById(id),change=el=>el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
  await until(()=>$('setup-notice').hidden===false);assert.ok($('upload-button').disabled);
  $('demo-button').click();await until(()=>!$('step-2').hidden);assert.equal($('demo-banner').hidden,false);assert.equal(doc.querySelectorAll('input[name=company]').length,2);assert.equal(doc.querySelector('input[name=company]:checked'),null);
  for(const key of ['law','dispute','term','survival'])assert.equal($('override-'+key).value,'');
  doc.querySelector('input[name=company]').checked=true;assert.equal(doc.querySelector('input[name=purposeAnswer]'),null);assert.equal($('purpose-text').required,false);assert.equal($('purpose-edit').hidden,false);assert.match($('purpose-assessment').textContent,/적정/);
  $('preferences-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!$('step-3').hidden);
  const sent=JSON.parse(requests.find(r=>r.url.endsWith('/review')).options.body);assert.deepEqual(sent.overrides,{law:'',dispute:'',term:'',survival:''});assert.equal(sent.companyId,'party-1');
  for(const id of ['checklist','preference-results','edit-list']){assert.equal($(id).childElementCount,0);$(id).closest('details').open=true;}
  await until(()=>doc.querySelectorAll('.check-row').length===17&&$('edit-list').childElementCount>0);
  const firstEdit=$('edit-list').firstElementChild;$('edit-list').closest('details').open=false;
  await new Promise(r=>setTimeout(r,20));$('edit-list').closest('details').open=true;
  await new Promise(r=>setTimeout(r,20));assert.equal($('edit-list').firstElementChild,firstEdit,'reopening details must reuse their DOM');
  assert.equal(sent.purposeText,'');assert.equal(doc.querySelectorAll('.other-clause').length,3);assert.match($('other-clause-list').textContent,/통지/);assert.match($('other-clause-list').textContent,/대응본/);assert.equal(doc.querySelectorAll('.preference-result').length,5);
  assert.equal(doc.querySelector('input[name=recommendation-0]:checked').value,'defer');assert.match($('selection-summary').textContent,/채택 0건/);
  const adopt=doc.querySelector('input[name=recommendation-0][value=adopt]');adopt.checked=true;change(adopt);assert.match($('selection-summary').textContent,/채택 1건/);
  $('finalize-button').click();await until(()=>!$('step-4').hidden);assert.match($('final-count').textContent,/추가 채택 1건/);assert.match($('download-v2').href,/\/files\/v2$/);assert.equal((await fetch($('download-v2').href)).status,200);assert.match($('download-original').href,/original$/);
  $('back-recommendations').click();assert.equal($('step-3').hidden,false);assert.equal(adopt.checked,true);
  const reject=doc.querySelector('input[name=recommendation-0][value=reject]');reject.checked=true;change(reject);$('finalize-button').click();await until(()=>!$('step-4').hidden);assert.match($('final-count').textContent,/추가 채택 0건/);
});
test('direct HTML opening explains server setup and never simulates analysis',async t=>{
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'file:///project/index.html',runScripts:'outside-only'});t.after(()=>dom.window.close());dom.window.scrollTo=()=>{};dom.window.eval(fs.readFileSync(path.join(root,'assets/studio.js'),'utf8'));
  await until(()=>!dom.window.document.getElementById('setup-notice').hidden);dom.window.document.getElementById('demo-button').click();await until(()=>!dom.window.document.getElementById('error').hidden);assert.match(dom.window.document.getElementById('error-text').textContent,/start.cmd/);assert.equal(dom.window.document.getElementById('step-2').hidden,true);
});
test('structured troubleshooting renders stage, clause location, reason and remedy safely',async t=>{
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'http://localhost:4173',runScripts:'outside-only'});t.after(()=>dom.window.close());dom.window.scrollTo=()=>{};
  dom.window.fetch=async url=>({ok:url==='/api/status',status:url==='/api/status'?200:422,json:async()=>url==='/api/status'?{aiConfigured:true,docConverter:null}:{error:'메모 형식 오류',diagnostic:{code:'NOTE_FORMAT',stage:'review',criterion:13,paragraphId:'word/document.xml#p12',detail:'<script>unsafe()</script>',action:'상대방 약칭을 확인하세요.',retryable:false,sourceExcerpt:'Source <script>source()</script>',generatedQuote:'Quote <img src=x onerror=unsafe()>'}}});
  dom.window.eval(fs.readFileSync(path.join(root,'assets/studio.js'),'utf8'));dom.window.document.getElementById('demo-button').click();await until(()=>!dom.window.document.getElementById('error').hidden);
  const diagnostic=dom.window.document.getElementById('error-diagnostic');assert.match(diagnostic.textContent,/검토 13번/);assert.match(diagnostic.textContent,/p12/);assert.match(diagnostic.textContent,/상대방 약칭/);assert.equal(diagnostic.querySelector('script'),null);assert.equal(dom.window.document.getElementById('retry-button').hidden,true);
  assert.match(diagnostic.querySelector('.error-evidence').textContent,/원문과 AI 인용 비교/);assert.match(diagnostic.textContent,/Source <script>/);assert.equal(diagnostic.querySelector('img'),null);
});

test('workspace navigation invalidates stale results and bulk choices regenerate the final document',async t=>{
  const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:base,runScripts:'outside-only'});t.after(()=>dom.window.close());
  dom.window.scrollTo=()=>{};dom.window.fetch=(url,options)=>fetch(new URL(url,base),options);dom.window.eval(fs.readFileSync(path.join(root,'assets/studio.js'),'utf8'));
  const doc=dom.window.document,$=id=>doc.getElementById(id),stage=n=>doc.querySelector(`[data-stage="${n}"]`);
  assert.equal(stage(3).disabled,true);$('guide-button').click();assert.ok($('guide-dialog').open);$('close-guide').click();assert.equal($('guide-dialog').open,false);
  $('demo-button').click();await until(()=>!$('step-2').hidden);doc.querySelector('input[name=company]').checked=true;
  $('preferences-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!$('step-3').hidden);
  assert.match($('review-context').textContent,/Lumen/);$('select-all').click();assert.match($('selection-summary').textContent,/채택 1건/);
  $('finalize-button').click();await until(()=>!$('step-4').hidden);assert.match($('final-count').textContent,/추가 채택 1건/);
  stage(3).click();$('clear-selection').click();assert.equal(stage(4).disabled,true);assert.match($('selection-summary').textContent,/보류 1건/);
  $('finalize-button').click();await until(()=>!$('step-4').hidden);assert.match($('final-count').textContent,/추가 채택 0건/);assert.match($('final-adopted').textContent,/반영하지 않은 권고사항/);
  stage(2).click();$('purpose-text').value='Evaluate a new partnership';$('purpose-text').dispatchEvent(new dom.window.Event('input',{bubbles:true}));
  assert.equal($('stale-notice').hidden,false);assert.equal(stage(3).disabled,true);assert.equal(stage(4).disabled,true);
  stage(1).click();stage(2).click();assert.equal($('purpose-text').value,'Evaluate a new partnership');
  $('preferences-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!$('step-3').hidden);
  assert.equal($('stale-notice').hidden,true);assert.equal(stage(3).disabled,false);assert.equal(stage(4).disabled,true);
  $('preference-results').closest('details').open=true;await until(()=>$('preference-results').childElementCount>0);assert.match($('preference-results').textContent,/Evaluate a new partnership/);
  stage(2).click();$('preferences-form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!$('step-3').hidden);
  assert.match($('review-context').textContent,/동일 조건의 이전 결과/);
  $('checklist').closest('details').open=true;await until(()=>$('checklist').childElementCount===17);
  doc.querySelector('.restart').click();assert.equal($('checklist').childElementCount,0);assert.equal($('checklist').closest('details').open,false);
});
