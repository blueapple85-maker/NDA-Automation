const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const str={type:'string'},bool={type:'boolean'},arr=items=>({type:'array',items}),en=(...values)=>({type:'string',enum:values});
const evidence=obj({paragraphId:str,quote:str});
const field=obj({value:str,evidence:arr(evidence),indefinite:bool});
const extractionSchema=obj({
  language:en('en','ko','mixed','unknown'),
  parties:arr(obj({id:str,name:str,shortName:str,jurisdiction:str,role:str,evidence:arr(evidence)})),
  ndaType:en('mutual','unilateral','asymmetric','unclear'),ndaExplanation:str,ndaEvidence:arr(evidence),
  law:field,dispute:field,term:field,survival:field,purpose:field,
  purposeAssessment:obj({status:en('adequate','needs_revision','unclear'),reason:str}),
  lawIsKorean:en('yes','no','unknown'),disputeIsKCAB:en('yes','no','unknown'),warnings:arr(str)
});
const editProperties={id:str,criteria:arr({type:'integer',minimum:1,maximum:17}),action:en('replace','insert_after'),paragraphId:{...str,description:'Exact supplied paragraph ID, not the clause number.'},replacement:{...str,description:'Complete contractual replacement INCLUDING the original clause number and heading, or a new contractual paragraph in the contract language. Do not renumber existing clauses. Negotiation notes go in the separate notes array.'},condition:en('law','dispute','term','survival','purpose','multiple','none'),reason:{...str,description:'Concise Korean explanation for the UI.'}};
function reviewFormat(includeOriginal){
  const edit=obj({...editProperties,...(includeOriginal?{original:str,note:bool}:{})});
  return obj({
    summary:str,effectiveLawIsKorean:en('yes','no','unknown'),effectiveDisputeIsKCAB:en('yes','no','unknown'),
    edits:{...arr(edit),description:'Actual operative amendments implementing ALL necessary criteria 1-16, not only user preference fields. Draft missing representative liability (6), all four exclusions (7), ownership retention (10), warranty disclaimer (11), and reasonable return/destruction (12). Diagnose AND implement. Merge changes to the same paragraph into one replacement. Criterion 17 belongs only in recommendations.'},
    checklist:arr(obj({number:{type:'integer',minimum:1,maximum:17},status:en('ok','changed','attention','not_applicable'),presence:en('present','missing','unclear'),reason:str})),
    ...(includeOriginal?{
      clauseCoverage:arr(obj({paragraphId:str,criteria:arr({type:'integer',minimum:0,maximum:17})})),
      otherClauses:arr(obj({id:str,title:str,clause:str,summary:str,impact:str,assessment:en('ok','attention'),evidence:arr(evidence)}))
    }:{
      clauseInventory:{...arr(obj({id:str,clause:{...str,description:'Clause number such as Section 11; never copy clause text here. If unnumbered, use paragraph ID.'},title:{...str,description:'Short Korean title for criterion 17; otherwise empty string.'},criteria:arr({type:'integer',minimum:0,maximum:17}),summary:{...str,description:'Korean summary for criterion 17, even benign clauses. Otherwise empty string: the checklist already explains criteria 1-16.'},impact:{...str,description:'Effect on the represented company for criterion 17. Otherwise empty string.'},assessment:en('ok','attention'),evidence:arr(evidence)})),description:'Inventory of EVERY original body paragraph, including titles/signature blocks as criterion 0. Use 17 only for substantive topics outside 1-16. Every body paragraph needs an exact quotation in evidence; a paragraph with multiple separate topics may appear in multiple items. All miscellaneous clauses, even benign boilerplate, must be included.'},
      notes:{...arr(obj({topic:en('law','dispute'),paragraphId:str,sentence:{...str,description:'ONE sentence of negotiation rationale, in the contract language, pursuing neutrality; no operative contract language, no [Note to] wrapper. Law and dispute rationales are separate.'},reason:{...str,description:'Korean explanation for the UI.'}})),description:'Separate negotiation notes only. One law note when the effective law is known non-Korean; one dispute note when the effective forum is known non-KCAB. Empty for Korean law/KCAB or unknown, respectively. Never mark operative legal amendments as notes.'}
    }),
    preferences:arr(obj({field:en('purpose','law','dispute','term','survival'),interpreted:str,status:en('kept','applied','already_satisfied','needs_confirmation'),editIds:arr(str),evidence:arr(evidence),reason:str})),
    recommendations:arr(obj({id:str,otherClauseId:{...str,description:'ID of a clauseInventory item whose criteria includes 17.'},title:str,clause:{...str,description:'Actual clause number, not its full text.'},evidence,impact:str,reason:str,edit})),questions:arr(str)
  });
}
module.exports={extractionSchema,reviewSchema:reviewFormat(true),wireReviewSchema:reviewFormat(false)};
