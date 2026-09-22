const {ReviewError}=require('./errors.cjs');

// Only presentation differences are equivalent. Keep case, digits, words,
// negation, punctuation and word boundaries significant.
const substitutions=new Map([
  ['\u2018',"'"],['\u2019',"'"],['\u201c','"'],['\u201d','"'],
  ['\u2010','-'],['\u2011','-'],
]);
function indexedText(value){
  let text='';const spans=[];
  for(let i=0;i<value.length;){
    const start=i,character=String.fromCodePoint(value.codePointAt(i));i+=character.length;
    if(character==='\u00ad'||character==='\u200b'||character==='\ufeff')continue;
    if(/\s/u.test(character)){
      if(text.endsWith(' '))spans[spans.length-1].end=i;
      else{text+=' ';spans.push({start,end:i});}
      continue;
    }
    const normalized=substitutions.get(character)||character;
    text+=normalized;for(let j=0;j<normalized.length;j++)spans.push({start,end:i});
  }
  return {text,spans};
}

function resolveQuote(source,quote){
  if(!quote.trim())return {reason:'empty'};
  if(source.includes(quote))return {quote};
  const indexed=indexedText(source),needle=indexedText(quote).text.trim();
  if(!needle)return {reason:'empty'};
  const candidates=new Set();
  let offset=indexed.text.indexOf(needle);
  while(offset!==-1){
    candidates.add(source.slice(indexed.spans[offset].start,indexed.spans[offset+needle.length-1].end));
    if(candidates.size>1)return {reason:'ambiguous'};
    offset=indexed.text.indexOf(needle,offset+1);
  }
  if(candidates.size===1)return {quote:[...candidates][0]};
  return {reason:'different_content'};
}

function issueFor(e,records){
  const source=records.find(r=>r.id===e.paragraphId);
  const match=source?resolveQuote(source.text,e.quote):{reason:'unknown_paragraph'};
  if(match.quote!==undefined){e.quote=match.quote;return null;}
  // Suggest a misplaced anchor only for an exact, sufficiently specific quote.
  // Never move an evidence or edit anchor automatically.
  const otherIds=e.quote.trim().length>=24?records.filter(r=>r.id!==e.paragraphId&&r.text.includes(e.quote)).map(r=>r.id):[];
  return {paragraphId:e.paragraphId,reason:match.reason,generatedQuote:e.quote,sourceText:source?.text||'',candidateParagraphIds:otherIds};
}

function mismatchError(issues,stage){
  const first=issues[0];
  const detail=first.reason==='unknown_paragraph'?'AI가 문서에 없는 문단 위치를 인용했습니다.':first.reason==='empty'?'AI가 원문 인용을 비워서 반환했습니다.':first.reason==='ambiguous'?'표기 차이를 보정하면 여러 원문 표현과 일치하여 하나를 확정할 수 없습니다.':first.candidateParagraphIds.length?'인용문이 지정된 문단에 없고 다른 문단에서 발견되었습니다.':'공백·줄바꿈·따옴표 차이를 보정해도 AI 인용문이 해당 원문에 존재하지 않습니다. 요약·누락 또는 다른 문구가 포함되었을 수 있습니다.';
  const error=new ReviewError('SOURCE_QUOTE_MISMATCH','원문 인용을 확인할 수 없습니다.',{
    stage,paragraphId:first.paragraphId,detail:detail+(issues.length>1?` 불일치 인용 ${issues.length}개가 발견되었습니다.`:''),
    action:'아래 원문과 AI 인용을 비교한 뒤 다시 시도해 주세요. 인용문을 맞추기 위해 원본 계약서를 고칠 필요는 없습니다. 반복되면 이 위치와 오류 코드를 전달해 주세요.',retryable:true,
    sourceExcerpt:first.sourceText.slice(0,1500),generatedQuote:first.generatedQuote.slice(0,1500),
  });
  // Full source is used only in the existing in-memory AI correction request.
  // It is not added to server logs or the public error payload.
  error.evidenceIssues=issues;return error;
}

function verifyEvidence(e,records,stage='review'){
  const issue=issueFor(e,records);if(issue)throw mismatchError([issue],stage);
}

function verifyEvidenceTree(value,records,stage='review'){
  const issues=[];
  function visit(node,location){
    if(!node||typeof node!=='object')return;
    if(typeof node.paragraphId==='string'&&typeof node.quote==='string'){
      const issue=issueFor(node,records);if(issue)issues.push({path:location,...issue});
    }
    for(const [key,child]of Object.entries(node))visit(child,`${location}/${key}`);
  }
  visit(value,'');if(issues.length)throw mismatchError(issues,stage);
  return value;
}

function correctionFor(error,previous){
  if(error.referenceIssues)return {issue:error.diagnostic,message:error.message,previous,referenceCorrections:error.referenceIssues,
    instruction:'Fix ALL listed reference paths using only sourceId values from paragraphs[].sources. Select each supporting sentence separately, including across paragraphs. Do not write quotations, combine IDs, invent IDs or attach unrelated evidence.'};
  return {issue:error.diagnostic,message:error.message,previous,...(error.evidenceIssues?{
    evidenceCorrections:error.evidenceIssues,
    instruction:'Fix ALL listed evidence paths against sourceText and the supplied paragraphs. Copy a continuous, exact source substring supporting the same claim. Keep case, numbers, negation and wording unchanged. Do not use revised clauses or summaries as original evidence. Do not change the source document, fabricate a quote, attach unrelated text, or move edit anchors. Candidate paragraph IDs are suggestions only; check the supported claim and full clause coverage when correcting an evidence location.'
  }:{})};
}

module.exports={resolveQuote,verifyEvidence,verifyEvidenceTree,correctionFor};
