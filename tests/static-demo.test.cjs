const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {JSDOM}=require('jsdom');
const {build}=require('../scripts/build-static.cjs');
const doc=require('../server/document.cjs'),demo=require('../server/demo.cjs');
const root=build();
function setup(t,ui=false){
  const dom=new JSDOM(fs.readFileSync(path.join(root,'index.html'),'utf8'),{url:'https://nda-demo.example/',runScripts:'outside-only'});
  t.after(()=>dom.window.close());const w=dom.window,blobs=new Map();let seq=0,requests=0;
  Object.assign(w,{TextEncoder,TextDecoder,structuredClone,Blob,scrollTo(){},fetch(){requests++;throw new Error('Network forbidden in static demo');}});
  w.URL.createObjectURL=blob=>{const url=`blob:https://nda-demo.example/${++seq}`;blobs.set(url,blob);return url;};
  w.URL.revokeObjectURL=url=>blobs.delete(url);
  w.eval(fs.readFileSync(path.join(root,'assets/static-demo.js'),'utf8'));
  if(ui)w.eval(fs.readFileSync(path.join(root,'assets/studio.js'),'utf8'));
  return {w,api:w.NDAStaticDemo,blobs,requests:()=>requests};
}
const input={companyId:'party-1',purposeText:'',overrides:{law:'',dispute:'',term:'',survival:''}};
const post=(api,route,data={})=>api.request(route,{method:'POST',body:JSON.stringify(data)});
async function bytes(blobs,url){return Buffer.from(await blobs.get(url).arrayBuffer());}
function acceptedText(buffer){const xml=doc.parse(Buffer.from(doc.unpack(buffer)['word/document.xml']).toString());return doc.elements(xml,'p').map(p=>doc.textOf(p)).join('\n');}
async function until(fn){for(let n=0;n<100;n++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Expected UI state did not arrive');}

test('static demo generates real tracked revisions with only adopted recommendations and no network',async t=>{
  const {api,blobs,requests}=setup(t),item=await post(api,'/api/demo'),route=`/api/cases/${item.id}`;
  const first=await post(api,route+'/review',input);assert.equal(first.checklist.length,17);
  const v1=await bytes(blobs,first.files.v1),xml=Buffer.from(doc.unpack(v1)['word/document.xml']).toString();
  assert.match(xml,/<w:ins\b/);assert.match(xml,/<w:del\b/);
  assert.match(acceptedText(v1),/five years after termination/);
  const original=await bytes(blobs,first.files.original);assert.deepEqual(doc.inspect(original).records,doc.inspect(demo.document()).records);
  const unchanged=await post(api,route+'/finalize',{reviewId:first.reviewId,selected:[]});assert.deepEqual(await bytes(blobs,unchanged.file),v1);
  const adopted=await post(api,route+'/finalize',{reviewId:first.reviewId,selected:['noncompete']});
  const text=acceptedText(await bytes(blobs,adopted.file));
  assert.match(text,/13. Independent Activities/);assert.doesNotMatch(text,/five years after termination/);
  await assert.rejects(post(api,route+'/finalize',{reviewId:'old',selected:[]}),/최신/);
  await assert.rejects(post(api,route+'/finalize',{reviewId:first.reviewId,selected:['unknown']}),/알 수 없는/);
  const reused=await post(api,route+'/review',input);assert.equal(reused.reused,true);assert.equal(reused.reviewId,first.reviewId);
  await api.request(route,{method:'DELETE'});assert.equal(blobs.size,0);assert.equal(requests(),0);
});

test('Korean and English text is preserved literally; changing parties updates note recipient and invalidates downloads',async t=>{
  const {api,blobs}=setup(t),item=await post(api,'/api/demo'),route=`/api/cases/${item.id}`;
  const first=await post(api,route+'/review',input);
  const changed=await post(api,route+'/review',{...input,companyId:'party-2',purposeText:'공동 개발 검토 / Joint research <check>',overrides:{law:'Swiss law',dispute:'ICC arbitration',term:'서명일부터 1년',survival:'종료 후 2년'}});
  const text=acceptedText(await bytes(blobs,changed.files.v1));
  assert.match(text,/공동 개발 검토 \/ Joint research <check>/);assert.match(text,/Swiss law/);assert.match(text,/서명일부터 1년/);assert.match(text,/종료 후 2년/);
  assert.match(text,/Note to Lumen:/);assert.doesNotMatch(text,/Note to Northstar:/);
  assert.equal(blobs.has(first.files.v1),false);assert.notEqual(changed.reviewId,first.reviewId);
  assert.match(changed.questions.join(' '),/번역하거나 법률적으로 검토하지 않고/);
});

test('sample upload works but unrelated, edited, revised, malformed and DOC documents never receive canned facts',async t=>{
  const {api,w}=setup(t);
  const upload=data=>api.request('/api/cases?name=sample.docx',{method:'POST',body:new w.Uint8Array(data)});
  const item=await upload(demo.document());assert.equal(item.facts.parties[0].shortName,'Lumen');
  await assert.rejects(upload(doc.createDocx(['A completely different contract.'])),e=>e.diagnostic.code==='DEMO_SAMPLE_ONLY');
  const source=doc.inspect(demo.document()),records=source.records.map(r=>r.text);records[1]=records[1].replace('Lumen Labs','Unrelated Corp');
  await assert.rejects(upload(doc.createDocx(records)),e=>e.diagnostic.code==='DEMO_SAMPLE_ONLY');
  const edits=demo.review(source.records,demo.facts(source.records),{...input,companyName:'Lumen'}).edits;
  await assert.rejects(upload(doc.redline(source.baseline,edits)),e=>e.diagnostic.code==='DEMO_DOCUMENT_INVALID');
  await assert.rejects(upload(Buffer.from('not a ZIP')));
  await assert.rejects(api.request('/api/cases?name=sample.doc',{method:'POST',body:new w.Uint8Array(demo.document())}),e=>e.diagnostic.code==='DEMO_DOCX_ONLY');
});

test('deployed page supports all four screens and reset with every fetch disabled',async t=>{
  const {w,requests,blobs}=setup(t,true),$=id=>w.document.getElementById(id);
  assert.match($('connection-status').textContent,/브라우저 데모/);assert.equal($('setup-notice').hidden,true);
  $('demo-button').click();await until(()=>!$('step-2').hidden);
  w.document.querySelector('input[name=company]').checked=true;$('purpose-text').value='한글 목적';
  $('preferences-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await until(()=>!$('step-3').hidden);
  $('checklist').closest('details').open=true;await until(()=>$('checklist').children.length===17);
  $('select-all').click();$('finalize-button').click();await until(()=>!$('step-4').hidden);
  assert.match($('final-count').textContent,/추가 채택 1건/);assert.ok(blobs.has($('download-v2').href));
  $('back-preferences').click();$('purpose-text').value='new';$('purpose-text').dispatchEvent(new w.Event('input',{bubbles:true}));assert.equal($('stale-notice').hidden,false);
  w.document.querySelector('.restart').click();assert.equal($('step-1').hidden,false);assert.equal(blobs.size,0);assert.equal(requests(),0);
});

test('static output has an explicit public allowlist, no credentials or server bundle, and no API rewrite',()=>{
  assert.deepEqual(fs.readdirSync(root).sort(),['.nda-static-build','THIRD-PARTY-LICENSES.txt','assets','index.html'].sort());
  assert.deepEqual(fs.readdirSync(path.join(root,'assets')).sort(),['static-demo.js','studio.css','studio.js']);
  const bundle=fs.readFileSync(path.join(root,'assets/static-demo.js'),'utf8');
  assert.doesNotMatch(bundle,/api\.openai\.com|OPENAI_API_KEY|node:fs|sk-proj-|createJsonlLogger/);
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(html,/data-runtime="static-demo"/);assert.doesNotMatch(html,/key\.txt|start\.cmd/);
  const config=JSON.parse(fs.readFileSync(path.join(root,'../vercel.json'),'utf8'));assert.equal(config.outputDirectory,'dist');assert.equal(config.rewrites,undefined);
  assert.match(config.headers[0].headers.find(h=>h.key==='Content-Security-Policy').value,/connect-src 'none'/);
});
