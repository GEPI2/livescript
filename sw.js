// 오프라인에서도 열리게 하는 서비스 워커. 범위는 이 폴더(./)뿐이다.
// gepi2.github.io는 같은 계정의 다른 Pages 사이트와 캐시 저장소를 같이 쓴다. 그래서 'livescript-'로 시작하는 캐시만 만들고 지우고,
// transformers-cache(받아 둔 판정 모델)와 다른 사이트의 캐시는 건드리지 않는다.
const Q = '?v=13';  // 배포 때 ?v=를 올리는 sed가 이것도 같이 바꾼다
const CACHE = 'livescript-v' + Q.slice(3);
const FONTS = 'livescript-fonts-1';  // fonts/ 글꼴 조각. 글꼴을 바꾸면 올린다
const VENDOR = 'livescript-vendor-1';  // vendor/ 파일을 바꾸면 올린다 (VERSIONS.txt). 배포마다 wasm 27MB를 다시 받지 않게 따로 둔다
const SHELL = ['./', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png',
  ...['match.js', 'app.js', 'qa.js', 'claude.js', 'lib.js', 'shrink.js', 'jev.js', 'adlib.js', 'check.js', 'slides.js', 'compare.js', 'jev-worker.js', 'sample.livescript.json'].map(f => f + Q)];

// skipWaiting은 쓰지 않는다. 발표 중인 탭이 있는데 새 워커가 바로 켜지면 옛 캐시를 지워서, 오프라인일 때 그 탭이 나중에 부르는 옛 ?v 파일(JEV 워커, 예시 대본)을 못 찾는다.
// 새 워커는 이 앱 탭이 모두 닫힌 뒤에 켜진다. clients.claim은 그때(또는 처음 설치 때)만 돌아서 발표 중인 탭이 쓰던 캐시를 바꾸지 않는다.
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))));
self.addEventListener('activate', e => e.waitUntil(caches.keys()
  .then(ks => Promise.all(ks.filter(k => k.startsWith('livescript-') && k !== CACHE && k !== VENDOR && k !== FONTS).map(k => caches.delete(k))))
  .then(() => self.clients.claim())));

// 네트워크에서 받고, 잘 받았으면 캐시에도 넣는다
function net(e, c, init) {
  const p = fetch(e.request, init);
  e.waitUntil(p.then(r => r.status === 200 && r.type === 'basic' && !r.redirected && c.put(e.request, r.clone())).catch(() => {}));
  return p;
}

self.addEventListener('fetch', e => {
  const req = e.request, scope = self.registration.scope;
  // GET이 아니거나 이 폴더 밖(다른 Pages 사이트, Anthropic, Hugging Face)이면 손대지 않는다
  if (req.method !== 'GET' || !req.url.startsWith(scope)) return;
  const path = req.url.slice(scope.length);
  e.respondWith(caches.open(CACHE).then(async c => {
    // 화면: 네트워크 먼저(HTTP 캐시의 10분 묵은 화면은 쓰지 않는다). 끊겼거나 3초 넘게 걸리거나 서버 오류면 저장한 화면
    if (req.mode === 'navigate') {
      const p = net(e, c, { cache: 'no-cache' });
      return Promise.race([p.then(r => r.status < 500 ? r : Promise.reject()), new Promise((_, no) => setTimeout(no, 3000))])
        .catch(async () => await c.match(req, { ignoreSearch: true }) || (!path.includes('/') && await c.match('./')) || p);
    }
    // vendor/: 한 번 받으면 다시 받지 않는다 (발표를 시작할 때마다 wasm을 뒤에서 다시 받지 않게)
    // fonts/: vendor/처럼 한 번 받으면 다시 받지 않는다 (글자 범위별 조각이라 쓰는 조각만 받는다)
    if (path.startsWith('fonts/')) { const v = await caches.open(FONTS); return await v.match(req) || net(e, v); }
    if (path.startsWith('vendor/')) { const v = await caches.open(VENDOR); return await v.match(req) || net(e, v); }
    const hit = await c.match(req);
    // guide/, 아이콘, manifest: 저장한 것을 바로 쓰고 뒤에서 새로 받아 둔다 (설치한 앱도 이름·아이콘 변경을 받게)
    if (/^(guide\/|icons\/|manifest)/.test(path)) { const p = net(e, c); return hit || p; }
    // ?v=가 붙은 파일은 바뀌지 않아서 캐시 먼저
    return hit || (/[?&]v=/.test(path) ? net(e, c) : fetch(req));
  }));
});
