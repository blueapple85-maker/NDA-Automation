const test=require('node:test'),assert=require('node:assert/strict');
const {resolveQuote,verifyEvidence,verifyEvidenceTree,correctionFor}=require('../server/evidence.cjs');
const {describeError}=require('../server/errors.cjs');
const {createSourceCatalog,hydrateSourceEvidence}=require('../server/source-evidence.cjs');

test('presentation differences resolve to the exact original substring, including Unicode offsets',()=>{
  const source='서문 😀  The\tReceiving\u00a0Party’s\r\n“non\u2011public” infor\u00admation stays protected. Tail.';
  const quote='The Receiving Party\'s "non-public" information stays protected.';
  const resolved=resolveQuote(source,quote);
  assert.equal(resolved.quote,'The\tReceiving\u00a0Party’s\r\n“non\u2011public” infor\u00admation stays protected.');
  assert.ok(source.includes(resolved.quote));
  assert.equal(resolveQuote('비밀정보는\t목적에\n따라 사용한다.','비밀정보는 목적에 따라 사용한다.').quote,'비밀정보는\t목적에\n따라 사용한다.');
  const e={paragraphId:'p7',quote};verifyEvidence(e,[{id:'p7',text:source}]);assert.equal(e.paragraphId,'p7');assert.equal(e.quote,resolved.quote);
});

test('changed obligations, negation, amounts, punctuation, case and ellipses remain rejected',()=>{
  const source='The Recipient shall not disclose Confidential Information for 3 years.';
  for(const quote of [
    'The Recipient shall disclose Confidential Information for 3 years.',
    'The Recipient shall not disclose Confidential Information for 5 years.',
    'The Recipient may not disclose Confidential Information for 3 years.',
    'The recipient shall not disclose Confidential Information for 3 years.',
    'The Recipient shall not disclose ... for 3 years.',
    'The Recipient shall not disclose Confidential Information, for 3 years.',
    'shallnot disclose', '', '   ', '\u200b',
  ])assert.equal(resolveQuote(source,quote).quote,undefined,quote);
});

test('ambiguous normalized matches do not choose arbitrarily; identical repeated source is safe',()=>{
  assert.equal(resolveQuote('reasonable\tcare and reasonable\ncare','reasonable care').reason,'ambiguous');
  assert.equal(resolveQuote('reasonable\tcare and reasonable\tcare','reasonable care').quote,'reasonable\tcare');
});

test('quotes from another paragraph are diagnosed without moving the anchor',()=>{
  const quote='The parties intend to discuss a software partnership.';
  const records=[{id:'p7',text:'Information must not be shared with third parties.'},{id:'p8',text:quote}];
  const evidence={paragraphId:'p7',quote};
  assert.throws(()=>verifyEvidence(evidence,records),error=>{
    assert.equal(error.code,'SOURCE_QUOTE_MISMATCH');assert.deepEqual(error.evidenceIssues[0].candidateParagraphIds,['p8']);
    assert.equal(error.diagnostic.sourceExcerpt,records[0].text);assert.equal(error.diagnostic.generatedQuote,quote);return true;
  });
  assert.equal(evidence.paragraphId,'p7');
});

test('one correction request includes all mismatches while public diagnostics stay bounded',()=>{
  const records=[{id:'p1',text:'A'.repeat(2000)},{id:'p2',text:'Original evidence.'}];
  const value={clauseInventory:[{evidence:[{paragraphId:'p1',quote:'invented A'},{paragraphId:'p2',quote:'invented B'}]}]};
  assert.throws(()=>verifyEvidenceTree(value,records,'analyze'),error=>{
    const repair=correctionFor(error,value),visible=describeError(error,'analyze');
    assert.equal(repair.evidenceCorrections.length,2);assert.equal(repair.evidenceCorrections[0].sourceText.length,2000);
    assert.equal(repair.evidenceCorrections[1].path,'/clauseInventory/0/evidence/1');
    assert.equal(visible.diagnostic.sourceExcerpt.length,1500);assert.equal(visible.diagnostic.stage,'analyze');
    assert.equal(visible.evidenceCorrections,undefined);assert.equal(visible.diagnostic.sourceText,undefined);return true;
  });
});

test('source selections preserve anonymized purpose text, Unicode and exact whitespace without AI quotations',()=>{
  const records=[
    {id:'word/document.xml#p22',text:'WHEREAS, the Disclosing Party and Recipient have agreed to engage in a potential business opportunity which involves the following: *** Black Mass Supply',editable:true},
    {id:'word/document.xml#p45',text:'All information exchanged shall be deemed trade secrets. *** and *** agree to preserve such information; permission is required.\r\n',editable:true},
    {id:'word/header1.xml#p1',text:'  한글 😀 “비밀정보”\t3년.\r\n공개하지 않는다.  ',ancillary:true},
  ];
  const catalog=createSourceCatalog(records),value={evidence:catalog.paragraphs.flatMap(p=>p.sources.map(s=>({sourceId:s.id})))};
  assert.deepEqual(catalog.paragraphs.map(p=>p.sources.map(s=>s.text).join('')),records.map(r=>r.text));
  assert.ok(catalog.paragraphs.every(p=>!Object.hasOwn(p,'text')));
  const original=structuredClone(value),result=hydrateSourceEvidence(value,catalog,'analyze');
  for(const record of records)assert.equal(result.evidence.filter(e=>e.paragraphId===record.id).map(e=>e.quote).join(''),record.text);
  assert.deepEqual(value,original,'Hydration must not mutate the raw response used in corrections');
  verifyEvidenceTree(result,records,'analyze');
});

test('unrelated sentences stay outside selected evidence and wrong references never fall back to paragraph text',()=>{
  const records=[{id:'p1',text:'The term is two years. Confidentiality survives for three years; publicity needs consent.'},{id:'p2',text:'No warranty is given.'}];
  const catalog=createSourceCatalog(records),[term,survival,publicity]=catalog.paragraphs[0].sources,other=catalog.paragraphs[1].sources[0];
  const output=hydrateSourceEvidence({evidence:[{sourceId:survival.id}]},catalog,'analyze');
  assert.equal(output.evidence[0].quote,'Confidentiality survives for three years;');
  assert.ok(!output.evidence[0].quote.includes('two years'));
  const across=hydrateSourceEvidence({evidence:[{sourceId:term.id},{sourceId:other.id}]},catalog,'analyze');
  assert.deepEqual(across.evidence.map(e=>e.paragraphId),['p1','p2']);
  assert.equal(across.evidence[1].quote,records[1].text);
  const bad={evidence:[{sourceId:'missing'},{sourceId:term.id+'-'+other.id},{sourceId:publicity.id+','+term.id}]};
  assert.throws(()=>hydrateSourceEvidence(bad,catalog,'review'),e=>{
    assert.equal(e.code,'SOURCE_REFERENCE_INVALID');assert.equal(e.diagnostic.stage,'review');
    assert.deepEqual(e.referenceIssues.map(i=>i.reason),['unknown_reference','unknown_reference','unknown_reference']);
    const correction=correctionFor(e,bad);assert.equal(correction.referenceCorrections.length,3);
    assert.equal(describeError(e,'review').referenceIssues,undefined);return true;
  });
});
