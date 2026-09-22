const fs=require('node:fs/promises');
const path=require('node:path');
const {createHash}=require('node:crypto');
const {gzipSync}=require('node:zlib');

function acceptsGzip(header=''){
  const entries=header.toLowerCase().split(',').map(value=>value.trim().split(';').map(s=>s.trim()));
  const entry=entries.find(parts=>parts[0]==='gzip')||entries.find(parts=>parts[0]==='*');
  if(!entry)return false;
  const quality=entry.slice(1).find(s=>s.startsWith('q='));
  return quality===undefined||Number(quality.slice(2))>0;
}

// Only the caller's explicit public-file allowlist can reach this handler.
// Cache the encodings in memory; revalidate the file and browser ETag each time.
function createStaticHandler(root){
  const cache=new Map();
  return async(req,res,file)=>{
    const filename=path.join(root,file),stat=await fs.stat(filename);
    const stamp=`${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
    let entry=cache.get(file);
    if(!entry||entry.stamp!==stamp){
      const data=await fs.readFile(filename);
      entry={stamp,data,gzip:gzipSync(data),etag:`W/"${createHash('sha256').update(data).digest('base64url')}"`};
      cache.set(file,entry);
    }
    const compressed=acceptsGzip(req.headers['accept-encoding']),data=compressed?entry.gzip:entry.data;
    const headers={
      'Content-Type':file.endsWith('.css')?'text/css; charset=utf-8':file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8',
      'Cache-Control':'no-cache','Vary':'Accept-Encoding','ETag':entry.etag,
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
      ...(compressed?{'Content-Encoding':'gzip'}:{})
    };
    const tags=(req.headers['if-none-match']||'').split(',').map(s=>s.trim().replace(/^W\//,''));
    if(tags.includes('*')||tags.includes(entry.etag.replace(/^W\//,''))){res.writeHead(304,headers);res.end();return;}
    res.writeHead(200,{...headers,'Content-Length':data.length});res.end(req.method==='HEAD'?undefined:data);
  };
}
module.exports={createStaticHandler};
