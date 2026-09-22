// Explicit opt-in: sends only this repository's fictional fixture to the configured AI API.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createServer}=require('../server/index.cjs'),doc=require('../server/document.cjs');
const ai=require('../server/ai.cjs');
const {paragraphs,preferences}=require('../tests/fixtures/review-scenarios.cjs');
const replay=process.argv.includes('--replay');
if(!process.argv.includes('--run-live')&&!replay){console.log('Use --run-live for the fictional API test, or --replay to verify post-processing of previously captured fictional responses without an API call.');process.exit(0);}
if(!replay)require('../server/config.cjs').configureApiKey();
function expected(records,edits){const ps=records.map(r=>({id:r.id,text:r.text})),last=new Map();for(const e of edits){const anchor=e.action==='insert_after'?(last.get(e.paragraphId)||e.paragraphId):e.paragraphId;const i=ps.findIndex(p=>p.id===anchor);if(e.action==='replace')ps[i].text=e.replacement;else{ps.splice(i+1,0,{id:e.id,text:e.replacement});last.set(e.paragraphId,e.id);}}return ps.map(p=>p.text).join('\r');}
(async()=>{
  let scenario='initial';
  const liveReview=(...args)=>ai.review(...args,{onResult:(result,attempt)=>{const dir=path.join(__dirname,'../.runtime/live-verification',scenario);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,`model-attempt-${attempt}.json`),JSON.stringify(result,null,2));}});
  const readCaptured=file=>JSON.parse(fs.readFileSync(path.join(__dirname,'../.runtime/live-verification',file),'utf8'));
  const service=replay?{...ai,extract:()=>readCaptured('facts.json'),review:(records,facts,input)=>ai.attachOriginals(readCaptured(scenario+'/model-attempt-0.json'),records,facts,input)}:{...ai,review:liveReview};
  const server=createServer({ai:service});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`,headers={'X-NDA-Request':'1','Content-Type':'application/json'};
  async function post(url,value){const res=await fetch(base+url,{method:'POST',headers,body:JSON.stringify(value||{})});const data=await res.json();if(!res.ok){const e=new Error(data.error);e.diagnostic=data.diagnostic;throw e;}return data;}
  try{
    const original=doc.createDocx(paragraphs),records=doc.inspect(original).records;
    const upload=await fetch(base+'/api/cases?name=FICTIONAL-TEST.docx',{method:'POST',headers,body:original});assert.equal(upload.status,201);const item=await upload.json();
    console.log('Fictional contract uploaded; extracting facts.');const analyzed=await post(`/api/cases/${item.id}/analyze`);
    const factsDir=path.join(__dirname,'../.runtime/live-verification');fs.mkdirSync(factsDir,{recursive:true});fs.writeFileSync(path.join(factsDir,'facts.json'),JSON.stringify(analyzed.facts,null,2));
    assert.equal(analyzed.facts.ndaType,'unilateral');const company=analyzed.facts.parties.find(p=>p.name.includes('Harbor'));assert.ok(company);
    for(const [language,values]of Object.entries(preferences)){
      if(process.argv.includes('--korean-only')&&language!=='korean')continue;
      if(process.argv.includes('--english-only')&&language!=='english')continue;
      scenario=language;
      console.log(replay?`Replaying captured ${language} fictional response; no API call.`:`Reviewing ${language} preferences with the live API.`);
      const result=await post(`/api/cases/${item.id}/review`,{companyId:company.id,acceptExistingRevisions:false,...values});
      const folder=path.join(__dirname,'../.runtime/live-verification',language);fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,'review.json'),JSON.stringify(result,null,2));
      assert.equal(result.checklist.length,17);assert.deepEqual(result.edits.filter(e=>e.note).map(e=>e.criteria[0]).sort((a,b)=>a-b),[13,14]);
      for(const number of [3,6,7,10,11,12])assert.ok(result.edits.some(e=>e.criteria.includes(number)),`criterion ${number} was not addressed`);
      for(const number of [11,12,13])assert.ok(result.otherClauses.some(c=>c.evidence.some(e=>e.paragraphId===records[number+1].id)),`miscellaneous clause ${number} missing`);
      assert.ok(result.preferences.every(p=>['applied','already_satisfied'].includes(p.status)));
      const modifiedPurpose=result.edits.find(e=>e.criteria.includes(4)&&!e.note);assert.ok(modifiedPurpose);assert.ok(!/[가-힣]/.test(modifiedPurpose.replacement),'Korean instructions leaked into the English contractual text');
      const selected=result.recommendations.filter(r=>r.evidence.paragraphId===records[11].id).slice(0,1);assert.equal(selected.length,1,'non-competition recommendation missing');
      const final=await post(`/api/cases/${item.id}/finalize`,{reviewId:result.reviewId,selected:selected.map(r=>r.id)});
      fs.writeFileSync(path.join(folder,'original.docx'),original);fs.writeFileSync(path.join(folder,'v1.docx'),Buffer.from(await(await fetch(base+result.files.v1)).arrayBuffer()));fs.writeFileSync(path.join(folder,'v2.docx'),Buffer.from(await(await fetch(base+final.file)).arrayBuffer()));
      fs.writeFileSync(path.join(folder,'expected.json'),JSON.stringify({original:records.map(r=>r.text).join('\r'),v1:expected(records,result.edits),v2:expected(records,[...result.edits,...selected.map(r=>r.edit)])}));
      console.log(JSON.stringify({language,checklist:result.checklist.length,edits:result.edits.length,notes:result.edits.filter(e=>e.note).length,otherClauses:result.otherClauses.length,adopted:final.adopted.length,questions:result.questions.length}));
    }
  }catch(e){console.log(JSON.stringify({verificationFailed:true,message:e.message,diagnostic:e.diagnostic||null}));process.exitCode=1;}
  finally{await new Promise(r=>server.close(r));}
})();
