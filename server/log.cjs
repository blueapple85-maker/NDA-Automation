const fs=require('node:fs/promises');
const path=require('node:path');
const {AsyncLocalStorage}=require('node:async_hooks');

const context=new AsyncLocalStorage();
const events=new Set(['server.started','server.stopped','request.completed','request.aborted','ai.request','ai.response','ai.error','ai.retry','ai.validation_failed']);
const numbers=new Set(['pid','port','durationMs','httpStatus','attempt','maxOutputTokens','previousMaxOutputTokens','inputTokens','cachedInputTokens','outputTokens','reasoningTokens','paragraphCount','byteCount','editCount','recommendationCount','adoptedCount','criterion']);
const booleans=new Set(['demo','cacheHit','retryable']);
const patterns={
  traceId:/^[a-f0-9-]{36}$/i,caseId:/^[a-f0-9-]{36}$/i,reviewId:/^[a-f0-9-]{36}$/i,
  requestId:/^req_[A-Za-z0-9_-]{1,112}$/,
  model:/^(?:gpt-[A-Za-z0-9_.:-]{1,100}|o[1-9][A-Za-z0-9_.:-]{0,100}|ft:[A-Za-z0-9_.:-]{1,100})$/,
  errorCode:/^[A-Z][A-Z0-9_]{0,79}$/,
  paragraphId:/^word\/(?:document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml#p[1-9]\d*$/,
};
const enums={
  stage:['request','upload','analyze','review','finalize','download','delete','demo','status'],
  method:['GET','HEAD','POST','DELETE','PUT','PATCH','OPTIONS'],
  reasoning:['none','low','medium','high','xhigh','default'],
  responseStatus:['completed','incomplete','failed','in_progress','queued','cancelled'],
  incompleteReason:['max_output_tokens','content_filter'],
  providerCode:['insufficient_quota','rate_limit_exceeded','invalid_api_key','model_not_found','context_length_exceeded','invalid_request_error'],
  retryReason:['output_limit','validation_error'],
  fileKind:['original','baseline','v1','v2'],keySource:['file','environment','none'],
};
function metadata(fields){
  const result={};
  for(const [key,value]of Object.entries(fields)){
    if(numbers.has(key)&&typeof value==='number'&&Number.isFinite(value)&&value>=0)result[key]=value;
    else if(booleans.has(key)&&typeof value==='boolean')result[key]=value;
    else if(typeof value==='string'&&!/sk[-_]/i.test(value)&&((Object.hasOwn(patterns,key)&&patterns[key].test(value))||(Object.hasOwn(enums,key)&&enums[key].includes(value))))result[key]=value;
  }
  return result;
}

function createJsonlLogger({directory=path.resolve(__dirname,'../logs'),clock=()=>new Date(),onError=()=>console.error('[NDA_LOG_WRITE_FAILED] JSONL 로그를 저장하지 못했습니다. logs 폴더의 쓰기 권한과 디스크 여유 공간을 확인해 주세요.')}={}){
  const root=path.resolve(directory);let pending=Promise.resolve(),lastErrorCode=null;
  const logger={
    log(event,fields={}){
      if(!events.has(event))return;
      const timestamp=clock().toISOString(),file=path.join(root,`nda-studio-${timestamp.slice(0,10)}.jsonl`);
      // Only explicitly permitted operational metadata can reach disk. Never
      // serialize request bodies, filenames, prompts, quotes or Error objects.
      const row={timestamp,event,...metadata(fields)};
      const line=JSON.stringify(row)+'\n';
      pending=pending.then(async()=>{
        try{await fs.mkdir(root,{recursive:true});await fs.appendFile(file,line,{encoding:'utf8',mode:0o600});lastErrorCode=null;}
        catch(error){const code=/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'LOG_WRITE_FAILED';if(lastErrorCode!==code){try{onError(code);}catch{}}lastErrorCode=code;}
      });
    },
    flush(){return pending;},
    status(){return {enabled:true,healthy:lastErrorCode===null,errorCode:lastErrorCode};}
  };
  return logger;
}
const noLogger={log(){},flush:()=>Promise.resolve(),status:()=>({enabled:false,healthy:true,errorCode:null})};
function withLogContext(logger,fields,fn){return context.run({logger,fields:metadata(fields)},fn);}
function logEvent(event,fields={}){const current=context.getStore();current?.logger.log(event,{...current.fields,...fields});}
module.exports={createJsonlLogger,noLogger,withLogContext,logEvent};
