// 발표자료(PPTX·PDF)에서 슬라이드마다 제목과 글을 뽑는다 (시안의 'PPT·PDF 올리기'). 자료는 이 기기 안에서만 읽고 밖으로 보내지 않는다.
// PPTX는 ZIP 속 XML이라 라이브러리 없이 읽는다(DecompressionStream). PDF는 vendor/pdfjs(pdf.js)로 글만 뽑는다. node slides.js 로 확인한다.

// ---- ZIP ----
// 가운데 디렉터리(끝의 EOCD부터 거꾸로 찾는다)로 파일 이름과 위치를 읽고, 필요한 파일만 푼다. 저장(0)과 deflate(8)만 있으면 된다.
const u16 = (b, i) => b[i] | (b[i + 1] << 8), u32 = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
export function zipEntries(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let e = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (u32(b, i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('ZIP 파일이 아니에요.');
  const n = u16(b, e + 10), dec = new TextDecoder(), out = new Map();
  let p = u32(b, e + 16);
  for (let k = 0; k < n; k++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('ZIP 목록이 깨졌어요.');
    const flag = u16(b, p + 8), method = u16(b, p + 10), size = u32(b, p + 20), usize = u32(b, p + 24), len = u16(b, p + 28), ext = u16(b, p + 30), cmt = u16(b, p + 32), at = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + len));
    out.set(name, { method, size, usize, at, enc: (flag & 1) === 1 });
    p += 46 + len + ext + cmt;
  }
  return { b, entries: out };
}
export async function zipRead(zip, name) {
  const en = zip.entries.get(name);
  if (!en) return null;
  if (en.enc) throw new Error('암호가 걸린 파일은 읽을 수 없어요.');
  if (en.usize > 20e6) throw new Error('슬라이드 한 장의 글이 너무 커서 읽을 수 없어요.');  // 풀면 수백 MB가 되는 파일을 풀기 전에 막는다
  const { b } = zip, at = en.at, start = at + 30 + u16(b, at + 26) + u16(b, at + 28), data = b.subarray(start, start + en.size);
  if (en.method === 0) return data;
  if (en.method !== 8) throw new Error('지원하지 않는 압축 방식이에요.');
  const ds = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(ds).arrayBuffer());
}
const text = async (zip, name) => { const d = await zipRead(zip, name); return d ? new TextDecoder().decode(d) : null; };

// ---- PPTX ----
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = s => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()]);
// 한 도형(또는 표)의 문단들: <a:p> 안 <a:t> 글을 잇고 줄바꿈(<a:br/>)은 공백으로. 빈 문단은 뺀다.
const shapeParas = xml => [...xml.matchAll(/<a:p[ >][\s\S]*?<\/a:p>/g)]
  .map(m => unesc([...m[0].replace(/<a:br\s*\/>/g, '<a:t> </a:t>').matchAll(/<a:t[^>]*>([^<]*)<\/a:t>/g)].map(x => x[1]).join('')).replace(/\s+/g, ' ').trim()).filter(Boolean);
const SKIP = /^(sldNum|ftr|dt|sldImg|hdr)$/;
// 슬라이드 하나(XML)에서 { title, body[] }. 제목 자리(title·ctrTitle)가 없으면 첫 글이 제목이다.
export function slideFromXml(xml) {
  let title = '';
  const body = [];
  for (const m of xml.matchAll(/<p:sp[ >][\s\S]*?<\/p:sp>|<p:graphicFrame[ >][\s\S]*?<\/p:graphicFrame>/g)) {
    const ph = /<p:ph\b[^>]*?\btype="([^"]+)"/.exec(m[0])?.[1];
    if (ph && SKIP.test(ph)) continue;
    const ps = shapeParas(m[0]);
    if (!ps.length) continue;
    if ((ph === 'title' || ph === 'ctrTitle') && !title) title = ps.join(' ');
    else body.push(...ps);
  }
  if (!title && body.length) title = body.shift();
  return { title, body };
}
// 보이는 순서(presentation.xml의 sldIdLst + 관계 파일). 못 읽으면 slideN.xml 번호 순서.
async function slideOrder(zip) {
  const names = [...zip.entries.keys()].filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => a.match(/\d+/)[0] - b.match(/\d+/)[0]);
  try {
    const pres = await text(zip, 'ppt/presentation.xml'), rels = await text(zip, 'ppt/_rels/presentation.xml.rels');
    const to = new Map([...rels.matchAll(/<Relationship\b[^>]*>/g)].map(m => [/\bId="([^"]+)"/.exec(m[0])?.[1], /\bTarget="([^"]+)"/.exec(m[0])?.[1]]));
    const order = [...pres.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map(m => to.get(m[1])).filter(Boolean).map(t => 'ppt/' + t.replace(/^\/?(ppt\/)?/, '')).filter(n => zip.entries.has(n));
    return order.length ? order : names;
  } catch { return names; }
}
// 발표자 노트: 슬라이드 관계 파일이 가리키는 notesSlide의 본문 글
async function slideNotes(zip, name) {
  try {
    const rel = await text(zip, name.replace('slides/', 'slides/_rels/') + '.rels'), t = /Target="\.\.\/notesSlides\/([^"]+)"/.exec(rel)?.[1];
    if (!t) return '';
    const x = await text(zip, 'ppt/notesSlides/' + t);
    return [...x.matchAll(/<p:sp[ >][\s\S]*?<\/p:sp>/g)].filter(m => /<p:ph\b[^>]*?\btype="body"/.test(m[0])).flatMap(m => shapeParas(m[0])).join(' ');
  } catch { return ''; }
}
// 반환 [{ n, title, body, notes }] (n은 1부터). 글이 하나도 없는 슬라이드도 자리는 남긴다(이름은 '슬라이드 n').
export async function pptxSlides(buf) {
  const zip = zipEntries(buf), names = await slideOrder(zip);
  if (!names.length) throw new Error('슬라이드를 찾지 못했어요. PPTX 파일이 맞나요?');
  if (names.length > 300) throw new Error('슬라이드가 너무 많아요. 300장 이하로 줄여 주세요.');
  const out = [];
  for (const [i, name] of names.entries()) {
    const s = slideFromXml(await text(zip, name));
    out.push({ n: i + 1, title: s.title || `슬라이드 ${i + 1}`, body: s.body.join(' '), notes: await slideNotes(zip, name) });
  }
  return out;
}

// ---- PDF ----
// pdf.js getTextContent().items = [{ str, transform: [a, b, c, d, x, y], height, hasEOL }]. 같은 줄(y가 비슷한 것)끼리 잇고, 가장 큰 글자가 맨 위쪽에 있으면 제목이다.
export function pdfPageSlide(items, n) {
  const its = items.filter(x => x.str?.trim()).map(x => ({ s: x.str, x: x.transform[4], y: x.transform[5], w: x.width ?? null, h: Math.abs(x.height || x.transform[3]) || 1 }));
  if (!its.length) return { n, title: `슬라이드 ${n}`, body: '', notes: '' };
  its.sort((a, b) => b.y - a.y || a.x - b.x);
  const lines = [];
  for (const it of its) {
    const l = lines.find(l => Math.abs(l.y - it.y) <= Math.max(2, it.h * 0.4));
    if (l) { l.parts.push(it); l.h = Math.max(l.h, it.h); }
    else lines.push({ y: it.y, h: it.h, parts: [it] });
  }
  // 같은 줄의 조각은 사이가 벌어졌을 때만 공백으로 잇는다(한글 PDF는 글자 한두 개씩 끊겨 온다). 폭을 모르면(width 없음) 조각마다 공백
  const join = parts => parts.sort((a, b) => a.x - b.x).reduce((t, p, i, a) => i ? t + (a[i - 1].w == null || p.x - (a[i - 1].x + a[i - 1].w) > p.h * 0.25 ? ' ' : '') + p.s : p.s, '');
  const ls = lines.map(l => ({ t: join(l.parts).replace(/\s+/g, ' ').trim(), h: l.h, y: l.y })).filter(l => l.t);
  const hs = ls.map(l => l.h).sort((a, b) => a - b), med = hs[hs.length >> 1];
  const big = ls.slice(0, 3).reduce((b, l) => l.h > b.h ? l : b, ls[0]);  // 위쪽 세 줄 중 가장 큰 글자
  const title = big.h >= med * 1.2 || ls.length === 1 ? big : ls[0];
  return { n, title: title.t, body: ls.filter(l => l !== title).map(l => l.t).join(' '), notes: '' };
}
export async function pdfSlides(buf, pdfjs) {
  const doc = await pdfjs.getDocument({ data: buf instanceof Uint8Array ? buf : new Uint8Array(buf), isEvalSupported: false, disableFontFace: true }).promise;
  const out = [];
  try {
    if (doc.numPages > 300) throw new Error('쪽이 너무 많아요. 300쪽 이하로 줄여 주세요.');
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      out.push(pdfPageSlide((await pg.getTextContent()).items, i));
      pg.cleanup();
    }
  } finally { doc.destroy(); }
  return out;
}

// ---- 공통 ----
const clip = (s, n) => s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s;
// 'AI 도구'의 슬라이드 개요 칸: 한 줄에 슬라이드 하나. 제목: 본문 앞부분(노트가 있으면 노트를 더한다). 글이 없는 슬라이드는 제목만.
export const outlineLines = slides => slides.map(s => {
  const rest = [s.body, s.notes && `(발표자 노트) ${s.notes}`].filter(Boolean).join(' ');
  return rest ? `${clip(s.title, 40)}: ${clip(rest, 160)}` : clip(s.title, 60);
}).join('\n');
// 파일 이름이나 첫 슬라이드 제목으로 쓸 발표 주제 어림값
export const topicOf = (slides, fname = '') => slides[0]?.title && !/^슬라이드 \d+$/.test(slides[0].title) ? clip(slides[0].title, 40) : fname.replace(/\.[^.]+$/, '');
export const slidesFrom = async (file, load = () => import('./vendor/pdfjs/pdf.min.mjs')) => {
  if (file.size > 60e6) throw new Error('파일이 너무 커요. 60MB 이하로 줄여 주세요.');  // 통째로 읽기 전에 크기부터 본다
  const buf = new Uint8Array(await file.arrayBuffer()), kind = /\.pdf$/i.test(file.name) || file.type === 'application/pdf' ? 'pdf' : 'pptx';
  if (kind === 'pdf') {
    const pdfjs = await load();
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    try { return { kind, slides: await pdfSlides(buf, pdfjs) }; }
    catch (e) { throw new Error({ PasswordException: '암호가 걸린 PDF는 읽을 수 없어요.', InvalidPDFException: 'PDF 파일이 올바르지 않아요.' }[e.name] || e.message); }  // pdf.js의 영어 오류를 한국어로
  }
  if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new Error('PPTX나 PDF만 읽어요. 옛 형식(.ppt)이면 PowerPoint에서 PPTX나 PDF로 저장해 주세요.');  // 옛 PPT·DOC(OLE) 서명
  return { kind, slides: await pptxSlides(buf) };
};

// node slides.js 로 확인
if (typeof process === 'object' && process.argv[1]?.endsWith('slides.js')) {
  const assert = (await import('node:assert')).default, zlib = await import('node:zlib');
  // 시험용 PPTX: 파일마다 저장(0)과 deflate(8)를 섞어 ZIP을 만든다
  const crc = (() => { const t = Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0; }); return d => { let c = ~0; for (const x of d) c = t[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; }; })();
  const zip = files => {
    const enc = new TextEncoder(), parts = [], cd = [];
    let off = 0, i = 0;
    for (const [name, content] of Object.entries(files)) {
      const raw = enc.encode(content), method = i++ % 2 ? 0 : 8, data = method === 8 ? zlib.deflateRawSync(raw) : raw, nm = enc.encode(name);
      const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(method, 8); h.writeUInt32LE(crc(raw), 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nm.length, 26);
      const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(method, 10); c.writeUInt32LE(crc(raw), 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nm.length, 28); c.writeUInt32LE(off, 42);
      parts.push(h, nm, data); cd.push(c, nm); off += 30 + nm.length + data.length;
    }
    const cdb = Buffer.concat(cd), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(cd.length / 2, 8); e.writeUInt16LE(cd.length / 2, 10); e.writeUInt32LE(cdb.length, 12); e.writeUInt32LE(off, 16);
    return new Uint8Array(Buffer.concat([...parts, cdb, e]));
  };
  const sp = (type, ...ps) => `<p:sp><p:nvSpPr><p:nvPr>${type ? `<p:ph type="${type}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${ps.map(p => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`;
  const sld = (...s) => `<p:sld><p:cSld><p:spTree>${s.join('')}</p:spTree></p:cSld></p:sld>`;
  const rel = (id, t) => `<Relationship Id="${id}" Type="x" Target="${t}"/>`;
  const f = {
    'ppt/presentation.xml': '<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId1"/><p:sldId id="258" r:id="rId3"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': `<Relationships>${rel('rId1', 'slides/slide1.xml')}${rel('rId2', 'slides/slide2.xml')}${rel('rId3', 'slides/slide3.xml')}</Relationships>`,
    'ppt/slides/slide1.xml': sld(sp('ctrTitle', '문제 &amp; 해결'), sp('', '발표자는 슬라이드를 넘기고', '대본을 찾아요'), sp('sldNum', '1')),
    'ppt/slides/slide2.xml': sld(sp('', '표지 제목'), sp('subTitle', '김지민')),
    'ppt/slides/slide3.xml': sld('<p:pic/>'),
    'ppt/slides/_rels/slide1.xml.rels': `<Relationships>${rel('rId1', '../notesSlides/notesSlide1.xml')}</Relationships>`,
    'ppt/notesSlides/notesSlide1.xml': sld(sp('sldImg', '그림'), sp('body', '여기서 잠깐 쉬기')),
  };
  const sl = await pptxSlides(zip(f));
  assert.deepEqual(sl.map(s => s.title), ['표지 제목', '문제 & 해결', '슬라이드 3'], '보이는 순서(sldIdLst)로, 글이 없으면 이름만');
  assert.equal(sl[1].body, '발표자는 슬라이드를 넘기고 대본을 찾아요', '쪽번호 자리는 뺀다');
  assert.equal(sl[1].notes, '여기서 잠깐 쉬기'); assert.equal(sl[0].body, '김지민');
  assert.equal(outlineLines(sl), '표지 제목: 김지민\n문제 & 해결: 발표자는 슬라이드를 넘기고 대본을 찾아요 (발표자 노트) 여기서 잠깐 쉬기\n슬라이드 3');
  assert.equal(topicOf(sl, 'a.pptx'), '표지 제목'); assert.equal(topicOf([{ title: '슬라이드 1' }], 'IR_deck.pdf'), 'IR_deck');
  assert.throws(() => zipEntries(new Uint8Array(30)), /ZIP/);
  await assert.rejects(() => pptxSlides(zip({ 'a.txt': 'x' })), /슬라이드를 찾지/);
  // 올린 파일이 못 읽는 것일 때 다음 할 일이 보이는 한국어 오류
  const up = (name, bytes) => ({ name, type: '', arrayBuffer: async () => bytes.buffer });
  const pdfErr = name => ({ GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.reject(Object.assign(new Error('English'), { name })) }) });
  await assert.rejects(() => slidesFrom(up('a.ppt', Uint8Array.from([0xd0, 0xcf, 0x11])), null), /옛 형식\(\.ppt\)/);
  await assert.rejects(() => slidesFrom({ ...up('a.pdf', new Uint8Array(1)), size: 61e6 }, null), /60MB/, '읽기 전에 크기를 본다');
  await assert.rejects(() => pptxSlides(zip({ 'ppt/slides/slide1.xml': ' '.repeat(21e6) })), /너무 커서/, '풀린 글이 20MB 넘는 슬라이드');
  await assert.rejects(() => pdfSlides(new Uint8Array(1), { getDocument: () => ({ promise: Promise.resolve({ numPages: 301, destroy() {} }) }) }), /쪽이 너무 많아요/, '301쪽');
  await assert.rejects(() => slidesFrom(up('a.pdf', new Uint8Array(8)), async () => pdfErr('PasswordException')), /암호가 걸린 PDF/);
  await assert.rejects(() => slidesFrom(up('a.pdf', new Uint8Array(8)), async () => pdfErr('InvalidPDFException')), /PDF 파일이 올바르지 않아요/);
  assert.deepEqual(unesc('&lt;a&gt; &#54620;&#xD55C; &amp;amp;'), '<a> 한한 &amp;');
  // PDF 쪽: 큰 글자가 위에 있으면 제목, 같은 줄은 왼쪽부터 잇는다
  const it = (str, x, y, h) => ({ str, transform: [h, 0, 0, h, x, y], height: h });
  const pg = pdfPageSlide([it('본문 둘째', 40, 300, 14), it('시장', 40, 500, 32), it('크기', 80, 500, 32), it('본문 첫째', 40, 360, 14), it('끝', 120, 360, 14)], 4);
  assert.equal(pg.title, '시장 크기'); assert.equal(pg.body, '본문 첫째 끝 본문 둘째'); assert.equal(pg.n, 4);
  assert.equal(pdfPageSlide([it('한 줄', 0, 0, 14)], 1).title, '한 줄');
  const w = (str, x, y, h, wd) => ({ ...it(str, x, y, h), width: wd });
  assert.equal(pdfPageSlide([w('발', 0, 9, 14, 14), w('표', 14, 9, 14, 14), w('자', 40, 9, 14, 14)], 1).title, '발표 자', '붙은 글자 조각은 이어 붙이고 벌어지면 공백');
  assert.equal(pdfPageSlide([], 2).title, '슬라이드 2');
  assert.equal(pdfPageSlide([it('똑같은 크기 첫줄', 0, 100, 14), it('둘째 줄', 0, 80, 14)], 1).title, '똑같은 크기 첫줄', '크기 차이가 없으면 첫 줄이 제목');
  console.log('slides.js ok');
}
