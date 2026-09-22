/* File routing shared by uploads and drop events. All parsing stays local. */
const NDADocument = (() => {
  'use strict';
  const TYPES = /\.(doc|docx|txt|md)$/i;
  const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  const STORIES = [
    ['footnotes', 'DOC 각주'], ['headers', 'DOC 머리말·꼬리말'],
    ['annotations', 'DOC 주석 — 법무 메모와 계약 의무를 구분'],
    ['endnotes', 'DOC 미주'], ['textboxes', 'DOC 본문 텍스트 상자'],
    ['headerTextboxes', 'DOC 머리말·꼬리말 텍스트 상자']
  ];
  function accepts(name) { return TYPES.test(name); }
  async function read(name, buffer) {
    if (!accepts(name)) throw new Error('DOC, DOCX, UTF-8 TXT 또는 MD 파일을 선택해 주세요.');
    if (buffer.byteLength > 10 * 1024 * 1024) throw new Error('파일은 최대 10 MB까지 불러올 수 있습니다.');
    let extracted;
    if (/\.docx$/i.test(name)) {
      extracted = {...NDADocx.extractParts(await NDADocx.readZip(buffer)), method: 'DOCX 텍스트 추출 · 삽입 반영/삭제 제외'};
    } else if (/\.doc$/i.test(name)) {
      const bytes = new Uint8Array(buffer);
      if (!SIGNATURE.every((value, index) => bytes[index] === value)) throw new Error('Word 97–2003 DOC 형식이 아닙니다. RTF·HTML 등을 DOC 확장자로 저장한 파일은 Word에서 DOCX로 다시 저장해 업로드해 주세요.');
      const parts = docToText.textSections(bytes);
      if (!parts) throw new Error('DOC를 읽지 못했습니다. 암호를 해제하거나 Word에서 DOCX로 다시 저장해 주세요. Word 6/95 이전 형식, 손상된 파일 및 처리 한도를 넘는 문서는 지원하지 않습니다.');
      const references = STORIES.filter(([key]) => parts[key]?.trim()).map(([key, type]) => ({type, text: parts[key].trim()}));
      const hasDeleted = parts.originalBody !== parts.body;
      if (hasDeleted) references.push({type: 'DOC 변경이력 수락 전 본문 — 삭제 표시 문구 포함, 현행 계약 문안과 구분', text: parts.originalBody});
      extracted = {
        text: parts.body.trim(), references,
        method: 'DOC 바이너리 텍스트 추출 · 삽입 반영/식별된 삭제 표시 제외',
        notes: `Word 97–2003 DOC를 브라우저에서 읽었습니다. 식별된 삭제 표시는 제외하고 삽입 문구를 반영했습니다.${hasDeleted ? ' 삭제 표시가 있는 변경 전 본문은 별도 참고 자료에 포함했습니다.' : ''} 주석·각주·머리말·텍스트 상자는 별도 참고 자료로 전달합니다. 복잡한 변경이력·이동, 자동 목록 번호·페이지·서식·이미지·첨부 개체와 주석의 연결 위치는 원본 대조가 필요합니다. 추출 내용을 확인하고, 누락이 있으면 DOCX로 저장해 다시 업로드해 주세요.`
      };
    } else {
      let text;
      try { text = new TextDecoder('utf-8', {fatal: true}).decode(buffer); }
      catch { throw new Error('UTF-8 텍스트 파일이 아닙니다. UTF-8로 다시 저장하거나 내용을 직접 붙여넣어 주세요.'); }
      extracted = {text, references: [], method: 'UTF-8 텍스트 파일', notes: '텍스트 입력. 전문·별첨·서명란의 완전성과 원문 정확성을 확인해 주세요. 변경이력과 서식은 판별하지 않습니다.'};
    }
    if (!extracted.text.trim()) throw new Error('파일에 읽을 수 있는 본문 텍스트가 없습니다. 이미지 문서는 OCR 후 붙여넣어 주세요.');
    if (extracted.text.length > 500000 || extracted.references.length > 1000 || JSON.stringify(extracted).length > 1500000) throw new Error('추출한 문서가 너무 큽니다. 본문은 500,000자, 참고 자료를 포함한 전체 입력은 1,500,000자까지 지원합니다.');
    return extracted;
  }
  return {accepts, read};
})();
