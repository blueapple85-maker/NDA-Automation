const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),{randomUUID}=require('node:crypto');
const {createJsonlLogger,withLogContext,logEvent}=require('../server/log.cjs');
const {createServer}=require('../server/index.cjs'),ai=require('../server/ai.cjs'),demo=require('../server/demo.cjs'),doc=require('../server/document.cjs');

async function fixture(t,options={}){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nda-log-test-'));
  const logger=createJsonlLogger({directory:root,clock:()=>new Date('2026-09-22T01:00:00.000Z'),...options});
  t.after(async()=>{await logger.flush();assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^nda-log-test-/);await fs.rm(root,{recursive:true,force:true});});
  return {root,logger,async read(){await logger.flush();const text=await fs.readFile(path.join(root,'nda-studio-2026-09-22.jsonl'),'utf8');return {text,rows:text.trim().split('\n').map(JSON.parse)};}};
}
function mockFetch(t,fn){
  const previous=global.fetch,key=process.env.OPENAI_API_KEY;
  t.after(()=>{global.fetch=previous;if(key===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=key;});
  process.env.OPENAI_API_KEY='sk-test-NEVER_WRITE_THIS_KEY';global.fetch=fn;
}
const provider=(data,id='req_test')=>new Response(JSON.stringify(data),{status:200,headers:{'x-request-id':id}});

test('JSONL appends complete ordered records and excludes non-metadata and secret values',async t=>{
  const f=await fixture(t),traceId=randomUUID();
  for(let i=0;i<80;i++)f.logger.log('ai.request',{traceId,stage:'review',attempt:i,model:'gpt-5.4-mini',reasoning:'medium',body:'PRIVATE_NDA',apiKey:'sk-test-secret',filename:'PrivateCompany.docx',quote:'PRIVATE_QUOTE',message:'PRIVATE_MESSAGE',input:{secret:'NESTED_PRIVATE'},requestId:'sk-test-secret',errorCode:'sk-test-secret'});
  const {text,rows}=await f.read();assert.equal(rows.length,80);assert.equal(text.charCodeAt(0),123);assert.ok(text.endsWith('\n'));
  assert.deepEqual(rows.map(row=>row.attempt),Array.from({length:80},(_,i)=>i));
  assert.ok(rows.every(row=>row.traceId===traceId&&row.timestamp==='2026-09-22T01:00:00.000Z'));
  assert.doesNotMatch(text,/PRIVATE|PrivateCompany|sk-test|apiKey|filename|quote|message|body/);
  const second=createJsonlLogger({directory:f.root,clock:()=>new Date('2026-09-22T02:00:00Z')});second.log('server.started',{pid:1});await second.flush();
  assert.equal((await f.read()).rows.length,81,'a restart must append, not truncate existing logs');
});

test('daily files rotate at UTC midnight without changing earlier records',async t=>{
  let now=new Date('2026-09-22T23:59:59Z');const f=await fixture(t,{clock:()=>now});
  f.logger.log('server.started',{pid:1});now=new Date('2026-09-23T00:00:00Z');f.logger.log('server.started',{pid:2});await f.logger.flush();
  assert.equal((await f.read()).rows[0].pid,1);
  const later=JSON.parse((await fs.readFile(path.join(f.root,'nda-studio-2026-09-23.jsonl'),'utf8')).trim());assert.equal(later.pid,2);
});

test('disk errors do not break requests, report unhealthy status and recover on later writes',async t=>{
  const f=await fixture(t),blocked=path.join(f.root,'blocked'),warnings=[];await fs.writeFile(blocked,'not a directory');
  const logger=createJsonlLogger({directory:blocked,onError:code=>warnings.push(code)});
  logger.log('server.started');logger.log('server.started');await logger.flush();
  assert.equal(logger.status().healthy,false);assert.equal(warnings.length,1);
  await fs.unlink(blocked);logger.log('server.started');await logger.flush();assert.equal(logger.status().healthy,true);
  assert.ok((await fs.readdir(blocked)).some(name=>name.endsWith('.jsonl')));
});

test('concurrent AI operations keep their own trace and case identifiers',async t=>{
  const f=await fixture(t),a={traceId:randomUUID(),caseId:randomUUID(),stage:'analyze'},b={traceId:randomUUID(),caseId:randomUUID(),stage:'review'};
  await Promise.all([withLogContext(f.logger,a,async()=>{await new Promise(r=>setTimeout(r,10));logEvent('ai.request',{model:'gpt-5.4-mini'});}),withLogContext(f.logger,b,async()=>{logEvent('ai.request',{model:'gpt-5.4-mini'});await new Promise(r=>setTimeout(r,15));logEvent('ai.response',{responseStatus:'completed'});})]);
  const {rows}=await f.read();assert.equal(rows.length,3);
  for(const row of rows){const expected=row.traceId===a.traceId?a:b;assert.equal(row.caseId,expected.caseId);assert.equal(row.stage,expected.stage);}
});

test('AI token retries record limits, usage and provider IDs without prompts or outputs',async t=>{
  const f=await fixture(t);let calls=0;
  mockFetch(t,async()=>provider(++calls===1?{status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[{content:[{type:'output_text',text:'PRIVATE_PARTIAL_OUTPUT'}]}],usage:{input_tokens:200,output_tokens:32000,output_tokens_details:{reasoning_tokens:20000}}}:{status:'completed',output:[{content:[{type:'output_text',text:'{"value":"PRIVATE_RESULT"}'}]}],usage:{input_tokens:200,input_tokens_details:{cached_tokens:100},output_tokens:1000,output_tokens_details:{reasoning_tokens:600}}},'req_logged_'+calls));
  const traceId=randomUUID();await withLogContext(f.logger,{traceId,stage:'review'},()=>ai.response({},'nda_review','PRIVATE_PROMPT',{text:'PRIVATE_NDA'},'gpt-5.4-mini'));
  const {text,rows}=await f.read();assert.equal(rows.length,5);assert.ok(rows.every(row=>row.traceId===traceId));
  assert.deepEqual(rows.filter(r=>r.event==='ai.request').map(r=>r.maxOutputTokens),[32000,64000]);
  const retry=rows.find(r=>r.event==='ai.retry');assert.equal(retry.retryReason,'output_limit');assert.equal(retry.requestId,'req_logged_1');
  const last=rows.at(-1);assert.equal(last.responseStatus,'completed');assert.equal(last.requestId,'req_logged_2');assert.equal(last.cachedInputTokens,100);assert.equal(last.reasoningTokens,600);assert.ok(last.durationMs>=0);
  assert.doesNotMatch(text,/PRIVATE|sk-test|Authorization/);
});

test('validation repair logs error codes without quoted contract content',async t=>{
  const f=await fixture(t),records=doc.inspect(demo.document()).records,facts=demo.facts(records),invalid=structuredClone(facts);invalid.parties[0].id='';let calls=0;
  mockFetch(t,async()=>provider({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(++calls===1?invalid:facts)}]}]},'req_validation_'+calls));
  await withLogContext(f.logger,{traceId:randomUUID(),stage:'analyze'},()=>ai.extract(records));
  const {text,rows}=await f.read(),failure=rows.find(r=>r.event==='ai.validation_failed');assert.equal(failure.errorCode,'PARTY_ID');assert.equal(failure.retryable,true);
  assert.equal(rows.find(r=>r.event==='ai.retry').retryReason,'validation_error');assert.doesNotMatch(text,/Lumen|Northstar|confidential|sk-test/);
});

test('network failures are logged as safe error codes',async t=>{
  const f=await fixture(t);mockFetch(t,async()=>{throw new TypeError('PRIVATE_ERROR sk-test-secret');});
  await assert.rejects(()=>withLogContext(f.logger,{traceId:randomUUID(),stage:'review'},()=>ai.response({},'nda_review','PRIVATE_PROMPT',{},'gpt-5.4-mini')),e=>e.code==='AI_CONNECTION');
  const {text,rows}=await f.read();assert.equal(rows.at(-1).event,'ai.error');assert.equal(rows.at(-1).errorCode,'AI_CONNECTION');assert.doesNotMatch(text,/PRIVATE|sk-test/);
});

test('API logs cache hits, failures and downloads, correlates AI work, and never serves log files',async t=>{
  const f=await fixture(t),server=createServer({logger:f.logger,ai:{extract:async records=>{logEvent('ai.request',{model:'gpt-5.4-mini',reasoning:'low'});return demo.facts(records);},review:async(records,facts,values)=>{logEvent('ai.request',{model:'gpt-5.4-mini',reasoning:'medium'});return demo.review(records,facts,values);}}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`,headers={'X-NDA-Request':'1'};
  try{
    const upload=await fetch(base+'/api/cases?name=PRIVATE_FILENAME.docx',{method:'POST',headers,body:demo.document()}),item=await upload.json();
    const post=(action,data={})=>fetch(`${base}/api/cases/${item.id}/${action}`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(data)});
    assert.equal((await post('analyze')).status,200);
    const input={companyId:'party-1',overrides:{law:'',dispute:'',term:'',survival:''},purposeText:'PRIVATE_PURPOSE',acceptExistingRevisions:false};
    const first=await post('review',input),review=await first.json(),trace=first.headers.get('x-nda-trace-id');assert.equal(first.status,200);
    assert.equal((await(await post('review',input)).json()).reused,true);
    assert.equal((await post('finalize',{reviewId:'PRIVATE_INVALID_ID',selected:[]})).status,400);
    const download=await fetch(base+review.files.v1);await download.arrayBuffer();assert.equal(download.status,200);
    const forbidden=await fetch(base+'/logs/nda-studio-2026-09-22.jsonl');assert.equal(forbidden.status,404);
    const {text,rows}=await f.read(),reviewRows=rows.filter(r=>r.event==='request.completed'&&r.stage==='review');
    assert.deepEqual(reviewRows.map(r=>r.cacheHit),[false,true]);assert.equal(reviewRows[0].traceId,trace);
    assert.ok(rows.some(r=>r.event==='ai.request'&&r.traceId===trace&&r.caseId===item.id));
    assert.ok(rows.some(r=>r.stage==='finalize'&&r.errorCode==='REQUEST_FAILED'&&r.httpStatus===400));
    assert.ok(rows.some(r=>r.stage==='download'&&r.fileKind==='v1'&&r.byteCount>0));
    assert.doesNotMatch(text,/PRIVATE|Lumen|Northstar|confidential|sk-test/);
  }finally{await new Promise(r=>server.close(r));await f.logger.flush();}
});
