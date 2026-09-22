const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../server/index.cjs'),demo=require('../server/demo.cjs');
const headers={'X-NDA-Request':'1','Content-Type':'application/json'};
async function start(t,options){const server=createServer(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));return `http://127.0.0.1:${server.address().port}`;}
const input={companyId:'party-1',overrides:{law:'',dispute:'',term:'',survival:''},purposeAnswer:'ok',purposeText:'',acceptExistingRevisions:false};
test('full demo API workflow produces DOCX, preserves original, and deletes the case',async t=>{
  const base=await start(t),call=(url,body)=>fetch(base+url,{method:'POST',headers,body:JSON.stringify(body||{})});
  let res=await call('/api/demo');assert.equal(res.status,201);const item=await res.json();assert.equal(item.isDemo,true);
  res=await call(`/api/cases/${item.id}/review`,input);assert.equal(res.status,200);const result=await res.json();assert.equal(result.checklist.length,17);
  const original=Buffer.from(await(await fetch(base+result.files.original)).arrayBuffer());assert.deepEqual(original,demo.document());
  res=await call(`/api/cases/${item.id}/finalize`,{reviewId:result.reviewId,selected:['noncompete']});assert.equal(res.status,200);const final=await res.json();assert.equal(final.adopted.length,1);
  const download=await fetch(base+final.file);assert.match(download.headers.get('content-type'),/wordprocessingml/);assert.match(download.headers.get('content-disposition'),/v2/);assert.ok((await download.arrayBuffer()).byteLength>1000);
  assert.equal((await call(`/api/cases/${item.id}/finalize`,{reviewId:result.reviewId,selected:['nonexistent']})).status,400);
  assert.equal((await call(`/api/cases/${item.id}/finalize`,{reviewId:'stale',selected:[]})).status,400);
  assert.equal((await fetch(`${base}/api/cases/${item.id}`,{method:'DELETE',headers})).status,200);
  assert.equal((await fetch(base+final.file)).status,404);
});
test('upload is real and missing AI configuration never returns fabricated facts',async t=>{
  const previous=process.env.OPENAI_API_KEY;delete process.env.OPENAI_API_KEY;t.after(()=>{if(previous)process.env.OPENAI_API_KEY=previous;});
  const base=await start(t),res=await fetch(base+'/api/cases?name=test.docx',{method:'POST',headers:{'X-NDA-Request':'1'},body:demo.document()});assert.equal(res.status,201);const item=await res.json();assert.equal(item.facts,null);assert.equal(item.isDemo,false);
  const analysis=await fetch(`${base}/api/cases/${item.id}/analyze`,{method:'POST',headers,body:'{}'});assert.equal(analysis.status,503);assert.match((await analysis.json()).error,/API 키/);
});
test('real upload path can use a test-only injected AI service',async t=>{
  const base=await start(t,{ai:{extract:async records=>demo.facts(records),review:async(records,facts,values)=>demo.review(records,facts,values)}});
  const item=await(await fetch(base+'/api/cases?name=contract.docx',{method:'POST',headers,body:demo.document()})).json();
  const facts=await(await fetch(`${base}/api/cases/${item.id}/analyze`,{method:'POST',headers,body:'{}'})).json();assert.equal(facts.facts.parties.length,2);assert.equal(facts.isDemo,false);
  const result=await fetch(`${base}/api/cases/${item.id}/review`,{method:'POST',headers,body:JSON.stringify(input)});assert.equal(result.status,200);
});
test('unsafe requests, bad file formats and private server files are blocked',async t=>{
  const base=await start(t);
  assert.equal((await fetch(base+'/.env')).status,404);assert.equal((await fetch(base+'/server/index.cjs')).status,404);
  assert.equal((await fetch(base+'/key.txt')).status,404);assert.equal((await fetch(base+'/Key.txt')).status,404);
  assert.equal((await fetch(base+'/api/demo',{method:'POST'})).status,403);
  assert.equal((await fetch(base+'/api/demo',{method:'POST',headers:{...headers,Origin:'https://example.com'}})).status,403);
  const badHostStatus=await new Promise((resolve,reject)=>{const req=require('node:http').get(base+'/api/status',{headers:{Host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);});
  assert.equal(badHostStatus,403);
  assert.equal((await fetch(base+'/api/cases?name=fake.doc',{method:'POST',headers,body:demo.document()})).status,400);
  assert.equal((await fetch(base+'/api/cases?name=file.pdf',{method:'POST',headers,body:'fake'})).status,400);
  const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});

test('completed reviews are reused only for the same case, preferences, model and reasoning',async t=>{
  let reviews=0,extractions=0;
  const saved=Object.fromEntries(['OPENAI_REVIEW_MODEL','OPENAI_REVIEW_REASONING'].map(k=>[k,process.env[k]]));
  t.after(()=>{for(const [k,v]of Object.entries(saved))if(v===undefined)delete process.env[k];else process.env[k]=v;});
  process.env.OPENAI_REVIEW_MODEL='gpt-5.4-mini';process.env.OPENAI_REVIEW_REASONING='medium';
  const base=await start(t,{ai:{extract:async records=>{extractions++;return demo.facts(records);},review:async(records,facts,values)=>{reviews++;return demo.review(records,facts,values);}}});
  const call=async(url,data)=>{const res=await fetch(base+url,{method:'POST',headers,body:JSON.stringify(data||{})});assert.equal(res.status,200);return res.json();};
  const item=await(await fetch(base+'/api/cases?name=cache-test.docx',{method:'POST',headers,body:demo.document()})).json();
  await call(`/api/cases/${item.id}/analyze`);await call(`/api/cases/${item.id}/analyze`);assert.equal(extractions,1);
  const route=`/api/cases/${item.id}/review`,first=await call(route,input),firstDoc=Buffer.from(await(await fetch(base+first.files.v1)).arrayBuffer());
  assert.equal(first.reused,false);
  const same=await call(route,input);assert.equal(same.reused,true);assert.equal(same.reviewId,first.reviewId);assert.equal(reviews,1);
  assert.deepEqual(Buffer.from(await(await fetch(base+same.files.v1)).arrayBuffer()),firstDoc);
  const finalize=`/api/cases/${item.id}/finalize`;
  const final=await call(finalize,{reviewId:same.reviewId,selected:[]});
  assert.deepEqual(Buffer.from(await(await fetch(base+final.file)).arrayBuffer()),firstDoc,'no optional amendments needs no new DOCX serialization');
  await call(finalize,{reviewId:same.reviewId,selected:['noncompete']});
  const adoptedDoc=Buffer.from(await(await fetch(base+final.file)).arrayBuffer());assert.notDeepEqual(adoptedDoc,firstDoc);
  await call(finalize,{reviewId:same.reviewId,selected:['noncompete']});assert.deepEqual(Buffer.from(await(await fetch(base+final.file)).arrayBuffer()),adoptedDoc);
  await call(finalize,{reviewId:same.reviewId,selected:[]});assert.deepEqual(Buffer.from(await(await fetch(base+final.file)).arrayBuffer()),firstDoc);
  const changedInput={...input,purposeText:'Evaluate a new partnership'};
  const changed=await call(route,changedInput);assert.equal(changed.reused,false);assert.notEqual(changed.reviewId,first.reviewId);assert.equal(reviews,2);
  assert.equal((await fetch(base+final.file)).status,404,'new review invalidates the old final document');
  assert.equal((await call(route,{...changedInput,purposeText:'  Evaluate a new partnership  '})).reused,true);assert.equal(reviews,2);
  process.env.OPENAI_REVIEW_REASONING='low';assert.equal((await call(route,changedInput)).reused,false);assert.equal(reviews,3);
  process.env.OPENAI_REVIEW_MODEL='test-new-model';assert.equal((await call(route,changedInput)).reused,false);assert.equal(reviews,4);
  const other=await(await fetch(base+'/api/cases?name=other.docx',{method:'POST',headers,body:demo.document()})).json();
  await call(`/api/cases/${other.id}/analyze`);assert.equal((await call(`/api/cases/${other.id}/review`,changedInput)).reused,false);assert.equal(reviews,5);
  assert.equal((await call(route,{...changedInput,companyId:'party-2'})).reused,false);assert.equal(reviews,6);
});

test('a failed review is never cached and a retry really calls the review service',async t=>{
  let calls=0;
  const base=await start(t,{ai:{extract:async records=>demo.facts(records),review:async(records,facts,values)=>{if(++calls===1)throw new Error('Synthetic review failure');return demo.review(records,facts,values);}}});
  const item=await(await fetch(base+'/api/cases?name=retry.docx',{method:'POST',headers,body:demo.document()})).json();
  const call=action=>fetch(`${base}/api/cases/${item.id}/${action}`,{method:'POST',headers,body:JSON.stringify(input)});
  assert.equal((await call('analyze')).status,200);assert.equal((await call('review')).status,400);
  assert.equal((await fetch(`${base}/api/cases/${item.id}/files/v1`)).status,404);
  const retry=await call('review');assert.equal(retry.status,200);assert.equal((await retry.json()).reused,false);assert.equal(calls,2);
});

test('only public assets support gzip and ETag revalidation; documents and API stay no-store',async t=>{
  const base=await start(t);
  for(const url of ['/','/assets/studio.js','/assets/studio.css']){
    const plain=await fetch(base+url,{headers:{'Accept-Encoding':'gzip;q=0, *;q=1'}}),content=await plain.text();
    assert.equal(plain.status,200);assert.equal(plain.headers.get('content-encoding'),null);
    const compressed=await fetch(base+url,{headers:{'Accept-Encoding':'gzip'}});
    assert.equal(compressed.headers.get('content-encoding'),'gzip');assert.equal(await compressed.text(),content);
    assert.ok(Number(compressed.headers.get('content-length'))<Buffer.byteLength(content)*0.5);
    assert.equal(compressed.headers.get('vary'),'Accept-Encoding');assert.equal(compressed.headers.get('cache-control'),'no-cache');
    const etag=compressed.headers.get('etag');assert.ok(etag);
    const cached=await fetch(base+url,{headers:{'If-None-Match':etag}});assert.equal(cached.status,304);assert.equal(await cached.text(),'');
    const head=await fetch(base+url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  }
  const status=await fetch(base+'/api/status');assert.equal(status.headers.get('cache-control'),'no-store');assert.equal(status.headers.get('etag'),null);
  const item=await(await fetch(base+'/api/demo',{method:'POST',headers,body:'{}'})).json();
  const file=await fetch(`${base}/api/cases/${item.id}/files/original`);assert.equal(file.headers.get('cache-control'),'no-store');assert.equal(file.headers.get('etag'),null);
});

test('public asset cache invalidates when the source file changes',async t=>{
  const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),http=require('node:http');
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'nda-static-test-'));
  t.after(async()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.match(path.basename(root),/^nda-static-test-/);await fs.rm(root,{recursive:true,force:true});});
  const filename=path.join(root,'test.js');await fs.writeFile(filename,'first version');
  const serve=require('../server/static.cjs').createStaticHandler(root);
  const server=http.createServer((req,res)=>serve(req,res,'test.js').catch(()=>{res.writeHead(500);res.end();}));
  await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`,first=await fetch(base);assert.equal(await first.text(),'first version');
  await fs.writeFile(filename,'updated source version');
  const changed=await fetch(base,{headers:{'If-None-Match':first.headers.get('etag')}});assert.equal(changed.status,200);assert.equal(await changed.text(),'updated source version');assert.notEqual(changed.headers.get('etag'),first.headers.get('etag'));
});
