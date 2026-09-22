class ReviewError extends Error {
  constructor(code,message,{stage='review',criterion=null,paragraphId='',action='입력과 원문을 확인한 뒤 다시 시도해 주세요.',detail='',status=422,retryable=false,requestId='',sourceExcerpt='',generatedQuote=''}={}){
    super(message);this.name='ReviewError';this.code=code;this.status=status;
    this.diagnostic={code,stage,criterion,paragraphId,detail,action,retryable,requestId,...(sourceExcerpt||generatedQuote?{sourceExcerpt,generatedQuote}:{})};
  }
}
function describeError(e,stage){
  const message=e.message||'처리 중 오류가 발생했습니다.';
  if(e.diagnostic)return {error:message,diagnostic:{...e.diagnostic,stage:e.diagnostic.stage||stage}};
  const actions={upload:'암호·손상·기존 변경 이력을 확인하고 Word에서 DOCX 사본을 저장해 다시 업로드해 주세요.',analyze:'업로드 문서의 당사자·목적·주요 조건이 텍스트로 읽히는지 확인해 주세요.',review:'검토 기준을 확인해 주세요. 같은 문제가 반복되면 표시된 위치와 오류 코드를 전달해 주세요.',finalize:'권고 선택 화면으로 돌아가 충돌하는 항목을 한 번에 하나씩 채택해 주세요.',request:'현재 페이지를 새로고침하거나 로컬 서버 연결 상태를 확인해 주세요.'};
  return {error:message,diagnostic:{code:'REQUEST_FAILED',stage,criterion:null,paragraphId:'',detail:message,action:actions[stage]||actions.request,retryable:false,requestId:''}};
}
module.exports={ReviewError,describeError};
