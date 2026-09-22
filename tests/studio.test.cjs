const test=require('node:test'),assert=require('node:assert/strict');
const {strFromU8,strToU8,zipSync}=require('fflate');
const d=require('../server/document.cjs'),demo=require('../server/demo.cjs'),ai=require('../server/ai.cjs');
const {sourceFixture}=require('./helpers/source-fixture.cjs');
function fixture(){const source=demo.document(),info=d.inspect(source),facts=demo.facts(info.records),input={companyName:'Lumen Labs Co., Ltd.',companyId:'party-1',overrides:{law:'',dispute:'',term:'',survival:''},purposeAnswer:'ok',purposeText:''};return{source,info,facts,input,result:demo.review(info.records,facts,input)};}
test('missing or duplicate generated party IDs trigger a corrective extraction retry',async t=>{
  const {info,facts}=fixture(),invalid=structuredClone(facts);invalid.parties.forEach(p=>{p.id='';});
  const originalFetch=global.fetch,originalKey=process.env.OPENAI_API_KEY;
  t.after(()=>{global.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;});
  process.env.OPENAI_API_KEY='test-only-not-a-real-key';let calls=0,correction;
  global.fetch=async(url,options)=>{
    calls++;if(calls===2)correction=JSON.parse(JSON.parse(options.body).input[1].content).correction;
    return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(sourceFixture(calls===1?invalid:facts,info.records))}]}]}),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const result=await ai.extract(info.records);assert.equal(calls,2);assert.equal(correction.issue.code,'PARTY_ID');assert.equal(result.parties[0].id,'party-1');
  const duplicate=structuredClone(facts);duplicate.parties[1].id=duplicate.parties[0].id;
  assert.throws(()=>ai.validateFacts(duplicate,info.records),error=>error.diagnostic.code==='PARTY_ID'&&error.diagnostic.retryable);
});
function resolveText(buffer,accept){
  const xml=d.parse(strFromU8(d.unpack(buffer)['word/document.xml']));
  for(const p of d.elements(xml,'p')){
    const pr=Array.from(p.childNodes).find(n=>n.localName==='pPr');
    if(!accept&&pr&&d.elements(pr,'ins').length)p.parentNode.removeChild(p);
  }
  for(const tag of [accept?'del':'ins','pPr'])for(const n of d.elements(xml,tag))n.parentNode?.removeChild(n);
  if(!accept)for(const del of d.elements(xml,'del')){const parent=del.parentNode;while(del.firstChild)parent.insertBefore(del.firstChild,del);parent.removeChild(del);}
  return d.elements(xml,'p').map(p=>d.textOf(p));
}
test('real insert/delete revisions reject to original and accept to requested text',()=>{
  const f=fixture(),out=d.redline(f.info.baseline,f.result.edits),xml=d.parse(strFromU8(d.unpack(out)['word/document.xml']));
  assert.ok(d.elements(xml,'ins').length>0);assert.ok(d.elements(xml,'del').length>0);assert.ok(d.elements(xml,'delText').length>0);
  assert.deepEqual(resolveText(out,false),f.info.records.map(r=>r.text));
  const accepted=resolveText(out,true);assert.ok(accepted.some(t=>t.includes('at least reasonable care')));assert.equal(accepted.filter(t=>t.startsWith('[Note to Northstar:')).length,2);
  assert.ok(accepted.some(t=>t.includes('five years after termination')),'criterion 17 must remain unchanged in v1');
  const revisions=[...d.elements(xml,'ins'),...d.elements(xml,'del')];assert.equal(new Set(revisions.map(n=>n.getAttributeNS(d.W,'id'))).size,revisions.length);
  assert.ok(revisions.every(n=>n.getAttributeNS(d.W,'author')&&n.getAttributeNS(d.W,'date')));
});
test('v2 is cumulative, selective and does not duplicate body notes',()=>{
  const f=fixture(),v1=d.redline(f.info.baseline,f.result.edits),v2=d.redline(f.info.baseline,[...f.result.edits,f.result.recommendations[0].edit]);
  const accepted=resolveText(v2,true);assert.ok(accepted.some(t=>t.includes('Independent Activities')));assert.ok(!accepted.some(t=>t.includes('five years after termination')));assert.equal(accepted.filter(t=>t.startsWith('[Note to ')).length,2);
  assert.deepEqual(resolveText(v2,false),f.info.records.map(r=>r.text));assert.deepEqual(resolveText(d.redline(f.info.baseline,f.result.edits),true),resolveText(v1,true));
});
test('wrong anchors, duplicate replacements and complex fields fail visibly',()=>{
  const f=fixture(),e=f.result.edits[0];assert.throws(()=>d.redline(f.info.baseline,[{...e,original:'not the text'}]),/일치/);assert.throws(()=>d.redline(f.info.baseline,[e,e]),/충돌/);
  const entries=d.unpack(d.createDocx(['This is a field.']));entries['word/document.xml']=strToU8(strFromU8(entries['word/document.xml']).replace('<w:r>','<w:fldSimple w:instr="DATE"><w:r>').replace('</w:r>','</w:r></w:fldSimple>'));
  const info=d.inspect(Buffer.from(zipSync(entries)));assert.equal(info.records[0].editable,false);assert.throws(()=>d.redline(info.baseline,[{paragraphId:info.records[0].id,original:info.records[0].text,replacement:'Changed',action:'replace'}]),/복잡/);
});
test('unmodified package parts and run formatting survive',()=>{
  const f=fixture(),entries=d.unpack(f.source);const styles='<w:styles xmlns:w="'+d.W+'"><w:style w:type="paragraph" w:styleId="KeepMe"/></w:styles>';
  entries['word/styles.xml']=strToU8(styles);entries['word/document.xml']=strToU8(strFromU8(entries['word/document.xml']).replace('<w:r><w:t','<w:r><w:rPr><w:b/></w:rPr><w:t'));
  const info=d.inspect(Buffer.from(zipSync(entries))),out=d.unpack(d.redline(info.baseline,f.result.edits));assert.equal(strFromU8(out['word/styles.xml']),styles);assert.match(strFromU8(out['word/document.xml']),/<w:b\/>/);
});
test('existing inline revisions are flagged and original preserved',()=>{
  const entries=d.unpack(d.createDocx(['New wording']));entries['word/document.xml']=strToU8(strFromU8(entries['word/document.xml']).replace('<w:r>','<w:ins w:id="1" w:author="Existing reviewer"><w:r>').replace('</w:r>','</w:r></w:ins>'));
  const original=Buffer.from(zipSync(entries)),info=d.inspect(original);assert.equal(info.hasRevisions,true);assert.deepEqual(info.original,original);assert.ok(!strFromU8(d.unpack(info.baseline)['word/document.xml']).includes('<w:ins'));
});
test('all 17 criteria validated and blank preferences protect existing conditions',()=>{
  const f=fixture();assert.doesNotThrow(()=>ai.validateEdits(f.result,f.info.records,f.facts,f.input));
  const changed=structuredClone(f.result);changed.edits.push({id:'bad-law',criteria:[15],paragraphId:f.info.records[12].id,original:f.info.records[12].text,replacement:'Korean law applies.',action:'replace',condition:'law',note:false,reason:'bad'});
  assert.throws(()=>ai.validateEdits(changed,f.info.records,f.facts,f.input),/빈칸/);
  const missing=structuredClone(f.result);missing.checklist.pop();assert.throws(()=>ai.validateEdits(missing,f.info.records,f.facts,f.input),/17개/);
  const auto17=structuredClone(f.result);auto17.edits[0].criteria=[17];assert.throws(()=>ai.validateEdits(auto17,f.info.records,f.facts,f.input),/혼합/);
});
test('foreign law needs tracked body note; indefinite survival prompts confirmation',()=>{
  const f=fixture(),noNote=structuredClone(f.result);noNote.edits=noNote.edits.filter(e=>!e.note);assert.throws(()=>ai.validateEdits(noNote,f.info.records,f.facts,f.input),/메모/);
  f.facts.survival.indefinite=true;ai.validateEdits(f.result,f.info.records,f.facts,f.input);assert.ok(f.result.questions.some(q=>q.includes('무기한')));
});
test('explicit overrides and a note can edit and anchor on the same paragraph',()=>{
  const f=fixture();f.input.overrides.law='Singapore law';f.input.overrides.term='one year from the last signature';const result=demo.review(f.info.records,f.facts,f.input);ai.validateEdits(result,f.info.records,f.facts,f.input);
  const text=resolveText(d.redline(f.info.baseline,result.edits),true).join('\n');assert.match(text,/Singapore law/);assert.match(text,/three years after termination/);assert.match(text,/one year from the last signature/);
});
test('false evidence and external XML entities are rejected',()=>{
  const f=fixture();f.facts.law.evidence[0].quote='invented source';assert.throws(()=>ai.validateFacts(f.facts,f.info.records),/인용/);assert.throws(()=>d.parse('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///c:/secret">]><x>&e;</x>'),/엔티티/);
});
module.exports={resolveText};
test('each neutrality condition is independent and addressee changes with represented party',()=>{
  const f=fixture();
  for(const [law,dispute,numbers]of [['','',[13,14]],['Korean law','',[14]],['','KCAB arbitration',[13]],['한국법','KCAB 중재',[]]]){
    const input={...f.input,overrides:{...f.input.overrides,law,dispute}},r=demo.review(f.info.records,f.facts,input);
    ai.validateEdits(r,f.info.records,f.facts,input);assert.deepEqual(r.edits.filter(e=>e.note).map(e=>e.criteria[0]),numbers);
  }
  const input={...f.input,companyId:'party-2',companyName:'Northstar'},r=demo.review(f.info.records,f.facts,input);ai.validateEdits(r,f.info.records,f.facts,input);assert.ok(r.edits.filter(e=>e.note).every(e=>e.replacement.startsWith('[Note to Lumen: ')));
  r.edits.find(e=>e.note).replacement='[Note to Northstar: Please confirm neutrality.]';assert.throws(()=>ai.validateEdits(r,f.info.records,f.facts,input),e=>e.code==='NOTE_FORMAT'&&e.diagnostic.criterion===13);
});
test('benign miscellaneous clauses cannot be silently omitted',()=>{
  const f=fixture();assert.deepEqual(f.result.otherClauses.map(c=>c.assessment),['attention','ok','ok']);
  f.result.otherClauses=f.result.otherClauses.filter(c=>c.id!=='other-notices');assert.throws(()=>ai.validateEdits(f.result,f.info.records,f.facts,f.input),e=>e.code==='OTHER_SUMMARY_MISSING'&&e.diagnostic.paragraphId===f.info.records[16].id);
  const g=fixture();g.result.clauseCoverage.pop();assert.throws(()=>ai.validateEdits(g.result,g.info.records,g.facts,g.input),e=>e.code==='COVERAGE_MISSING');
});
test('missing mandatory clauses require a proposed addition and purpose can be entered directly',()=>{
  const f=fixture();for(const n of [6,7,10,11,12]){const r=structuredClone(f.result);r.checklist.find(c=>c.number===n).presence='missing';r.edits=r.edits.filter(e=>!e.criteria.includes(n));assert.throws(()=>ai.validateEdits(r,f.info.records,f.facts,f.input),e=>e.code==='REQUIRED_CLAUSE_MISSING'&&e.diagnostic.criterion===n);}
  const input={...f.input,purposeText:'공동 개발 가능성 평가'};const r=demo.review(f.info.records,f.facts,input);ai.validateEdits(r,f.info.records,f.facts,input);assert.equal(r.preferences.find(p=>p.field==='purpose').status,'applied');assert.ok(r.edits.some(e=>e.criteria.includes(4)&&e.replacement.includes(input.purposeText)));
});
function wireFixture(f){
  const wire=structuredClone(f.result);
  wire.notes=wire.edits.filter(e=>e.note).map(e=>({topic:e.condition,paragraphId:e.paragraphId,sentence:e.replacement.replace(/^\[Note to [^:]+: /,'').slice(0,-1),reason:e.reason}));wire.edits=wire.edits.filter(e=>!e.note);
  wire.clauseInventory=f.info.records.map((r,i)=>{const other=f.result.otherClauses.find(o=>o.evidence.some(e=>e.paragraphId===r.id));return{...(other||{id:'inventory-'+i,clause:String(i),title:'본문',summary:r.text,impact:'',assessment:'ok',evidence:[{paragraphId:r.id,quote:r.text}]}),criteria:f.result.clauseCoverage[i].criteria};});delete wire.otherClauses;delete wire.clauseCoverage;
  for(const e of [...wire.edits,...wire.recommendations.map(r=>r.edit)]){delete e.original;delete e.note;}
  return wire;
}

test('review evidence is restored from source before coverage checks and DOCX drafting',()=>{
  const f=fixture(),wire=wireFixture(f);
  for(const item of wire.clauseInventory)for(const evidence of item.evidence)evidence.quote=evidence.quote.replace(/ /g,'\u00a0');
  wire.recommendations[0].evidence.quote=wire.recommendations[0].evidence.quote.replace(/ /g,'\t');
  const output=ai.attachOriginals(wire,f.info.records,f.facts,f.input);
  ai.validateEdits(output,f.info.records,f.facts,f.input);
  for(const item of output.otherClauses)for(const evidence of item.evidence)assert.ok(f.info.records.find(p=>p.id===evidence.paragraphId).text.includes(evidence.quote));
  assert.ok(d.redline(f.info.baseline,output.edits).length>0);
});

test('omitting duplicate inventory prose keeps all 17 checks, evidence and miscellaneous summaries',()=>{
  const f=fixture(),wire=wireFixture(f),before=Buffer.byteLength(JSON.stringify(wire));
  for(const clause of wire.clauseInventory)if(!clause.criteria.includes(17)){clause.title='';clause.summary='';clause.impact='';}
  assert.ok(Buffer.byteLength(JSON.stringify(wire))<before);
  const result=ai.attachOriginals(wire,f.info.records,f.facts,f.input);ai.validateEdits(result,f.info.records,f.facts,f.input);
  assert.equal(result.checklist.length,17);assert.equal(result.clauseCoverage.length,f.info.records.length);
  assert.deepEqual(result.otherClauses,f.result.otherClauses);assert.ok(result.edits.length);
  result.otherClauses[0].summary='';assert.throws(()=>ai.validateEdits(result,f.info.records,f.facts,f.input),e=>e.code==='OTHER_SUMMARY_MISSING');
});

test('AI review retry receives every invalid source selection and the same source catalog',async t=>{
  const f=fixture(),valid=sourceFixture(wireFixture(f),f.info.records),broken=structuredClone(valid);
  broken.clauseInventory[5].evidence[0].sourceId='missing-5';
  broken.clauseInventory[6].evidence[0].sourceId='missing-6';
  const originalFetch=global.fetch,originalKey=process.env.OPENAI_API_KEY;
  t.after(()=>{global.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;});
  process.env.OPENAI_API_KEY='test-only-not-a-real-key';let calls=0,correction;
  global.fetch=async(url,options)=>{
    calls++;if(calls===2)correction=JSON.parse(JSON.parse(options.body).input[1].content).correction;
    return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(calls===1?broken:valid)}]}]}),{status:200});
  };
  const output=await ai.review(f.info.records,f.facts,f.input);
  assert.equal(calls,2);assert.equal(correction.referenceCorrections.length,2);
  assert.equal(correction.referenceCorrections[0].path,'/clauseInventory/5/evidence/0');
  assert.equal(correction.referenceCorrections[1].path,'/clauseInventory/6/evidence/0');
  assert.equal(output.checklist.length,17);
});
test('model never needs to retype original paragraphs and only known anchors are hydrated',()=>{
  const f=fixture(),wire=wireFixture(f);
  const output=ai.attachOriginals(structuredClone(wire),f.info.records,f.facts,f.input);assert.equal(output.edits[0].original,f.info.records[4].text);ai.validateEdits(output,f.info.records,f.facts,f.input);assert.equal(output.edits.filter(e=>e.note).length,2);
  const broken=structuredClone(wire);broken.edits[0].paragraphId='word/document.xml#p999';assert.throws(()=>ai.attachOriginals(broken,f.info.records,f.facts,f.input),e=>e.code==='EDIT_ANCHOR');
});

test('identical amendments merge preference links while genuine conflicts remain errors',()=>{
  const f=fixture();f.input.overrides.term='one year';f.input.overrides.survival='two years';f.result=demo.review(f.info.records,f.facts,f.input);
  const wire=wireFixture(f),term=wire.preferences.find(p=>p.field==='term'),survival=wire.preferences.find(p=>p.field==='survival');
  const edit=wire.edits.find(e=>e.id===term.editIds[0]);assert.ok(edit);
  wire.edits.push({...edit,id:'duplicate-term',condition:'survival'});survival.editIds=['duplicate-term'];
  wire.clauseInventory=wire.clauseInventory.filter(c=>!c.evidence.some(e=>e.paragraphId===edit.paragraphId));
  const output=ai.attachOriginals(structuredClone(wire),f.info.records,f.facts,f.input);ai.validateEdits(output,f.info.records,f.facts,f.input);
  assert.equal(output.edits.filter(e=>e.action==='replace'&&e.paragraphId===edit.paragraphId).length,1);
  assert.deepEqual(output.preferences.find(p=>p.field==='survival').editIds,[edit.id]);
  assert.ok(output.clauseCoverage.some(c=>c.paragraphId===edit.paragraphId));
  wire.edits.at(-1).replacement+=' A conflicting new obligation.';
  assert.throws(()=>ai.validateEdits(ai.attachOriginals(wire,f.info.records,f.facts,f.input),f.info.records,f.facts,f.input),e=>e.code==='EDIT_COLLISION');
});

test('an insertion anchor cannot hide unreviewed source content',()=>{
  const f=fixture(),wire=wireFixture(f),anchor=f.info.records[0].id;
  wire.clauseInventory=wire.clauseInventory.filter(c=>!c.evidence.some(e=>e.paragraphId===anchor));
  wire.edits.push({id:'new-after-title',criteria:[2],action:'insert_after',paragraphId:anchor,replacement:'Affiliate means a controlled entity.',condition:'none',reason:'정의 추가'});
  assert.throws(()=>ai.validateEdits(ai.attachOriginals(wire,f.info.records,f.facts,f.input),f.info.records,f.facts,f.input),e=>e.code==='COVERAGE_MISSING'&&e.diagnostic.paragraphId===anchor);
});

test('clause identifiers survive omitted prefixes and unexpected renumbering is rejected',()=>{
  assert.equal(ai.preserveClauseNumber('7. Disputes. Singapore courts.','ICC arbitration applies.','p1'),'7. ICC arbitration applies.');
  assert.equal(ai.preserveClauseNumber('3.2 Definition. Original.','3.2 Updated definition.','p2'),'3.2 Updated definition.');
  assert.equal(ai.preserveClauseNumber('제3조(목적) 원문','대체 목적','p3'),'제3조(목적) 대체 목적');
  assert.equal(ai.preserveClauseNumber('10. Noncompetition. Original.','','p4'),'');
  assert.throws(()=>ai.preserveClauseNumber('7. Original.','8. Wrong number.','p1'),e=>e.code==='CLAUSE_NUMBER_CHANGED');
});

test('neutrality notes state a goal without claiming agreement or mislabelling courts as arbitration',()=>{
  const f=fixture(),wire=wireFixture(f);wire.notes.forEach(n=>{n.sentence='The parties agreed to the neutral Singapore courts.';});
  f.facts.language='en';let result=ai.attachOriginals(structuredClone(wire),f.info.records,f.facts,f.input);ai.validateEdits(result,f.info.records,f.facts,f.input);
  const notes=result.edits.filter(e=>e.note);assert.ok(notes.every(n=>n.replacement.includes('neutral')&&!n.replacement.includes('parties agreed')));
  assert.ok(notes.find(n=>n.condition==='dispute').replacement.includes('if arbitration is chosen'));
  f.facts.language='ko';result=ai.attachOriginals(wire,f.info.records,f.facts,f.input);assert.ok(result.edits.filter(e=>e.note).every(n=>n.replacement.includes('중립적')));
});
test('AI HTTP errors distinguish quota from authentication and never expose provider messages',async t=>{
  const originalFetch=global.fetch,originalKey=process.env.OPENAI_API_KEY;t.after(()=>{global.fetch=originalFetch;if(originalKey===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=originalKey;});process.env.OPENAI_API_KEY='test-only-not-a-real-key';
  global.fetch=async()=>new Response(JSON.stringify({error:{code:'insufficient_quota',message:'SENSITIVE_PROVIDER_BODY'}}),{status:429,headers:{'Content-Type':'application/json','x-request-id':'request-test'}});
  await assert.rejects(()=>ai.response({},'nda_review','test',{},'test'),e=>e.code==='AI_HTTP_429'&&e.message.includes('크레딧')&&!JSON.stringify(e).includes('SENSITIVE')&&e.diagnostic.requestId==='request-test');
  global.fetch=async()=>new Response(JSON.stringify({status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}),{status:200});
  await assert.rejects(()=>ai.response({},'nda_review','test',{},'test'),e=>e.code==='AI_INCOMPLETE'&&e.diagnostic.detail.includes('출력 길이'));
});

function mockResponses(t,results){
  const originalFetch=global.fetch;
  const keys=['OPENAI_API_KEY','OPENAI_MODEL','OPENAI_REVIEW_MODEL','OPENAI_REVIEW_REASONING',...['OPENAI_ANALYZE','OPENAI_REVIEW'].flatMap(p=>[p+'_MAX_OUTPUT_TOKENS',p+'_RETRY_MAX_OUTPUT_TOKENS'])];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  t.after(()=>{global.fetch=originalFetch;for(const k of keys)if(saved[k]===undefined)delete process.env[k];else process.env[k]=saved[k];});
  for(const k of keys)delete process.env[k];
  process.env.OPENAI_API_KEY='test-only-not-a-real-key';
  const requests=[];
  global.fetch=async(url,options)=>{
    assert.equal(url,'https://api.openai.com/v1/responses');
    requests.push(JSON.parse(options.body));
    assert.ok(requests.length<=results.length,'Unexpected additional API request');
    const item=results[requests.length-1];
    if(item instanceof Error)throw item;
    return new Response(JSON.stringify(item.body||item),{status:item.httpStatus||200,headers:{'Content-Type':'application/json','x-request-id':'test-request-'+requests.length}});
  };
  return requests;
}
const completed=result=>({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]});
const truncated=()=>({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[{content:[{type:'output_text',text:'{"unfinished":'}]}]});

test('truncated review retries once with more room, discards fragments and produces real revisions',async t=>{
  const f=fixture(),requests=mockResponses(t,[truncated(),completed(sourceFixture(wireFixture(f),f.info.records))]),seen=[];
  const result=await ai.review(f.info.records,f.facts,f.input,{onResult:r=>seen.push(r)});
  assert.deepEqual(requests.map(r=>r.max_output_tokens),[32000,64000]);
  assert.deepEqual(requests[1],{...requests[0],max_output_tokens:64000});
  assert.equal(requests[0].reasoning.effort,'medium');assert.equal(requests[0].store,false);
  assert.equal(requests[0].text.format.strict,true);assert.equal(seen.length,1);
  assert.deepEqual(JSON.parse(requests[0].input[1].content).preserveFields,['law','dispute','term','survival','purpose']);
  assert.equal(result.checklist.length,17);
  const xml=d.parse(strFromU8(d.unpack(d.redline(f.info.baseline,result.edits))['word/document.xml']));
  assert.ok(d.elements(xml,'ins').length);assert.ok(d.elements(xml,'del').length);
});

test('extraction also recovers from a reasoning-only token limit',async t=>{
  const f=fixture(),first=truncated();first.output=[{type:'reasoning',summary:[]}];
  const requests=mockResponses(t,[first,completed(sourceFixture(f.facts,f.info.records))]);
  const result=await ai.extract(f.info.records);
  assert.deepEqual(requests.map(r=>r.max_output_tokens),[9000,18000]);
  assert.equal(result.parties.length,f.facts.parties.length);
  assert.equal(requests[0].reasoning.effort,'low');
});

test('extraction accepts only source selections, restores exact evidence and retries a bad ID once',async t=>{
  const f=fixture(),valid=sourceFixture(f.facts,f.info.records),bad=structuredClone(valid);
  bad.purpose.evidence[0].sourceId='missing';
  const requests=mockResponses(t,[completed(bad),completed(valid)]);
  const facts=await ai.extract(f.info.records);
  const payload=JSON.parse(requests[0].input[1].content),repair=JSON.parse(requests[1].input[1].content);
  assert.deepEqual(payload.paragraphs,repair.paragraphs);
  assert.equal(repair.correction.referenceCorrections[0].path,'/purpose/evidence/0');
  assert.deepEqual(Object.keys(requests[0].text.format.schema.properties.purpose.properties.evidence.items.properties),['sourceId']);
  for(const field of ['purpose','term','survival','law','dispute'])for(const e of facts[field].evidence){
    assert.ok(f.info.records.find(p=>p.id===e.paragraphId).text.includes(e.quote));
    assert.equal(e.sourceId,undefined);
  }
  assert.ok(facts.survival.evidence[0].quote.includes('three years'));
  assert.ok(!facts.survival.evidence[0].quote.includes('two years'));
  await t.test('a second invalid selection fails without accepting generated text',async s=>{
    const repeated=mockResponses(s,[completed(bad),completed(bad)]);
    await assert.rejects(()=>ai.extract(f.info.records),e=>e.code==='SOURCE_REFERENCE_INVALID');
    assert.equal(repeated.length,2);
  });
  await t.test('legacy generated quote fields are not silently trusted',async s=>{
    const generated=structuredClone(valid);generated.purpose.evidence[0].quote='Invented source';
    mockResponses(s,[completed(generated),completed(generated)]);
    await assert.rejects(()=>ai.extract(f.info.records),e=>e.code==='RESULT_SCHEMA');
  });
});

test('repeated truncation stops without delivering partial data and reports final request and usage',async t=>{
  const f=fixture(),last=truncated();last.output=completed(wireFixture(f)).output;
  last.usage={output_tokens:64000,output_tokens_details:{reasoning_tokens:41000}};
  const requests=mockResponses(t,[truncated(),last]);let delivered=0;
  await assert.rejects(()=>ai.review(f.info.records,f.facts,f.input,{onResult:()=>delivered++}),e=>{
    assert.equal(e.code,'AI_INCOMPLETE');assert.equal(e.diagnostic.requestId,'test-request-2');
    assert.match(e.diagnostic.detail,/32000 → 64000/);assert.match(e.diagnostic.detail,/자동 재시도/);
    assert.match(e.diagnostic.detail,/추론 41000토큰/);assert.match(e.diagnostic.action,/OPENAI_REVIEW_RETRY_MAX_OUTPUT_TOKENS/);
    assert.equal(e.diagnostic.retryable,false);return true;
  });
  assert.equal(requests.length,2);assert.equal(delivered,0);
});

test('expanded budget is retained for evidence repair without allowing another expansion',async t=>{
  const f=fixture(),bad=sourceFixture(wireFixture(f),f.info.records);bad.clauseInventory[0].evidence[0].sourceId='missing';
  const requests=mockResponses(t,[truncated(),completed(bad),completed(sourceFixture(wireFixture(f),f.info.records))]);
  const result=await ai.review(f.info.records,f.facts,f.input);
  assert.deepEqual(requests.map(r=>r.max_output_tokens),[32000,64000,64000]);
  const correction=JSON.parse(requests[2].input[1].content).correction;
  assert.equal(correction.issue.code,'SOURCE_REFERENCE_INVALID');assert.equal(result.checklist.length,17);
  await t.test('repair also truncates',async s=>{
    const failing=mockResponses(s,[truncated(),completed(bad),truncated()]);
    await assert.rejects(()=>ai.review(f.info.records,f.facts,f.input),e=>e.code==='AI_INCOMPLETE');
    assert.deepEqual(failing.map(r=>r.max_output_tokens),[32000,64000,64000]);
  });
});

test('token expansion is available if the validation repair is the first request to truncate',async t=>{
  const f=fixture(),bad=sourceFixture(wireFixture(f),f.info.records);bad.clauseInventory[0].evidence[0].sourceId='missing';
  const requests=mockResponses(t,[completed(bad),truncated(),completed(sourceFixture(wireFixture(f),f.info.records))]);
  await ai.review(f.info.records,f.facts,f.input);
  assert.deepEqual(requests.map(r=>r.max_output_tokens),[32000,32000,64000]);
  assert.deepEqual(requests[2],{...requests[1],max_output_tokens:64000});
});

test('successful responses, HTTP errors, refusals, filters and timeouts never trigger token retries',async t=>{
  const scenarios=[
    {result:completed({ok:true})},
    {result:{body:{error:{code:'invalid_api_key',message:'SENSITIVE'}},httpStatus:401},code:'AI_HTTP_401'},
    {result:{body:{error:{code:'insufficient_quota',message:'SENSITIVE'}},httpStatus:429},code:'AI_HTTP_429'},
    {result:{...truncated(),output:[{content:[{type:'refusal',refusal:'SENSITIVE'}]}]},code:'AI_REFUSAL'},
    {result:{status:'incomplete',incomplete_details:{reason:'content_filter'}},code:'AI_INCOMPLETE'},
    {result:{status:'failed',incomplete_details:{reason:'max_output_tokens'}},code:'AI_INCOMPLETE'},
    {result:new DOMException('Timeout','TimeoutError'),code:'AI_TIMEOUT'},
    {result:new TypeError('SENSITIVE_NETWORK'),code:'AI_CONNECTION'}
  ];
  for(const scenario of scenarios)await t.test(scenario.code||'completed',async s=>{
    const requests=mockResponses(s,[scenario.result]);
    if(scenario.code)await assert.rejects(()=>ai.response({},'nda_review','test',{},'gpt-5.4-mini'),e=>e.code===scenario.code&&!JSON.stringify(e).includes('SENSITIVE'));
    else assert.deepEqual(await ai.response({},'nda_review','test',{},'gpt-5.4-mini'),{ok:true});
    assert.equal(requests.length,1);
  });
});

test('output budgets honor configuration and an equal retry cap disables extra requests',async t=>{
  assert.deepEqual(ai.outputBudget('review',{}),{initialTokens:32000,maxTokens:32000,retryMaxTokens:64000,prefix:'OPENAI_REVIEW'});
  const raised=ai.outputBudget('review',{OPENAI_REVIEW_MAX_OUTPUT_TOKENS:'96000'});assert.equal(raised.retryMaxTokens,128000);
  const requests=mockResponses(t,[truncated(),completed({ok:true})]);
  process.env.OPENAI_REVIEW_MAX_OUTPUT_TOKENS='40000';process.env.OPENAI_REVIEW_RETRY_MAX_OUTPUT_TOKENS='80000';
  assert.deepEqual(await ai.response({},'nda_review','test',{},'test'),{ok:true});
  assert.deepEqual(requests.map(r=>r.max_output_tokens),[40000,80000]);
  await t.test('equal caps',async s=>{
    const capped=mockResponses(s,[truncated()]);
    process.env.OPENAI_REVIEW_MAX_OUTPUT_TOKENS='12000';process.env.OPENAI_REVIEW_RETRY_MAX_OUTPUT_TOKENS='12000';
    await assert.rejects(()=>ai.response({},'nda_review','test',{},'test'),e=>e.code==='AI_INCOMPLETE'&&!e.diagnostic.detail.includes('자동 재시도'));
    assert.equal(capped.length,1);
  });
});

test('invalid token budgets fail before contacting the API',async t=>{
  const requests=mockResponses(t,[]);
  for(const value of ['0','-1','1.5','NaN','Infinity','128001','secret-not-a-number']){
    process.env.OPENAI_REVIEW_MAX_OUTPUT_TOKENS=value;
    await assert.rejects(()=>ai.response({},'nda_review','test',{},'test'),e=>e.code==='AI_OUTPUT_CONFIG'&&e.status===503&&!JSON.stringify(e).includes('secret-not-a-number'));
  }
  process.env.OPENAI_REVIEW_MAX_OUTPUT_TOKENS='32000';process.env.OPENAI_REVIEW_RETRY_MAX_OUTPUT_TOKENS='31000';
  await assert.rejects(()=>ai.response({},'nda_review','test',{},'test'),e=>e.code==='AI_OUTPUT_CONFIG');
  assert.equal(requests.length,0);
});
