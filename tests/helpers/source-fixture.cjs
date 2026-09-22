const assert=require('node:assert/strict');
const {createSourceCatalog}=require('../../server/source-evidence.cjs');

// Convert existing semantic fixtures to simulated model selections. Quotes
// inside a sentence deliberately expand to that source sentence's boundaries.
function sourceFixture(value,records){
  const catalog=createSourceCatalog(records);
  const isEvidence=node=>node&&typeof node.paragraphId==='string'&&typeof node.quote==='string';
  function selections(node){
    const record=records.find(r=>r.id===node.paragraphId),start=record?.text.indexOf(node.quote),end=start+node.quote.length;
    assert.ok(start>=0&&node.quote.length,'Fixture evidence must occur in source');
    return [...catalog.references.values()].filter(s=>s.paragraphId===node.paragraphId&&s.end>start&&s.start<end);
  }
  function visit(node){
    if(!node||typeof node!=='object')return node;
    if(isEvidence(node))return {sourceId:selections(node).sort((a,b)=>(b.end-b.start)-(a.end-a.start))[0].id};
    if(Array.isArray(node))return node.flatMap(child=>isEvidence(child)?selections(child).map(s=>({sourceId:s.id})):[visit(child)]);
    return Object.fromEntries(Object.entries(node).map(([k,v])=>[k,visit(v)]));
  }
  return visit(value);
}
module.exports={sourceFixture};
