const http=require('node:http');
const fs=require('node:fs/promises');
const syncFs=require('node:fs');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {randomUUID}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const exec=promisify(execFile);
const doc=require('./document.cjs'),ai=require('./ai.cjs'),demo=require('./demo.cjs');
const {describeError}=require('./errors.cjs');
const {configureApiKey}=require('./config.cjs');
const {createStaticHandler}=require('./static.cjs');
const {createJsonlLogger,noLogger,withLogContext}=require('./log.cjs');
const ROOT=path.resolve(__dirname,'..'),TTL=2*60*60*1000;
const WORD='C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE';
async function cleanupTemporaryFiles(){
  const runtime=path.join(ROOT,'.runtime');
  const entries=await fs.readdir(runtime,{withFileTypes:true}).catch(()=>[]);
  for(const entry of entries){
    if(!entry.isDirectory()||!/^[a-f0-9]{8}-[a-f0-9-]{27}$/.test(entry.name))continue;
    const target=path.resolve(runtime,entry.name),relative=path.relative(runtime,target);
    if(relative.startsWith('..')||path.isAbsolute(relative))continue;
    const stat=await fs.stat(target);if(Date.now()-stat.mtimeMs>TTL)await fs.rm(target,{recursive:true,force:true});
  }
}
function converter(){return process.env.SOFFICE_PATH?'LibreOffice':process.platform==='win32'&&syncFs.existsSync(WORD)?'Microsoft Word':null;}
async function convert(buffer){
  const engine=converter();if(!engine){const e=new Error('DOC 변환에 Microsoft Word 또는 LibreOffice가 필요합니다. 설치 후 다시 실행하거나 DOCX로 저장해 업로드해 주세요.');e.status=422;throw e;}
  const dir=path.join(ROOT,'.runtime',randomUUID());await fs.mkdir(dir,{recursive:true});const input=path.join(dir,'source.doc'),output=path.join(dir,'source.docx');
  try{
    await fs.writeFile(input,buffer);
    if(engine==='LibreOffice')await exec(process.env.SOFFICE_PATH,['-env:UserInstallation='+pathToFileURL(path.join(dir,'profile')).href,'--headless','--convert-to','docx','--outdir',dir,input],{timeout:90000,windowsHide:true});
    else await exec('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'scripts/convert-word.ps1'),'-InputPath',input,'-OutputPath',output],{timeout:90000,windowsHide:true});
    return await fs.readFile(output);
  }catch{throw new Error('DOC 변환에 실패했습니다. 암호·손상·보호 여부를 확인하거나 Word에서 DOCX로 저장해 주세요.');}
  finally{await fs.rm(dir,{recursive:true,force:true});}
}
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
async function bytes(req,limit){let size=0,chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit){const e=new Error('업로드 용량 제한을 초과했습니다. 최대 10MB 파일을 사용해 주세요.');e.status=413;throw e;}chunks.push(chunk);}return Buffer.concat(chunks);}
async function body(req){try{return JSON.parse((await bytes(req,100000)).toString('utf8'));}catch(e){if(e.status)throw e;throw new Error('입력 형식이 올바르지 않습니다.');}}
function cleanInput(data,item){
  const party=item.facts.parties.find(p=>p.id===data.companyId);if(!party)throw new Error('대리하는 회사를 선택해 주세요.');
  if(item.document.hasRevisions&&data.acceptExistingRevisions!==true)throw new Error('기존 변경 내용을 수락한 사본을 검토 기준으로 사용하는 데 확인이 필요합니다. 원본은 보관됩니다.');
  const overrides={};for(const key of ['law','dispute','term','survival']){if(typeof data.overrides?.[key]!=='string'||data.overrides[key].length>2000)throw new Error('대체 조건은 항목별 2,000자 이내로 입력해 주세요.');overrides[key]=data.overrides[key].trim();}
  const purposeText=typeof data.purposeText==='string'?data.purposeText.trim():'';
  if(purposeText.length>3000)throw new Error('사용 목적은 3,000자 이내로 입력해 주세요. 한글·영문 모두 지원합니다.');
  return {companyId:party.id,companyName:party.name,overrides,purposeText,acceptExistingRevisions:!!data.acceptExistingRevisions};
}
function createServer(options={}){
  const cases=new Map();const services=options.ai||ai,serveStatic=createStaticHandler(ROOT),logger=options.logger||noLogger;
  const cleanup=setInterval(()=>{for(const [id,item]of cases)if(item.expires<Date.now())cases.delete(id);},60000);cleanup.unref();
  const add=async(original,name,isDemo=false)=>{
    if(cases.size>=20)throw new Error('열린 검토가 많습니다. 기존 검토를 삭제하고 다시 업로드해 주세요.');
    const extension=path.extname(name).toLowerCase();if(!['.doc','.docx'].includes(extension))throw new Error('DOC 또는 DOCX 파일을 선택해 주세요.');
    if(extension==='.doc'&&!original.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')))throw new Error('유효한 DOC 파일이 아닙니다. DOCX를 확장자만 바꾸어 업로드할 수 없습니다.');
    const normalized=extension==='.doc'?await convert(original):original;
    const document=doc.inspect(normalized),item={id:randomUUID(),name:path.basename(name).replace(/[\r\n]/g,''),original,document,isDemo,expires:Date.now()+TTL,busy:false};
    cases.set(item.id,item);return item;
  };
  const publicItem=item=>({id:item.id,name:item.name,isDemo:item.isDemo,hasRevisions:item.document.hasRevisions,paragraphCount:item.document.records.filter(r=>!r.ancillary).length,expires:new Date(item.expires).toISOString(),facts:item.facts||null});
  const server=http.createServer(async(req,res)=>{
    let stage='request',shouldLog=false,logged=false;
    const started=performance.now(),traceId=randomUUID(),record={traceId,method:req.method};
    const logRequest=event=>{if(!shouldLog||logged)return;logged=true;logger.log(event,{...record,stage,httpStatus:res.statusCode,durationMs:Math.round(performance.now()-started)});};
    res.once('finish',()=>logRequest('request.completed'));res.once('close',()=>{if(!res.writableFinished)logRequest('request.aborted');});
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    try{
      const host=req.headers.host||'';if(!/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)){json(res,403,{error:'로컬 주소에서만 사용할 수 있습니다.'});return;}
      const url=new URL(req.url,`http://${host}`),p=url.pathname;
      shouldLog=p.startsWith('/api/');if(shouldLog)res.setHeader('X-NDA-Trace-ID',traceId);
      if(p.startsWith('/api/')&&(req.headers['sec-fetch-site']==='cross-site'||req.headers.origin&&req.headers.origin!==`http://${host}`)){json(res,403,{error:'다른 사이트의 접근을 허용하지 않습니다.'});return;}
      if(!['GET','HEAD'].includes(req.method)&&req.headers['x-nda-request']!=='1'){json(res,403,{error:'요청을 확인할 수 없습니다.'});return;}
      if(req.method==='GET'&&p==='/api/status'){stage='status';json(res,200,{aiConfigured:!!process.env.OPENAI_API_KEY,aiKeySource:options.keySource||(process.env.OPENAI_API_KEY?'environment':'none'),model:process.env.OPENAI_REVIEW_MODEL||process.env.OPENAI_MODEL||'gpt-5.4-mini',docConverter:converter(),retentionHours:2,instructionVersion:'v3',logging:logger.status()});return;}
      if(req.method==='POST'&&p==='/api/cases'){
        stage='upload';
        const name=url.searchParams.get('name')||'';if(name.length>250)throw new Error('파일명이 너무 깁니다.');
        const item=await add(await bytes(req,10*1024*1024),name);Object.assign(record,{caseId:item.id,demo:false,paragraphCount:item.document.records.length,byteCount:item.original.length});json(res,201,publicItem(item));return;
      }
      if(req.method==='POST'&&p==='/api/demo'){
        stage='demo';const item=await add(demo.document(),'DEMO-Mutual-NDA.docx',true);record.caseId=item.id;record.demo=true;item.facts=demo.facts(item.document.records);json(res,201,publicItem(item));return;
      }
      const match=/^\/api\/cases\/([a-f0-9-]+)(?:\/(.*))?$/.exec(p);
      if(match){
        const item=cases.get(match[1]),action=match[2]||'';
        record.caseId=match[1];if(item)record.demo=item.isDemo;
        if(!item||item.expires<Date.now()){cases.delete(match[1]);json(res,404,{error:'검토가 만료되었거나 삭제되었습니다. 파일을 다시 업로드해 주세요.'});return;}
        if(req.method==='DELETE'&&!action){stage='delete';if(item.busy)throw new Error('진행 중인 검토가 끝난 뒤 삭제해 주세요.');cases.delete(item.id);json(res,200,{deleted:true});return;}
        if(req.method==='GET'&&action.startsWith('files/')){
          stage='download';
          const kind=action.slice(6),allowed={original:item.original,baseline:item.document.baseline,v1:item.v1,v2:item.v2};
          const buffer=Object.hasOwn(allowed,kind)?allowed[kind]:null;if(!buffer){json(res,404,{error:'해당 파일이 아직 생성되지 않았습니다.'});return;}
          record.fileKind=kind;record.byteCount=buffer.length;record.reviewId=item.reviewId;
          const filename=kind==='original'?item.name:`${path.parse(item.name).name}-${kind}.docx`;
          res.writeHead(200,{'Content-Type':kind==='original'&&/\.doc$/i.test(item.name)?'application/msword':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="NDA-${kind}${path.extname(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,'Content-Length':buffer.length,'Cache-Control':'no-store'});res.end(buffer);return;
        }
        if(req.method==='POST'&&['analyze','review','finalize'].includes(action)){
          stage=action;
          if(item.busy){json(res,409,{error:'이미 진행 중인 요청이 있습니다.'});return;}item.busy=true;
          try{
            if(action==='analyze'){
              record.cacheHit=!!item.facts;record.paragraphCount=item.document.records.length;
              if(!item.facts)item.facts=await withLogContext(logger,{traceId,caseId:item.id,stage},()=>services.extract(item.document.records));
              json(res,200,publicItem(item));return;
            }
            if(!item.facts)throw new Error('핵심정보 분석을 먼저 완료해 주세요.');
            const input=await body(req);
            if(action==='review'){
              const values=cleanInput(input,item);
              const key=ai.reviewCacheKey(values),reused=!!(item.review&&item.v1&&item.reviewKey===key);
              record.cacheHit=reused;record.paragraphCount=item.document.records.length;
              if(!reused){
                const result=item.isDemo?demo.review(item.document.records,item.facts,values):await withLogContext(logger,{traceId,caseId:item.id,stage},()=>services.review(item.document.records,item.facts,values));
                ai.validateEdits(result,item.document.records,item.facts,values);
                const v1=doc.redline(item.document.baseline,result.edits);
                item.review=result;item.input=values;item.v1=v1;item.v2=null;item.finalSelection=null;item.reviewId=randomUUID();item.reviewKey=key;
              }
              record.reviewId=item.reviewId;record.editCount=item.review.edits.length;record.recommendationCount=item.review.recommendations.length;
              json(res,200,{...item.review,reused,userPreferences:{purpose:values.purposeText,...values.overrides},reviewId:item.reviewId,files:{original:`/api/cases/${item.id}/files/original`,baseline:`/api/cases/${item.id}/files/baseline`,v1:`/api/cases/${item.id}/files/v1`}});return;
            }
            if(!item.review||input.reviewId!==item.reviewId)throw new Error('검토 결과가 변경되었습니다. 최신 검토 결과에서 다시 선택해 주세요.');
            if(!Array.isArray(input.selected)||input.selected.some(id=>typeof id!=='string')||new Set(input.selected).size!==input.selected.length)throw new Error('채택 항목이 올바르지 않습니다.');
            const selected=input.selected.map(id=>{const r=item.review.recommendations.find(r=>r.id===id);if(!r)throw new Error('알 수 없는 권고사항입니다.');return r;});
            const selection=JSON.stringify(input.selected);
            record.cacheHit=!!(item.v2&&item.finalSelection===selection)||selected.length===0;record.adoptedCount=selected.length;record.reviewId=item.reviewId;
            if(!item.v2||item.finalSelection!==selection){
              item.v2=selected.length?doc.redline(item.document.baseline,[...item.review.edits,...selected.map(r=>r.edit)]):item.v1;
              item.finalSelection=selection;
            }
            json(res,200,{file:`/api/cases/${item.id}/files/v2`,adopted:selected.map(r=>({id:r.id,title:r.title})),reviewId:item.reviewId});return;
          }finally{item.busy=false;}
        }
      }
      const staticFiles={'/':'index.html','/index.html':'index.html','/assets/studio.css':'assets/studio.css','/assets/studio.js':'assets/studio.js'};
      if(['GET','HEAD'].includes(req.method)&&Object.hasOwn(staticFiles,p)){
        await serveStatic(req,res,staticFiles[p]);return;
      }
      json(res,404,{error:'찾을 수 없는 경로입니다.'});
    }catch(e){Object.assign(record,{errorCode:e.code||'REQUEST_FAILED',requestId:e.diagnostic?.requestId,paragraphId:e.diagnostic?.paragraphId,criterion:e.diagnostic?.criterion});if(!res.headersSent)json(res,e.status||400,describeError(e,stage));else res.end();}
  });
  server.on('close',()=>{clearInterval(cleanup);logger.log('server.stopped',{pid:process.pid});});return server;
}
if(require.main===module){const keyConfig=configureApiKey(),logger=createJsonlLogger();const port=Number(process.env.PORT)||4173;createServer({keySource:keyConfig.source,logger}).listen(port,'127.0.0.1',()=>{cleanupTemporaryFiles().catch(()=>{});logger.log('server.started',{pid:process.pid,port,keySource:keyConfig.source,model:process.env.OPENAI_REVIEW_MODEL||process.env.OPENAI_MODEL||'gpt-5.4-mini',reasoning:process.env.OPENAI_REVIEW_REASONING||'medium'});console.log(`NDA Studio: http://localhost:${port}\nAI: ${process.env.OPENAI_API_KEY?'configured ('+keyConfig.source+')':'not configured; demo available'}\nJSONL logs: logs/nda-studio-YYYY-MM-DD.jsonl (UTC)`);});}
module.exports={createServer,convert,cleanInput};
