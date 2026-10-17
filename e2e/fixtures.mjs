// 시험용 발표자료. PPTX는 ZIP을 직접 만들고, PDF는 브라우저로 인쇄해서 만든다(한글 글꼴이 들어간 진짜 PDF).
import zlib from 'node:zlib';

const crc = (() => { const t = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; }); return d => { let c = ~0; for (const x of d) c = t[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; }; })();
export function zip(files) {
  const enc = new TextEncoder(), parts = [], cd = [];
  let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = enc.encode(content), data = zlib.deflateRawSync(raw), nm = enc.encode(name);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 8); h.writeUInt32LE(crc(raw), 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc(raw), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nm, data); cd.push(c, nm); off += 30 + nm.length + data.length;
  }
  const cdb = Buffer.concat(cd), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(cd.length / 2, 8); e.writeUInt16LE(cd.length / 2, 10); e.writeUInt32LE(cdb.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdb, e]);
}
const sp = (type, ...ps) => `<p:sp><p:nvSpPr><p:nvPr>${type ? `<p:ph type="${type}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${ps.map(p => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
const sld = (...s) => `<p:sld><p:cSld><p:spTree>${s.join('')}</p:spTree></p:cSld></p:sld>`;
export const SLIDES = [
  ['말랑 소개', '발표 프롬프터', '김지민'],
  ['문제', '발표자는 슬라이드를 넘기고 대본을 찾는 일을 동시에 해요'],
  ['해결', '소리 내어 읽으면 대본이 따라와요', '시간이 모자라면 줄여 줘요'],
  ['시장', '발표를 하는 학생과 직장인'],
];
export function pptx() {
  const f = { 'ppt/presentation.xml': `<p:presentation><p:sldIdLst>${SLIDES.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('')}</p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<Relationships>${SLIDES.map((_, i) => `<Relationship Id="rId${i + 1}" Type="x" Target="slides/slide${i + 1}.xml"/>`).join('')}</Relationships>` };
  SLIDES.forEach(([t, ...b], i) => { f[`ppt/slides/slide${i + 1}.xml`] = sld(sp('title', t), sp('', ...b)); });
  return zip(f);
}
// PDF: 슬라이드마다 한 쪽, 큰 제목 + 작은 본문
export async function pdf(browser) {
  const p = await browser.newPage();
  await p.setContent(`<style>@page{size:800px 450px;margin:0}body{margin:0;font-family:'Apple SD Gothic Neo',sans-serif}section{height:450px;padding:40px;box-sizing:border-box;page-break-after:always}h1{font-size:44px;margin:0 0 24px}p{font-size:20px;margin:6px 0}</style>` +
    SLIDES.map(([t, ...b]) => `<section><h1>${t}</h1>${b.map(x => `<p>${x}</p>`).join('')}</section>`).join(''));
  const buf = await p.pdf({ width: '800px', height: '450px', printBackground: true });
  await p.close();
  return buf;
}
