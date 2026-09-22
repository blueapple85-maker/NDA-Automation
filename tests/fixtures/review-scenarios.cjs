const paragraphs=[
  'FICTIONAL TEST ONLY — UNILATERAL NON-DISCLOSURE AGREEMENT',
  'This Agreement is between Seoul Harbor Co., Ltd., incorporated in the Republic of Korea ("Harbor"), as Receiving Party, and Meridian Pte. Ltd., incorporated in Singapore ("Meridian"), as Disclosing Party.',
  '1. Purpose. The information may be used for business discussions.',
  '2. Confidential Information means all information of any kind, whether public or private, marked or unmarked, previously known or not, that Meridian or its Affiliates provides to Harbor.',
  '3. Protection. Harbor shall keep the information secret and may share it with its employees for business purposes.',
  '4. Required Disclosure. Harbor may disclose information if required by applicable law or a court order.',
  '5. Term. This Agreement is effective for two years from the date of the last signature. Confidentiality obligations survive for three years after termination.',
  '6. Governing Law. This Agreement is governed by the laws of Singapore.',
  '7. Disputes. The courts of Singapore have exclusive jurisdiction over any dispute arising under this Agreement.',
  '8. Publicity. Meridian may use Harbor\'s name and logo in marketing materials without restriction.',
  '9. No Further Obligation. Neither party is obligated by this Agreement to enter into any further agreement or transaction.',
  '10. Non-competition. Harbor shall not compete with Meridian in any business for five years after termination.',
  '11. Notices. Notices must be made in writing to the most recently notified address of the relevant party.',
  '12. Assignment. Neither party may assign this Agreement without the other party\'s written consent.',
  '13. Counterparts. This Agreement may be signed in counterparts and by electronic signature.',
  'Signed for Harbor: __________________  Signed for Meridian: __________________'
];
const preferences={
  korean:{purposeText:'신규 데이터 분석 서비스 공동개발 가능성을 평가하기 위한 기술 및 사업성 검토',overrides:{law:'잉글랜드 및 웨일스법',dispute:'ICC 중재, 중재지 파리, 중재인 1인, 중재언어 영어',term:'최종 서명일부터 2년',survival:'계약 종료 후 3년'}},
  english:{purposeText:'Technical and commercial evaluation of a potential joint development of a new data analytics service',overrides:{law:'Laws of England and Wales',dispute:'ICC arbitration, seat Paris, one arbitrator, language English',term:'Two years from the date of the last signature',survival:'Three years after termination'}}
};
module.exports={paragraphs,preferences};
