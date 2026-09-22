const { DOMParser, XMLSerializer } = require('@xmldom/xmldom');
const { unzipSync, zipSync, strToU8, strFromU8 } = require('fflate');
const { diffWordsWithSpace } = require('diff');
const {ReviewError}=require('./errors.cjs');
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const XML = 'http://www.w3.org/XML/1998/namespace';
const MAIN = 'word/document.xml';
function parse(xml) {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('외부 엔티티가 포함된 문서는 지원하지 않습니다.');
  return new DOMParser({ onError: (level, message) => { if (level !== 'warning') throw new Error(message); } }).parseFromString(xml, 'application/xml');
}
const serialize = node => new XMLSerializer().serializeToString(node);
const elements = (node, name) => Array.from(node.getElementsByTagNameNS(W, name));
const children = node => Array.from(node.childNodes || []).filter(n => n.nodeType === 1);
function textOf(node) {
  if (node.nodeType !== 1) return '';
  if (node.namespaceURI === W) {
    if (['del', 'moveFrom', 'instrText', 'delInstrText'].includes(node.localName)) return '';
    if (['t', 'delText'].includes(node.localName)) return node.textContent;
    if (node.localName === 'tab') return '\t';
    if (node.localName === 'br' || node.localName === 'cr') return '\n';
  }
  return children(node).map(textOf).join('');
}
function unpack(buffer) {
  if (buffer.length > 10 * 1024 * 1024) throw new Error('파일은 최대 10MB까지 지원합니다.');
  let total = 0, count = 0;
  const entries = unzipSync(new Uint8Array(buffer), { filter: entry => {
    count++; total += entry.originalSize;
    if (count > 2500 || total > 48 * 1024 * 1024) throw new Error('압축 해제 용량이 너무 큽니다.');
    if (entry.name.startsWith('/') || entry.name.split('/').includes('..')) throw new Error('잘못된 문서 경로입니다.');
    return true;
  } });
  if (!entries[MAIN] || !entries['[Content_Types].xml']) throw new Error('유효한 DOCX 문서가 아닙니다.');
  if (Object.keys(entries).some(n => /vbaProject|embeddings\//i.test(n))) throw new Error('매크로 또는 삽입 실행 파일을 제거한 DOCX를 업로드해 주세요.');
  return entries;
}
function accepted(doc) {
  // Complex structural revisions cannot be safely normalized by this editor.
  const unsupported = ['pPrChange','rPrChange','tblPrChange','trPrChange','tcPrChange','sectPrChange','cellDel','cellIns','cellMerge'];
  if (unsupported.some(n => elements(doc, n).length) || elements(doc,'pPr').some(n => elements(n,'del').length || elements(n,'ins').length)) {
    throw new Error('기존의 구조·서식 변경 이력이 있습니다. Word에서 변경 내용을 정리한 사본을 업로드해 주세요.');
  }
  for (const name of ['del','moveFrom']) for (const n of elements(doc,name)) n.parentNode?.removeChild(n);
  for (const name of ['ins','moveTo']) for (const n of elements(doc,name)) {
    const parent = n.parentNode; if (!parent) continue;
    while (n.firstChild) parent.insertBefore(n.firstChild,n);
    parent.removeChild(n);
  }
  for (const name of ['moveFromRangeStart','moveFromRangeEnd','moveToRangeStart','moveToRangeEnd']) for (const n of elements(doc,name)) n.parentNode?.removeChild(n);
  return doc;
}
function editableParagraph(p) {
  return children(p).every(n => n.namespaceURI === W && (n.localName === 'pPr' || (n.localName === 'r' && children(n).every(c => c.namespaceURI === W && ['rPr','t','tab','br','cr'].includes(c.localName)))));
}
function inspect(buffer) {
  const entries = unpack(buffer), normalized = { ...entries }, records = [];
  let hasRevisions = false;
  const partNames = Object.keys(entries).filter(n => /^word\/(document|header\d+|footer\d+|footnotes|endnotes|comments)\.xml$/.test(n));
  for (const name of partNames) {
    const original = parse(strFromU8(entries[name]));
    if (['ins','del','moveFrom','moveTo','pPrChange','rPrChange'].some(n => elements(original,n).length)) hasRevisions = true;
    const doc = accepted(original);
    normalized[name] = strToU8(serialize(doc));
    elements(doc, 'p').forEach((p, i) => {
      // A paragraph containing a textbox is preserved but not offered as an edit anchor.
      const text = textOf(p);
      if (!text.trim()) return;
      records.push({ id: `${name}#p${i+1}`, part: name, text, editable: name === MAIN && editableParagraph(p), ancillary: name !== MAIN });
    });
  }
  if (!records.some(r => r.part === MAIN && r.text.trim())) throw new Error('계약 본문을 찾지 못했습니다. 스캔 이미지 대신 텍스트가 있는 Word 파일을 사용해 주세요.');
  const chars = records.reduce((n,r) => n+r.text.length,0);
  if (chars > 160000) throw new Error('160,000자를 넘는 문서는 분할해서 검토해 주세요.');
  return { records, hasRevisions, baseline: Buffer.from(zipSync(normalized)), original: buffer };
}
function w(doc,name) { return doc.createElementNS(W,`w:${name}`); }
function run(doc, value, style, deleted=false) {
  const r = w(doc,'r'); if (style) r.appendChild(style.cloneNode(true));
  for (const token of value.split(/(\t|\n)/)) {
    if (!token) continue;
    if (token === '\t' || token === '\n') r.appendChild(w(doc, token === '\t' ? 'tab' : 'br'));
    else { const t = w(doc,deleted ? 'delText' : 't'); t.setAttributeNS(XML,'xml:space','preserve'); t.appendChild(doc.createTextNode(token)); r.appendChild(t); }
  }
  return r;
}
function makeRevision(doc, kind, state) {
  const e = w(doc,kind); e.setAttributeNS(W,'w:id',String(++state.id)); e.setAttributeNS(W,'w:author',state.author); e.setAttributeNS(W,'w:date',state.date); return e;
}
function styledRanges(p) {
  let offset=0;
  return children(p).filter(n => n.localName === 'r').map(r => { const text=textOf(r), start=offset; offset+=text.length; return {start,end:offset,text,style:children(r).find(n=>n.localName==='rPr')}; });
}
function addRange(target, doc, ranges, start, length, deleted) {
  const end=start+length;
  for (const r of ranges) { const a=Math.max(start,r.start), b=Math.min(end,r.end); if(b>a) target.appendChild(run(doc,r.text.slice(a-r.start,b-r.start),r.style,deleted)); }
}
function replaceParagraph(p, replacement, state) {
  const doc=p.ownerDocument, before=textOf(p), ranges=styledRanges(p);
  for(const n of children(p)) if(n.localName !== 'pPr') p.removeChild(n);
  let offset=0;
  for(const change of diffWordsWithSpace(before,replacement)) {
    if(change.added) {
      const ins=makeRevision(doc,'ins',state), style=ranges.find(r=>r.end>offset)?.style || ranges.at(-1)?.style;
      ins.appendChild(run(doc,change.value,style)); p.appendChild(ins);
    } else if(change.removed) {
      const del=makeRevision(doc,'del',state); addRange(del,doc,ranges,offset,change.value.length,true); p.appendChild(del); offset+=change.value.length;
    } else { addRange(p,doc,ranges,offset,change.value.length,false); offset+=change.value.length; }
  }
}
function insertParagraph(anchor, value, state, note) {
  const doc=anchor.ownerDocument, p=w(doc,'p'), pPr=w(doc,'pPr');
  const originalPr=children(anchor).find(n=>n.localName==='pPr');
  if(originalPr) for(const n of children(originalPr)) if(!['numPr','rPr','sectPr'].includes(n.localName)) pPr.appendChild(n.cloneNode(true));
  const mark=w(doc,'rPr'); mark.appendChild(makeRevision(doc,'ins',state)); pPr.appendChild(mark); p.appendChild(pPr);
  const ins=makeRevision(doc,'ins',state), rPr=w(doc,'rPr');
  if(note) { rPr.appendChild(w(doc,'i')); const color=w(doc,'color'); color.setAttributeNS(W,'w:val','497469'); rPr.appendChild(color); }
  ins.appendChild(run(doc,value,rPr)); p.appendChild(ins); anchor.parentNode.insertBefore(p,anchor.nextSibling); return p;
}
function trackSettings(entries) {
  const name='word/settings.xml';
  const doc=entries[name] ? parse(strFromU8(entries[name])) : parse(`<w:settings xmlns:w="${W}"/>`);
  if(!elements(doc,'trackRevisions').length) doc.documentElement.appendChild(w(doc,'trackRevisions'));
  entries[name]=strToU8(serialize(doc));
  const relname='word/_rels/document.xml.rels';
  const rel=entries[relname] ? parse(strFromU8(entries[relname])) : parse('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  const rels=Array.from(rel.documentElement.childNodes).filter(n=>n.nodeType===1);
  if(!rels.some(n=>/\/settings$/.test(n.getAttribute('Type')))) {
    const r=rel.createElementNS(rel.documentElement.namespaceURI,'Relationship');
    const used=new Set(rels.map(n=>n.getAttribute('Id'))); let id='ndaSettings'; while(used.has(id)) id+='x';
    r.setAttribute('Id',id); r.setAttribute('Type','http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings'); r.setAttribute('Target','settings.xml'); rel.documentElement.appendChild(r);
  }
  entries[relname]=strToU8(serialize(rel));
  const ct=parse(strFromU8(entries['[Content_Types].xml']));
  if(!Array.from(ct.documentElement.childNodes).some(n=>n.nodeType===1&&n.getAttribute('PartName')==='/word/settings.xml')) {
    const o=ct.createElementNS(ct.documentElement.namespaceURI,'Override'); o.setAttribute('PartName','/word/settings.xml'); o.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml'); ct.documentElement.appendChild(o);
  }
  entries['[Content_Types].xml']=strToU8(serialize(ct));
}
function redline(baseline, edits) {
  const entries=unpack(baseline), doc=parse(strFromU8(entries[MAIN])), paragraphs=elements(doc,'p');
  const originalTexts=paragraphs.map(textOf);
  const state={id:1000,author:'NDA Legal Review',date:new Date().toISOString()}, used=new Set(), insertAfter=new Map();
  for(const edit of edits) {
    const match=/^word\/document\.xml#p(\d+)$/.exec(edit.paragraphId);
    if(!match) throw new Error('본문 밖 수정은 지원하지 않습니다. 해당 항목은 수동 검토가 필요합니다.');
    const p=paragraphs[Number(match[1])-1];
    if(!p || originalTexts[Number(match[1])-1]!==edit.original) throw new Error(`수정 대상 원문이 일치하지 않습니다: ${edit.paragraphId}`);
    if(edit.action==='replace') {
      if(used.has(edit.paragraphId)) throw new ReviewError('REVISION_CONFLICT','같은 문단에 충돌하는 수정이 있습니다.',{stage:'',paragraphId:edit.paragraphId,criterion:edit.criteria?.[0]||null,detail:'기본 수정 또는 다른 채택 권고가 이미 이 문단 전체를 대체합니다.',action:'해당 권고를 보류하고 나머지를 반영하거나 Word에서 문구를 함께 병합해 주세요.'});
      if(!editableParagraph(p)) throw new Error('필드·링크·복잡한 개체가 있는 문단은 자동 수정할 수 없습니다.');
      used.add(edit.paragraphId); replaceParagraph(p,edit.replacement,state);
    } else if(edit.action==='insert_after') {
      if(!edit.replacement.trim()) throw new Error('삽입 내용이 비어 있습니다.');
      const anchor=insertAfter.get(edit.paragraphId)||p;
      insertAfter.set(edit.paragraphId,insertParagraph(anchor,edit.replacement,state,edit.note));
    } else throw new Error('알 수 없는 수정 방식입니다.');
  }
  entries[MAIN]=strToU8(serialize(doc)); trackSettings(entries);
  return Buffer.from(zipSync(entries));
}
function createDocx(paragraphs) {
  const doc=parse(`<w:document xmlns:w="${W}"><w:body/></w:document>`), body=elements(doc,'body')[0];
  paragraphs.forEach((text,i)=>{const p=w(doc,'p'); if(i===0){const pr=w(doc,'pPr'),style=w(doc,'pStyle');style.setAttributeNS(W,'w:val','Title');pr.appendChild(style);p.appendChild(pr);}p.appendChild(run(doc,text));body.appendChild(p);});
  const sect=w(doc,'sectPr');const size=w(doc,'pgSz');size.setAttributeNS(W,'w:w','11906');size.setAttributeNS(W,'w:h','16838');sect.appendChild(size);body.appendChild(sect);
  const entries={
    '[Content_Types].xml':strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels':strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    [MAIN]:strToU8(serialize(doc))
  };
  trackSettings(entries);
  entries['word/settings.xml']=strToU8(strFromU8(entries['word/settings.xml']).replace('<w:trackRevisions/>',''));
  return Buffer.from(zipSync(entries));
}
module.exports={inspect,redline,createDocx,unpack,parse,serialize,textOf,elements,W};
