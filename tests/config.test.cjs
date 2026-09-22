const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {configureApiKey,DEFAULT_KEY_FILE}=require('../server/config.cjs');

function fixture(t){
  const runtime=path.resolve(__dirname,'../.runtime');fs.mkdirSync(runtime,{recursive:true});
  const dir=fs.mkdtempSync(path.join(runtime,'key-test-')),keyFile=path.join(dir,'key.txt');
  t.after(()=>{if(fs.existsSync(keyFile))fs.unlinkSync(keyFile);fs.rmdirSync(dir);});
  return keyFile;
}

test('key.txt takes precedence over an old environment key without exposing it in metadata',t=>{
  const keyFile=fixture(t),env={OPENAI_API_KEY:'old-test-key'};
  fs.writeFileSync(keyFile,'\uFEFF  test-only-file-key\r\n','utf8');
  const metadata=configureApiKey({env,keyFile});
  assert.equal(env.OPENAI_API_KEY,'test-only-file-key');assert.deepEqual(metadata,{source:'file'});
  assert.equal(DEFAULT_KEY_FILE,path.resolve(__dirname,'../../key.txt'));
});

test('explicit key files support quoted env assignment and relative project paths',t=>{
  const keyFile=fixture(t),env={OPENAI_API_KEY_FILE:path.relative(path.resolve(__dirname,'..'),keyFile)};
  fs.writeFileSync(keyFile,'OPENAI_API_KEY="test-only-assigned-key"\n','utf8');
  assert.deepEqual(configureApiKey({env}),{source:'file'});assert.equal(env.OPENAI_API_KEY,'test-only-assigned-key');
});

test('empty and multiline key files fail with sanitized diagnostics instead of using an old key',t=>{
  const keyFile=fixture(t),env={OPENAI_API_KEY:'old-test-key'};
  for(const content of ['\n','test-secret-first\ntest-secret-second']){
    fs.writeFileSync(keyFile,content,'utf8');
    assert.throws(()=>configureApiKey({env,keyFile}),error=>/key.txt/.test(error.message)&&!error.message.includes('test-secret'));
    assert.equal(env.OPENAI_API_KEY,'old-test-key');
  }
});

test('environment fallback is used only when the default file is missing',t=>{
  const keyFile=fixture(t);
  assert.deepEqual(configureApiKey({env:{},keyFile}),{source:'none'});
  assert.deepEqual(configureApiKey({env:{OPENAI_API_KEY:'fallback-test-key'},keyFile}),{source:'environment'});
  assert.throws(()=>configureApiKey({env:{OPENAI_API_KEY:'fallback-test-key',OPENAI_API_KEY_FILE:keyFile}}),/키 파일을 읽을 수 없습니다/);
});
