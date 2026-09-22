/* Local DOCX text extraction. ZIP metadata is bounded before decompression. */
const NDADocx = (() => {
  'use strict';
  const LIMIT = 20 * 1024 * 1024;
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const WSTRICT = 'http://purl.oclc.org/ooxml/wordprocessingml/main';
  async function readZip(buffer, inflater) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
      if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('유효한 DOCX 파일을 읽을 수 없습니다. 암호화 여부와 파일 형식을 확인해 주세요.');
    const count = view.getUint16(eocd + 10, true);
    let pos = view.getUint32(eocd + 16, true);
    const centralEnd = pos + view.getUint32(eocd + 12, true);
    if (count > 4000 || view.getUint16(eocd + 4, true) || view.getUint16(eocd + 6, true) || centralEnd > eocd) throw new Error('지원하지 않는 DOCX 압축 구조입니다.');
    const wanted = new Map();
    let totalSize = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > centralEnd || view.getUint32(pos, true) !== 0x02014b50) throw new Error('손상된 DOCX 디렉터리입니다.');
      const flags = view.getUint16(pos + 8, true), method = view.getUint16(pos + 10, true);
      const crc = view.getUint32(pos + 16, true), compressed = view.getUint32(pos + 20, true), size = view.getUint32(pos + 24, true);
      const nameLength = view.getUint16(pos + 28, true), extraLength = view.getUint16(pos + 30, true), commentLength = view.getUint16(pos + 32, true);
      const next = pos + 46 + nameLength + extraLength + commentLength;
      if (next > centralEnd) throw new Error('손상된 DOCX 항목입니다.');
      const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
      if (/^word\/(document|comments|footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(name)) {
        totalSize += size;
        if (size > LIMIT || totalSize > LIMIT || (flags & 1) || ![0, 8].includes(method)) throw new Error('DOCX 본문이 너무 크거나 지원하지 않는 압축·암호화 방식입니다.');
        if (wanted.has(name)) throw new Error('중복된 DOCX 본문 항목이 있습니다.');
        wanted.set(name, {flags, method, compressed, size, crc, offset: view.getUint32(pos + 42, true)});
      }
      pos = next;
    }
    if (!wanted.has('word/document.xml')) throw new Error('DOCX에서 Word 본문을 찾지 못했습니다.');
    const result = {};
    for (const [name, entry] of wanted) {
      const offset = entry.offset;
      if (offset + 30 > bytes.length || view.getUint32(offset, true) !== 0x04034b50) throw new Error('손상된 DOCX 압축 항목입니다.');
      const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true);
      if (start + entry.compressed > bytes.length) throw new Error('잘린 DOCX 데이터입니다.');
      const packed = bytes.slice(start, start + entry.compressed);
      let unpacked;
      if (entry.method === 0) unpacked = packed;
      else if (inflater) unpacked = await inflater(packed);
      else {
        if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 DOCX 압축 해제를 지원하지 않습니다. 최신 Edge·Chrome을 사용하거나 텍스트를 붙여넣어 주세요.');
        let decompressor;
        try { decompressor = new DecompressionStream('deflate-raw'); }
        catch { throw new Error('이 브라우저는 DOCX 압축 해제를 지원하지 않습니다. 최신 Edge·Chrome을 사용하거나 텍스트를 붙여넣어 주세요.'); }
        const reader = new Blob([packed]).stream().pipeThrough(decompressor).getReader();
        const chunks = []; let length = 0;
        while (true) {
          const {done, value} = await reader.read();
          if (done) break;
          length += value.length;
          if (length > entry.size || length > LIMIT) { await reader.cancel(); throw new Error('DOCX 압축 해제 크기가 허용 범위를 초과했습니다.'); }
          chunks.push(value);
        }
        unpacked = new Uint8Array(length); let cursor = 0;
        for (const chunk of chunks) { unpacked.set(chunk, cursor); cursor += chunk.length; }
      }
      if (unpacked.length !== entry.size || crc32(unpacked) !== entry.crc) throw new Error('DOCX 데이터 무결성 확인에 실패했습니다. 원본 파일을 다시 저장해 주세요.');
      result[name] = new TextDecoder('utf-8', {fatal: true}).decode(unpacked);
    }
    return result;
  }
  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const b of bytes) { crc ^= b; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function parseXml(xml) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('지원하지 않는 XML 선언이 포함되어 있습니다.');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('DOCX의 XML 문서가 손상되었습니다.');
    return doc;
  }
  function wordNode(node, localName) { return node.nodeType === 1 && (node.namespaceURI === W || node.namespaceURI === WSTRICT) && (!localName || node.localName === localName); }
  function nodes(root, localName) { return Array.from(root.getElementsByTagName('*')).filter(n => wordNode(n, localName)); }
  function content(node, includeDeleted = false) {
    if (node.nodeType !== 1 && node.nodeType !== 9) return '';
    const local = node.localName;
    if (wordNode(node)) {
      if (['del', 'moveFrom'].includes(local) && !includeDeleted) return '';
      if (['t', 'delText'].includes(local)) return node.textContent;
      if (local === 'tab') return '\t';
      if (['br', 'cr'].includes(local)) return '\n';
      if (['instrText', 'delInstrText'].includes(local)) return '';
    }
    // AlternateContent may contain both a drawing and its fallback. Use one branch only.
    if (local === 'AlternateContent') {
      const branch = Array.from(node.children || node.childNodes).find(n => n.localName === 'Choice') || Array.from(node.childNodes).find(n => n.localName === 'Fallback');
      return branch ? content(branch, includeDeleted) : '';
    }
    let value = Array.from(node.childNodes).map(n => content(n, includeDeleted)).join('');
    if (wordNode(node, 'p')) value += '\n';
    return value;
  }
  function extractParts(parts) {
    const main = parseXml(parts['word/document.xml']);
    const text = content(main).replace(/\n{3,}/g, '\n\n').trim();
    if (!text) throw new Error('읽을 수 있는 본문 텍스트가 없습니다. 이미지 문서는 OCR 후 붙여넣어 주세요.');
    const references = [];
    for (const commentXml of [parts['word/comments.xml']].filter(Boolean)) {
      const comments = parseXml(commentXml);
      nodes(comments, 'comment').forEach(node => { const id = node.getAttributeNS(node.namespaceURI, 'id') || ''; const value = content(node, true).trim(); if (value) references.push({type: `Word 댓글 ${id} — 검토 메모, 계약 의무 아님`, text: value}); });
    }
    const deleted = nodes(main).filter(n => ['del', 'moveFrom'].includes(n.localName) && !hasDeletedAncestor(n));
    deleted.forEach((n, index) => { const value = content(n, true).trim(); if (value) references.push({type: `삭제·이동 전 문구 ${index + 1} — 현재 검토 문안에서 제외`, text: value}); });
    for (const [name, xml] of Object.entries(parts)) {
      if (!/^word\/(footnotes|endnotes|header\d*|footer\d*)\.xml$/.test(name)) continue;
      const part = parseXml(xml);
      // Omit footnote separator entries; keep referenced note text as separately labeled evidence.
      const value = content(part).trim();
      if (value) references.push({type: `추가 문서 영역: ${name} — 본문·서명란과 함께 확인`, text: value});
    }
    const revisions = nodes(main).filter(n => ['ins', 'del', 'moveTo', 'moveFrom'].includes(n.localName)).length;
    const imageCount = main.getElementsByTagNameNS('*', 'blip').length;
    const notes = `DOCX 로컬 텍스트 추출. 삽입·이동 후 문구 반영, 삭제·이동 전 문구 제외. 변경 요소 ${revisions}개, 이미지 참조 ${imageCount}개. 표는 텍스트로 펼쳤으며 페이지·자동 목록 번호·서식·복합 필드·텍스트 상자의 순서 및 포함 여부는 원본 대조 필요. 이미지 OCR·첨부 개체·원본 대비 추적되지 않은 변경 비교는 수행하지 않음. 본문 법무 메모가 섞여 있을 수 있으므로 구분 필요.`;
    return {text, references, notes};
  }
  function hasDeletedAncestor(node) { for (let p = node.parentNode; p; p = p.parentNode) if (wordNode(p) && ['del', 'moveFrom'].includes(p.localName)) return true; return false; }
  return {readZip, extractParts, crc32};
})();
