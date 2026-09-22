const fs=require('node:fs'),path=require('node:path');
const doc=require('../server/document.cjs'),demo=require('../server/demo.cjs');
const folder=path.join(__dirname,'../.runtime/verification');fs.mkdirSync(folder,{recursive:true});
const original=demo.document(),info=doc.inspect(original),facts=demo.facts(info.records),result=demo.review(info.records,facts,{companyId:'party-1',companyName:'Lumen',overrides:{law:'',dispute:'',term:'',survival:''},purposeText:''});
const finalEdits=[...result.edits,result.recommendations[0].edit];
function expected(edits){const paragraphs=info.records.map(r=>({id:r.id,text:r.text})),lastInserted=new Map();for(const e of edits){const index=paragraphs.findIndex(p=>p.id===(e.action==='insert_after'?(lastInserted.get(e.paragraphId)||e.paragraphId):e.paragraphId));if(e.action==='replace')paragraphs[index].text=e.replacement;else{paragraphs.splice(index+1,0,{id:e.id,text:e.replacement});lastInserted.set(e.paragraphId,e.id);}}return paragraphs.map(p=>p.text).join('\r');}
fs.writeFileSync(path.join(folder,'original.docx'),original);fs.writeFileSync(path.join(folder,'v1.docx'),doc.redline(info.baseline,result.edits));fs.writeFileSync(path.join(folder,'v2.docx'),doc.redline(info.baseline,finalEdits));
fs.writeFileSync(path.join(folder,'expected.json'),JSON.stringify({original:info.records.map(r=>r.text).join('\r'),v1:expected(result.edits),v2:expected(finalEdits)}));
console.log('Fictional Word verification fixtures prepared.');
