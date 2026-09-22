const fs=require('node:fs');
const path=require('node:path');

// Resolve from the project, never from the shell's current working directory.
const DEFAULT_KEY_FILE=path.resolve(__dirname,'../../key.txt');

function configureApiKey({env=process.env,keyFile=DEFAULT_KEY_FILE}={}){
  const configuredPath=env.OPENAI_API_KEY_FILE?.trim();
  const sourcePath=configuredPath?path.resolve(__dirname,'..',configuredPath):keyFile;
  let contents;
  try{
    contents=fs.readFileSync(sourcePath,'utf8');
  }catch(error){
    if(error.code==='ENOENT'&&!configuredPath)return {source:env.OPENAI_API_KEY?'environment':'none'};
    throw new Error('API 키 파일을 읽을 수 없습니다. key.txt 또는 OPENAI_API_KEY_FILE의 경로와 읽기 권한을 확인해 주세요.');
  }
  let key=contents.replace(/^\uFEFF/,'').trim();
  if(key.startsWith('OPENAI_API_KEY='))key=key.slice('OPENAI_API_KEY='.length).trim();
  if((key.startsWith('"')&&key.endsWith('"'))||(key.startsWith("'")&&key.endsWith("'")))key=key.slice(1,-1);
  if(!key||/[^\x21-\x7e]/.test(key)){
    throw new Error('API 키 파일이 비어 있거나 형식이 올바르지 않습니다. key.txt에 API 키 하나만 한 줄로 입력해 주세요.');
  }
  // The user's file takes priority over an old .env value; do not copy it to disk.
  env.OPENAI_API_KEY=key;
  return {source:'file'};
}

module.exports={configureApiKey,DEFAULT_KEY_FILE};
