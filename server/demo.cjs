const {createDocx}=require('./document.cjs');
const titles=['계약당사자','Affiliate','비밀정보 정의','사용 목적','비밀유지 의무','관계자 위반 책임','네 가지 예외','강제 공개','계약·존속기간','소유권·라이선스','보증 부인','반환·폐기','준거법','분쟁해결','Publicity','추가 계약 의무 없음','기타 조항 전체'];
const paragraphs=[
  'DEMONSTRATION ONLY — MUTUAL NON-DISCLOSURE AGREEMENT',
  'This fictional Agreement is between Lumen Labs Co., Ltd., a company incorporated in the Republic of Korea ("Lumen"), and Northstar Pte. Ltd., a company incorporated in Singapore ("Northstar"). Each party may act as a Disclosing Party or Receiving Party.',
  '1. Purpose. The parties wish to evaluate a potential joint software development project (the "Purpose").',
  '2. Confidential Information means non-public information disclosed by either party in connection with the Purpose that is marked confidential or should reasonably be understood to be confidential in light of its nature and the circumstances of disclosure.',
  '3. Protection. The Receiving Party shall protect the Confidential Information and use it only for the Purpose. It may disclose it to its employees and professional advisers who need to know it for the Purpose and are bound by confidentiality obligations.',
  '4. Representatives. The Receiving Party is responsible for breaches of this Agreement by its employees and advisers to whom it discloses Confidential Information.',
  '5. Exclusions. Confidential Information excludes information that is public through no breach of this Agreement, was lawfully known to the Receiving Party before disclosure, or is lawfully received from a third party without a duty of confidentiality.',
  '6. Required Disclosure. The Receiving Party may disclose information required by law or a competent authority, giving prior notice where legally permitted and practicable, disclosing only the legally required portion and reasonably assisting protective measures at the Disclosing Party\'s cost.',
  '7. Term. This Agreement remains in effect for two years from the date of the last signature. Confidentiality obligations survive for three years after termination.',
  '8. Ownership. All rights in Confidential Information remain with the Disclosing Party. No intellectual property ownership or licence is granted except the limited right to use the information for the Purpose.',
  '9. No Warranty. Confidential Information is provided as is, without warranty as to accuracy or completeness. Nothing in this Agreement excludes liability for fraud or wilful misconduct.',
  '10. Return. Upon written request, the Receiving Party shall return or destroy Confidential Information within one business day, including all backup copies, and certify complete destruction.',
  '11. Law and Disputes. This Agreement is governed by the laws of England and Wales. Disputes shall be finally resolved under the ICC Rules by one arbitrator. The seat is Paris, France, and the language is English.',
  '12. Publicity. Neither party may use the other party\'s name or logo, or announce the existence or contents of the discussions, without prior written consent, except as legally required with notice where legally permitted.',
  '13. Non-competition. Neither party shall conduct any business competing with the other party for five years after termination.',
  '14. No Further Obligation. Neither this Agreement nor the disclosure of information obliges either party to enter into any further agreement or transaction.',
  '15. Notices. Notices under this Agreement shall be delivered in writing to the other party at its address last notified in writing.',
  '16. Counterparts. This Agreement may be executed in counterparts and by electronic signature, each of which shall be deemed an original.',
  'For Lumen Labs Co., Ltd.: __________________    For Northstar Pte. Ltd.: __________________'
];
function document(){return createDocx(paragraphs);}
function facts(records){
  const e=(n,quote)=>({paragraphId:records[n].id,quote:quote||records[n].text});
  const field=(value,n,quote)=>({value,evidence:[e(n,quote)],indefinite:false});
  return {
    language:'en',parties:[{id:'party-1',name:'Lumen Labs Co., Ltd.',shortName:'Lumen',jurisdiction:'대한민국',role:'공개자이자 수령자',evidence:[e(1,'Lumen Labs Co., Ltd., a company incorporated in the Republic of Korea')]},{id:'party-2',name:'Northstar Pte. Ltd.',shortName:'Northstar',jurisdiction:'싱가포르',role:'공개자이자 수령자',evidence:[e(1,'Northstar Pte. Ltd., a company incorporated in Singapore')]}],
    ndaType:'mutual',ndaExplanation:'양 당사자 모두 공개자·수령자가 될 수 있으며, 양측의 비밀정보에 동일한 의무가 적용됩니다.',ndaEvidence:[e(1,'Each party may act as a Disclosing Party or Receiving Party.')],
    law:field('잉글랜드 및 웨일스법',12,'the laws of England and Wales'),dispute:field('ICC 중재 · 중재지 파리 · 중재인 1명 · 영어',12,'Disputes shall be finally resolved under the ICC Rules by one arbitrator. The seat is Paris, France, and the language is English.'),
    term:field('최종 서명일로부터 2년',8,'two years from the date of the last signature'),survival:field('종료 후 3년',8,'three years after termination'),purpose:field('공동 소프트웨어 개발 프로젝트 검토',2,'evaluate a potential joint software development project'),
    purposeAssessment:{status:'adequate',reason:'공동 소프트웨어 개발 가능성 검토라는 거래 목적과 정보 사용 범위가 특정되어 있습니다.'},
    lawIsKorean:'no',disputeIsKCAB:'no',warnings:['가상의 회사와 계약으로 만든 기능 시연입니다. AI 법률검토 결과가 아닙니다.']
  };
}
function review(records,facts,input){
  const edits=[],questions=[];
  const edit=(n,replacement,criteria,condition='none',reason='',action='replace',note=false)=>({id:`demo-${n}-${edits.length}`,paragraphId:records[n].id,original:records[n].text,replacement,criteria,condition,reason,action,note});
  edits.push(edit(4,paragraphs[4].replace('shall protect the Confidential Information','shall protect the Confidential Information using at least reasonable care'),[5],'none','최소한 합리적인 주의 수준을 명시합니다.'));
  edits.push(edit(6,paragraphs[6].replace('or is lawfully received','is independently developed without use of the Confidential Information, or is lawfully received'),[7],'none','독립 개발 정보 예외를 추가해 네 가지 예외를 갖춥니다.'));
  edits.push(edit(11,'10. Return. Upon written request, the Receiving Party shall return or destroy Confidential Information within thirty days, except copies retained as required by law or regulation and routine automated backups not readily accessible in the ordinary course. Retained information remains subject to this Agreement. A confirmation by an authorised representative shall be provided on reasonable request.',[12],'none','시연 예시로 30일의 처리 기한과 법적 보관·자동 백업 예외를 제안합니다. 실제 기한은 거래별 검토가 필요합니다.'));
  const o=input.overrides;
  if(o.term||o.survival)edits.push(edit(8,`7. Term. ${o.term ? `Contract term: ${o.term}` : 'This Agreement remains in effect for two years from the date of the last signature.'} ${o.survival ? `Survival: ${o.survival}` : 'Confidentiality obligations survive for three years after termination.'}`,[9],o.term&&o.survival?'multiple':o.term?'term':'survival','데모는 입력을 그대로 삽입합니다. 실제 모드에서는 계약 언어로 문구를 작성합니다.'));
  if(o.law||o.dispute)edits.push(edit(12,`11. Law and Disputes. ${o.law?`Governing law: ${o.law}`:'This Agreement is governed by the laws of England and Wales.'} ${o.dispute?`Dispute resolution: ${o.dispute}`:'Disputes shall be finally resolved under the ICC Rules by one arbitrator. The seat is Paris, France, and the language is English.'}`,[...(o.law?[13]:[]),...(o.dispute?[14]:[])],o.law&&o.dispute?'multiple':o.law?'law':'dispute','사용자의 대체 입력을 반영합니다.'));
  if(input.purposeText)edits.push(edit(2,`1. Purpose. The parties will exchange Confidential Information solely for the following purpose: ${input.purposeText}`,[4],'purpose','사용자가 입력한 목적을 반영합니다.'));
  if(input.purposeText||Object.values(o).some(Boolean))questions.push('예시 체험은 입력 문구를 그대로 삽입합니다. 한·영 의미 해석과 계약 언어 변환은 실제 문서 AI 검토에서 수행합니다.');
  const lawIsKorean=o.law&&/한국|대한민국|korea/i.test(o.law)?'yes':'no',disputeIsKCAB=o.dispute&&/kcab|대한상사중재원/i.test(o.dispute)?'yes':'no';
  const addressee=require('./parties.cjs').noteAddressee(facts,{companyId:input.companyId||'party-1'});
  if(lawIsKorean==='no')edits.push(edit(12,`[Note to ${addressee}: ${o.law?'We seek a governing law outside either party\'s home jurisdiction, so please confirm whether the requested law meets this neutrality objective.':'The existing law of England and Wales is retained to pursue a neutral governing law outside the parties\' stated home jurisdictions of Korea and Singapore.'}]`,[13],'law','준거법의 중립성 취지를 상대방에게 한 문장으로 전달합니다.','insert_after',true));
  if(disputeIsKCAB==='no')edits.push(edit(12,`[Note to ${addressee}: ${o.dispute?'We seek a neutral dispute forum independent of either party\'s home arbitration institution, so please confirm the suitability of the requested arrangement.':'The existing ICC arbitration arrangement is retained to pursue a neutral institution rather than either party\'s home arbitration institution.'}]`,[14],'dispute','분쟁해결 기관의 중립성 취지를 별도 한 문장으로 전달합니다.','insert_after',true));
  const rec={id:'noncompete',otherClauseId:'other-noncompete',title:'NDA 범위를 넘는 5년 비경쟁 의무',clause:'제13조',evidence:{paragraphId:records[14].id,quote:paragraphs[14]},impact:`${input.companyName}의 별도 사업까지 제한할 수 있습니다.`,reason:'거래 검토의 비밀유지 목적에 맞게 별도 사업의 자유를 명시하는 방향을 제안합니다.',edit:edit(14,'13. Independent Activities. Neither party is restricted from independently conducting business or developing products, provided it complies with its confidentiality and permitted-use obligations under this Agreement.',[17],'none','포괄적인 비경쟁 의무를 비밀유지 의무 준수 조건의 독립 사업 허용으로 변경합니다.')};
  rec.edit.id='demo-rec-noncompete';
  const coverage=[[0],[1],[4],[3],[5],[6],[7],[8],[9],[10],[11],[12],[13,14],[15],[17],[16],[17],[17],[0]];
  const otherClauses=[{id:'other-noncompete',title:'비경쟁',clause:'제13조',summary:'종료 후 5년간 상대방과 경쟁하는 모든 사업을 금지합니다.',impact:rec.impact,assessment:'attention',evidence:[rec.evidence]},{id:'other-notices',title:'통지',clause:'제15조',summary:'마지막으로 서면 통지한 주소에 서면으로 통지를 전달합니다.',impact:'양사에 동일하게 적용되는 통지 절차입니다.',assessment:'ok',evidence:[{paragraphId:records[16].id,quote:paragraphs[16]}]},{id:'other-counterparts',title:'대응본·전자서명',clause:'제16조',summary:'대응본과 전자서명을 허용하고 각각 원본으로 취급합니다.',impact:'양사의 계약 체결 편의를 높이는 조항입니다.',assessment:'ok',evidence:[{paragraphId:records[17].id,quote:paragraphs[17]}]}];
  const preferences=Object.entries({purpose:4,law:13,dispute:14,term:9,survival:9}).map(([field,criterion])=>{const requested=field==='purpose'?input.purposeText:o[field];return{field,interpreted:requested||facts[field].value,status:requested?'applied':'kept',editIds:requested?edits.filter(e=>!e.note&&e.criteria.includes(criterion)).map(e=>e.id):[],evidence:requested?[]:facts[field].evidence,reason:requested?'데모에서 입력 문구를 반영했습니다.':'입력하지 않아 원문을 유지합니다.'};});
  return {summary:'주의 수준·독립 개발 예외·반환 부담을 조정하고, 준거법과 분쟁해결의 메모를 각각 작성했습니다. 기타 조항은 특이사항 유무와 관계없이 요약했습니다.',effectiveLawIsKorean:lawIsKorean,effectiveDisputeIsKCAB:disputeIsKCAB,edits,recommendations:[rec],questions,preferences,otherClauses,clauseCoverage:records.filter(r=>!r.ancillary).map((r,i)=>({paragraphId:r.id,criteria:coverage[i]||[0]})),checklist:titles.map((title,i)=>({number:i+1,presence:i===1?'missing':'present',status:i===1?'not_applicable':i===16?'attention':edits.some(e=>e.criteria.includes(i+1))?'changed':'ok',reason:i===1?'Affiliate 용어를 사용하지 않아 추가 정의가 필요하지 않습니다.':i===16?'비경쟁·통지·대응본 조항을 모두 요약했습니다.':edits.filter(e=>e.criteria.includes(i+1)).map(e=>e.reason).join(' ')||`${title}: 시연 계약의 현재 문구를 유지합니다.`}))};
}
module.exports={document,facts,review,titles};
