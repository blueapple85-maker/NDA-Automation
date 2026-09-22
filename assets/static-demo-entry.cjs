// This entry is bundled for browsers. It has no AI, network or filesystem dependency.
const doc=require('../server/document.cjs');
const demo=require('../server/demo.cjs');
const {ReviewError}=require('../server/errors.cjs');
const MIME='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const urls=new Map();
let item=null;
let sequence=0;
const id=()=>`demo-${++sequence}`;
function clear(){for(const url of urls.values())URL.revokeObjectURL(url);urls.clear();item=null;}
function file(kind,bytes){
  if(urls.has(kind))URL.revokeObjectURL(urls.get(kind));
  const url=URL.createObjectURL(new Blob([bytes],{type:MIME}));urls.set(kind,url);return url;
}
function fail(code,message,action){throw new ReviewError(code,message,{stage:'demo',action});}
function view(){return {id:item.id,name:item.name,isDemo:true,hasRevisions:false,paragraphCount:item.document.records.length,expires:null,facts:item.facts};}
function open(original=demo.document(),name='DEMO-Mutual-NDA.docx'){
  let document;
  try{document=doc.inspect(original);}catch(e){fail('DEMO_DOCUMENT_INVALID',e.message,'「체험용 NDA 받기」로 원본 DOCX를 다시 내려받아 선택해 주세요. 변경 이력·손상·암호가 있는 파일은 체험할 수 없습니다.');}
  const expected=doc.inspect(demo.document());
  // Never apply a canned review to an unrelated or changed contract.
  if(document.hasRevisions||document.records.length!==expected.records.length||document.records.some((r,i)=>r.id!==expected.records[i].id||r.text!==expected.records[i].text||!r.editable)){
    fail('DEMO_SAMPLE_ONLY','이 데모는 제공된 예시 NDA만 검토할 수 있습니다.','「체험용 NDA 받기」로 받은 원문을 선택하거나 「예시로 체험하기」를 눌러 주세요. 일반 계약의 AI 검토는 제공하지 않습니다.');
  }
  clear();item={id:id(),name,document,original,facts:demo.facts(document.records)};
  file('original',original);file('baseline',document.baseline);return view();
}
function values(data){
  const party=item.facts.parties.find(p=>p.id===data.companyId);
  if(!party)throw new Error('대리하는 회사를 선택해 주세요.');
  const overrides={};
  for(const key of ['law','dispute','term','survival']){
    if(typeof data.overrides?.[key]!=='string'||data.overrides[key].length>2000)throw new Error('대체 조건은 항목별 2,000자 이내로 입력해 주세요.');
    overrides[key]=data.overrides[key].trim();
  }
  if(typeof data.purposeText!=='string'||data.purposeText.length>3000)throw new Error('사용 목적은 3,000자 이내로 입력해 주세요.');
  return {companyId:party.id,companyName:party.name,purposeText:data.purposeText.trim(),overrides};
}
async function request(route,options={}){
  const url=new URL(route,'https://demo.invalid'),method=options.method||'GET';
  if(method==='POST'&&url.pathname==='/api/demo')return open();
  if(method==='POST'&&url.pathname==='/api/cases'){
    const name=url.searchParams.get('name')||'';
    if(!/\.docx$/i.test(name))fail('DEMO_DOCX_ONLY','정적 데모에서는 체험용 DOCX만 지원합니다.','「체험용 NDA 받기」로 내려받은 DOCX를 선택해 주세요. DOC 변환은 제공하지 않습니다.');
    const buffer=options.body instanceof Uint8Array?options.body:new Uint8Array(await options.body.arrayBuffer());
    if(!buffer.length||buffer.length>10*1024*1024)throw new Error('0바이트를 초과하고 10MB 이하인 파일을 선택해 주세요.');
    return open(buffer,name);
  }
  if(!item)fail('DEMO_RESET','체험 자료가 초기화되었습니다.','예시로 체험하기를 눌러 다시 시작해 주세요.');
  const base=`/api/cases/${item.id}`;
  if(method==='DELETE'&&url.pathname===base){clear();return {deleted:true};}
  if(method!=='POST')throw new Error('지원하지 않는 데모 요청입니다.');
  if(url.pathname===base+'/analyze')return view();
  const data=JSON.parse(options.body||'{}');
  if(url.pathname===base+'/review'){
    const input=values(data),key=JSON.stringify(input),reused=!!item.review&&item.key===key;
    if(!reused){
      const result=demo.review(item.document.records,item.facts,input);
      result.questions=['정적 데모 결과입니다. 입력한 한국어·영어 문구를 번역하거나 법률적으로 검토하지 않고 그대로 반영합니다.'];
      result.preferences.forEach(p=>{if(p.status==='applied')p.reason='체험용 계약에 입력 문구를 그대로 반영했습니다. AI 의미 해석·번역은 수행하지 않았습니다.';});
      const v1=doc.redline(item.document.baseline,result.edits);
      file('v1',v1);if(urls.has('v2')){URL.revokeObjectURL(urls.get('v2'));urls.delete('v2');}
      Object.assign(item,{review:result,v1,key,reviewId:id()});
    }
    return {...item.review,reused,reviewId:item.reviewId,userPreferences:{purpose:input.purposeText,...input.overrides},files:Object.fromEntries(['original','baseline','v1'].map(k=>[k,urls.get(k)]))};
  }
  if(url.pathname===base+'/finalize'){
    if(!item.review||data.reviewId!==item.reviewId)throw new Error('검토 기준이 변경되었습니다. 최신 결과에서 다시 선택해 주세요.');
    if(!Array.isArray(data.selected)||new Set(data.selected).size!==data.selected.length)throw new Error('채택 항목이 올바르지 않습니다.');
    const selected=data.selected.map(id=>{const rec=item.review.recommendations.find(r=>r.id===id);if(!rec)throw new Error('알 수 없는 권고사항입니다.');return rec;});
    const v2=selected.length?doc.redline(item.document.baseline,[...item.review.edits,...selected.map(r=>r.edit)]):item.v1;
    return {file:file('v2',v2),adopted:selected.map(r=>({id:r.id,title:r.title})),reviewId:item.reviewId};
  }
  throw new Error('체험 자료가 변경되었습니다. 예시로 체험하기를 눌러 다시 시작해 주세요.');
}
window.NDAStaticDemo={request:async(...args)=>structuredClone(await request(...args)),clear,sample:()=>file('sample',demo.document())};
window.addEventListener('pagehide',event=>{if(!event.persisted)clear();});
