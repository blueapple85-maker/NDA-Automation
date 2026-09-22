const {ReviewError}=require('./errors.cjs');

// The model selects server-issued sentence/clause IDs. Only the server slices
// the original text; it never reconstructs a quotation from generated words.
function createSourceCatalog(records){
  const references=new Map(),segmenter=new Intl.Segmenter('en',{granularity:'sentence'});
  let serial=0;
  const paragraphs=records.map(record=>{
    const boundaries=new Set([record.text.length]);
    for(const sentence of segmenter.segment(record.text))boundaries.add(sentence.index+sentence.segment.length);
    for(const separator of record.text.matchAll(/[;\r\n]+/g))boundaries.add(separator.index+separator[0].length);
    const sources=[];let start=0;
    for(const end of [...boundaries].sort((a,b)=>a-b)){
      if(!record.text.slice(start,end).trim())continue;
      const id=`s${++serial}`,span={id,paragraphId:record.id,start,end,text:record.text};
      references.set(id,span);sources.push({id,text:record.text.slice(start,end)});start=end;
    }
    // Preserve trailing whitespace as well as punctuation and Unicode exactly.
    if(sources.length&&start<record.text.length){
      const last=sources.at(-1),span=references.get(last.id);span.end=record.text.length;
      last.text=record.text.slice(span.start);
    }
    const {text,...metadata}=record;
    return {...metadata,sources};
  });
  return {paragraphs,references};
}

function hydrateSourceEvidence(value,catalog,stage){
  const issues=[];
  function visit(node,location){
    if(!node||typeof node!=='object')return node;
    if(Object.hasOwn(node,'sourceId')){
      const source=catalog.references.get(node.sourceId);
      if(!source){
        issues.push({path:location,sourceId:node.sourceId,reason:'unknown_reference'});
        return node;
      }
      return {paragraphId:source.paragraphId,quote:source.text.slice(source.start,source.end)};
    }
    if(Array.isArray(node))return node.map((child,i)=>visit(child,`${location}/${i}`));
    return Object.fromEntries(Object.entries(node).map(([key,child])=>[key,visit(child,`${location}/${key}`)]));
  }
  const result=visit(value,'');
  if(issues.length){
    const error=new ReviewError('SOURCE_REFERENCE_INVALID','AI가 선택한 근거 위치를 확인할 수 없습니다.',{
      stage,paragraphId:issues[0].paragraphId,retryable:true,
      detail:`서버가 제공하지 않은 근거 ID ${issues.length}개가 있습니다.`,
      action:'다시 시도해 주세요. 서버가 제공한 근거 ID만 선택해야 합니다. 원본 계약서를 수정할 필요는 없습니다.',
    });
    error.referenceIssues=issues;throw error;
  }
  return result;
}

const sourceEvidencePrompt='원문은 paragraphs[].sources에 문장 또는 절 단위로 제공된다. 각 sources[].id는 서버가 발급한 근거 ID다. 모든 evidence와 ndaEvidence의 항목은 {sourceId: 제공된 ID} 형식으로만 반환한다. 인용문이나 paragraphId를 evidence에 작성하지 않는다. 여러 문장이나 여러 문단에 근거가 나뉘어 있으면 evidence 배열에 각 sourceId를 별도 항목으로 선택한다. recommendations의 단일 evidence는 해당 권고를 직접 뒷받침하는 핵심 문장 하나를 선택한다. 제목만으로 실질 조항의 근거를 대신하지 않는다. ID를 새로 만들거나 범위를 합치지 않는다. 해당 판단을 직접 뒷받침하는 최소한의 문장만 선택하고 facts의 quote를 출력에 복사하지 않는다. 서버가 선택된 문장의 정확한 원문과 paragraphId를 복원한다. 전체 문단은 sources의 text를 순서대로 연결한 내용이며 edits와 notes의 paragraphId는 기존 문단 ID를 사용한다.';

module.exports={createSourceCatalog,hydrateSourceEvidence,sourceEvidencePrompt};
