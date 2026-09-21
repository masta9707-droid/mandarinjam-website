// mandarinjam.club — preview nội bộ (127.0.0.1:3200)
// Proxy /api/src/* -> gateway hàng hóa để né CORS; cache in-memory 60s (list) / 5min (PDP).
// W1.2 (19/9): image-proxy — mọi URL ảnh nguồn trong payload API bị rewrite thành /img/<sha1>?u=...
// Browser CHỈ gọi /img/* trên chính host 3200; server fetch upstream server-side + cache ra đĩa (cache/img).
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const PAYDOLLAR = require('./lib/paydollar-web.cjs');

// ACCOUNT brief (21/9): Better Auth 1.7.5 + better-sqlite3 — tài khoản Mandarin Jam RIÊNG
// (không SSO/import Manjam). OTP email + verified + registrationComplete guard.
const AUTH_LIB = require('./lib/auth.cjs');
const mjAuth = AUTH_LIB.auth;
const { toNodeHandler } = require('better-auth/node');
const authNodeHandler = toNodeHandler(mjAuth);
const { requireVerifiedCustomer, handleAccountComplete, rateLimitCheck, rateLimitRecord, termsVersion } = AUTH_LIB;

// WEB-PAY-02 (21/9): namespaced order store + idempotency + FNOS/PayDollar datafeed adapter.
// Dựa SHARED_PAYMENT_CONTRACT_20260921.md v1.0.0 — only WEB-side, KHÔNG sửa FNOS/core.
const payment = require('./lib/payment.cjs');

// URL upstream (base64 để không lộ chuỗi trong source file; chỉ server đọc)
const SOURCE_BASE = Buffer.from('aHR0cHM6Ly81eXplZHNkbnNiZ3VkaXkzcTFvZ3U2YmguNzIuNjEuMTQ4LjIxMS5zc2xpcC5pbw==', 'base64').toString('utf8');
const PORT = Number(process.env.MJ_PORT) || 3200;
const ROOT = path.join(__dirname, 'public');
const IMG_CACHE_DIR = path.join(__dirname, 'cache', 'img'); // trên G:, không lấp C:
const IMG_CACHE_MAX_FILES = 30000; // trần an toàn: vượt mức chỉ serve memory, không ghi thêm đĩa
const IMG_MAX_BYTES = 25 * 1024 * 1024;
try { fs.mkdirSync(IMG_CACHE_DIR, { recursive: true }); } catch (e) {}
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
};

// W2.2/W2.3 (19/9): bản dịch catalog lô 1 -> injection i18n vào payload PDP/list server-side.
// inject tên + mô tả VI/EN/KO vào từng product trong list (products[]) nếu SKU có trong catalog 280.
function injectListI18n(bodyBuf) {
  try {
    const obj = JSON.parse(bodyBuf.toString('utf8'));
    if (!obj || !Array.isArray(obj.products)) return bodyBuf;
    let touched = false;
    obj.products.forEach(p => {
      const row = p.spuId != null && I18N.get(String(p.spuId));
      const zhName = p.listItem && p.listItem.spuName;
      const zhCat = p.listItem && p.listItem.categoryName;
      const cat = CAT_VI[(zhCat || p.category || '').split(/\s*[/,·|]\s*/)[0]] || (zhCat ? CAT_VI[zhCat] : null) || (p.category ? CAT_VI[p.category] : null) || '';
      if (row) {
        p.name = row.name_vi;
        p._i18n = row;
        // W2.6: merge lot1_full (4 ngôn ngữ + 4 giá theo §7.1) nếu SKU thuộc lô 1
        const f = LOT1_BY_ID[String(p.spuId)];
        if (f) {
          p._i18n = Object.assign({}, row, {
            name_zh: f.name_zh, name_en: f.name_en, name_ko: f.name_ko,
            desc_en: f.desc_en, desc_ko: f.desc_ko, desc_zh: f.desc_zh,
            price_vi: f.price_vi, price_en: f.price_en, price_ko: f.price_ko, price_zh: f.price_zh,
            price_cny: f.price_cny, tier: f.tier
          });
        }
        p._viCategory = cat;
        touched = true;
      } else if (cat) {
        p._viCategory = cat;
        touched = true;
      }
    });
    return touched ? Buffer.from(JSON.stringify(obj), 'utf8') : bodyBuf;
  } catch (e) { return bodyBuf; }
}
let I18N = new Map();
const I18N_FILE = path.join(__dirname, '_work_w22', 'i18n_map.json');
try {
  const obj = JSON.parse(fs.readFileSync(I18N_FILE, 'utf8'));
  I18N = new Map(Object.entries(obj));
  console.log('i18n loaded: ' + I18N.size + ' spu');
} catch (e) {
  console.log('i18n load fail (chưa có?): ' + e.message);
}

// W2.4: catalog lô 1 (280 SKU) built-in — shop hiển thị đúng lô 1, không phải 731k v2.
// CAT_MAP: spuId -> category tiếng Việt (đã làm giàu từ PDP thật).
let CAT_MAP = new Map();
try {
  const cm = JSON.parse(fs.readFileSync(path.join(__dirname, '_work_w22', 'cat_map.json'), 'utf8'));
  CAT_MAP = new Map(Object.entries(cm));
  console.log('cat_map loaded: ' + CAT_MAP.size + ' spu');
} catch (e) { console.log('cat_map load fail: ' + e.message); }
const LOT1_WORK = path.join(__dirname, '_work_w22', 'lot1_full.json');
let LOT1 = null; // [{spuId, brand, name_vi/en/ko/zh, desc_*, price_vi/en/ko/zh/cny, img[], category, tier}]
let LOT1_BY_ID = {}; // spuId -> item (để PDP inject i18n)
function ensureLot1(){
  if (LOT1) return LOT1;
  try {
    LOT1 = JSON.parse(fs.readFileSync(LOT1_WORK, 'utf8'));
    console.log('LOT1 catalog: ' + LOT1.length + ' SKU');
    if (!Array.isArray(LOT1)) throw new Error('không phải mảng');
    LOT1_BY_ID = {};
    LOT1.forEach(x => {
      // W-UI 19/9: chuẩn hóa tên brand (Misbhv -> MISBHV — brand streetwear thật, tên nguồn bị viết viết sai dạng)
      if (x.brand) x.brand = x.brand.replace(/^Misbhv$/i, 'MISBHV');
      LOT1_BY_ID[String(x.spuId)] = x;
    });
  } catch (e) {
    console.log('LOT1 catalog load fail: ' + e.message);
    LOT1 = [];
    LOT1_BY_ID = {};
  }
  return LOT1;
}
/* STOREFRONT 4B/4F: sidecar metadata (department/skuIds) — đọc read-only, cache in-memory,
   giữ last-good nếu file lỗi (không biến toàn bộ mất distance). File ngoài public. */
let SHOP_META = null, SHOP_META_TS = 0;
const SHOP_META_FILE = path.join(__dirname, '_work_shopmeta', 'catalog-metadata.json');
function loadShopMetadata(){
  try {
    const st = fs.statSync(SHOP_META_FILE);
    if (SHOP_META && st.mtimeMs === SHOP_META_TS) return SHOP_META;
    const j = JSON.parse(fs.readFileSync(SHOP_META_FILE, 'utf8'));
    if (!j || !j.records) throw new Error('không có records');
    SHOP_META = j; SHOP_META_TS = st.mtimeMs;
    console.log('SHOP metadata: coverage=' + (j.coverage && j.coverage.verified) + '/' + (j.coverage && j.coverage.total));
  } catch (e) {
    if (!SHOP_META) { SHOP_META = { records: {}, coverage: { verified: 0, total: 0 }, generatedAt: null, note: 'no sidecar yet' }; SHOP_META_TS = 0; }
  }
  return SHOP_META;
}
function injectI18n(bodyBuf, spuId) {
  try {
    const obj = JSON.parse(bodyBuf.toString('utf8'));
    ensureLot1(); // đảm bảo LOT1_BY_ID đã nạp
    const row = I18N.get(String(spuId));
    const full = LOT1_BY_ID[String(spuId)]; // đầy đủ 4 ngôn ngữ + 4 giá (W2.6)
    const dt = obj.detail || {};
    const catVi = CAT_VI[dt.category] || full?.category || dt.category || '';
    if (row || full || catVi) {
      obj._i18n = Object.assign({}, row || {}, full || {});
      if (catVi) obj._i18n.category_vi = catVi;
      if (dt.category) obj._i18n.category_zh = dt.category;
      return Buffer.from(JSON.stringify(obj), 'utf8');
    }
  } catch (e) { /* nếu payload không parse được thì trả nguyên */ }
  return bodyBuf;
}

// W2.3: danh mục shop tiếng Việt — NGUỒN DUY NHẤT là lib/category-map.js (dùng chung với
// cấu hình bộ lọc + bài test, tránh bảng lặp lệch nhau như đã chỉ ra ở nghiệm thu).
const catMap = require('./lib/category-map.js');
const CAT_VI = catMap.CAT_VI;            // category (zh) -> nhãn VI
const CAT_VI_EN = catMap.CAT_VI_EN;      // listItem.categoryName (EN, 44 loại thật) -> nhãn VI
const GENDER_ZH_TO_EN = catMap.GENDER_ZH_TO_EN; // category1 (zh) -> token EN (6 nhóm kể cả Infant)
const DEPT_VI = catMap.DEPT_VI;          // token EN -> nhãn VI (Nữ/Nam/Trẻ em/Bé gái/Bé trai/Em bé/Unisex)
const CAT2_ZH = catMap.CAT2_ZH;          // category2 (zh) -> nhóm cha VI
const mapItemCategory = catMap.mapItemCategory; // HÀM DUY NHẤT map category (production + test dùng chung)


// Host ảnh nguồn cần che (W1.2): intramirror (mọi subdomain), *.aliyuncs.com, sslip.io, IP trần.
// URL trong JSON kết thúc ở " hoặc \ (escaped quote của JSON string) hoặc whitespace.
const IMG_URL_RE = /https?:\/\/(?:[A-Za-z0-9-]+\.)*(?:intramirror\.com|aliyuncs\.com|sslip\.io)[^\s"\\]+|https?:\/\/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}[^\s"\\]*/g;

// hash -> URL nguồn (server-side only; registry điền mỗi lần rewrite payload)
const imgRegistry = new Map();

// Rewrite mọi URL ảnh nguồn trong payload API -> /img/<sha1>
function rewriteImageUrls(bodyBuf) {
  const s = bodyBuf.toString('utf8');
  const out = s.replace(IMG_URL_RE, (m) => {
    const h = crypto.createHash('sha1').update(m).digest('hex');
    if (!imgRegistry.has(h)) { imgRegistry.set(h, m); saveRegistrySoon(); }
    return '/img/' + h;
  });
  return Buffer.from(out, 'utf8');
}

function imgCacheFile(hash, up) {
  let ext = '';
  if (up) {
    try { ext = path.extname(url.parse(up).pathname).toLowerCase(); } catch (e) {}
    if (!MIME[ext]) ext = '';
  }
  return path.join(IMG_CACHE_DIR, hash + ext);
}
function imgCacheLookup(hash) {
  const cand = [hash, hash + '.jpg', hash + '.jpeg', hash + '.png', hash + '.webp', hash + '.gif'];
  for (const f of cand) {
    try { if (fs.existsSync(path.join(IMG_CACHE_DIR, f))) return path.join(IMG_CACHE_DIR, f); } catch (e) {}
  }
  return null;
}

function countCacheFiles() {
  try { return fs.readdirSync(IMG_CACHE_DIR).length; } catch (e) { return 0; }
}

// Fetch upstream ảnh (server-side, browser không biết host nguồn)
function fetchImageUpstream(up) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = url.parse(up); } catch (e) { return reject(new Error('bad_url')); }
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(up, { headers: { 'user-agent': 'mandarinjam-local/1.0', accept: 'image/avif,image/webp,image/png,image/*;q=0.8,*/*;q=0.5' } }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
        res.resume();
        const loc = res.headers.location;
        if (loc) return fetchImageUpstream(new url.URL(loc, up).toString()).then(resolve, reject);
        return reject(new Error('upstream ' + res.statusCode));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('upstream ' + res.statusCode)); }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > IMG_MAX_BYTES) { req.destroy(new Error('upstream too large')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({ type: res.headers['content-type'] || '', body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('upstream timeout')));
  });
}

const REGISTRY_FILE = path.join(__dirname, 'cache', 'img', 'registry.json');
try {
  const saved = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  for (const [h, u] of Object.entries(saved || {})) imgRegistry.set(h, u);
} catch (e) {}
let registrySaveTimer = null;
function saveRegistrySoon() {
  if (registrySaveTimer) return;
  registrySaveTimer = setTimeout(() => {
    registrySaveTimer = null;
    try {
      fs.mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true });
      fs.writeFileSync(REGISTRY_FILE, JSON.stringify(Object.fromEntries(imgRegistry.entries())));
    } catch (e) {}
  }, 2000);
  if (registrySaveTimer.unref) registrySaveTimer.unref();
}

// Content-Type upstream có khi hỏng ("image", "application") → sniff magic bytes
function sniffImageType(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.length > 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf.length > 11 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.length > 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/svg+xml';
  return null;
}

const inflight = new Map(); // hash -> Promise (tránh fetch trùng khi nhiều card dùng chung ảnh)
function serveImage(res, hash) {
  const run = (async () => {
    let file = imgCacheLookup(hash);
    let body = null, type = '';
    if (file) {
      try { body = fs.readFileSync(file); type = MIME[path.extname(file)] || 'application/octet-stream'; } catch (e) {}
    }
    if (!body) {
      const up = imgRegistry.get(hash);
      if (!up) throw new Error('unknown_img');
      const r = await fetchImageUpstream(up);
      body = r.body; type = r.type || 'application/octet-stream';
      if (body.length && countCacheFiles() < IMG_CACHE_MAX_FILES) {
        const cf = imgCacheFile(hash, up);
        fs.writeFile(cf + '.tmp', body, (e1) => { if (!e1) fs.rename(cf + '.tmp', cf, () => {}); });
      }
    }
    const goodType = /^image\/[a-z0-9.+-]+$/i.test(type || '');
    if (!goodType) type = sniffImageType(body) || 'application/octet-stream';
    return { body, type };
  })();
  const hit = inflight.get(hash);
  const p = hit || run;
  if (!hit) { inflight.set(hash, p); p.then(() => inflight.delete(hash), () => inflight.delete(hash)); }
  p.then((r) => {
    res.writeHead(200, { 'content-type': r.type, 'cache-control': 'public, max-age=86400' });
    res.end(r.body);
  }, (e) => {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'img_unavailable' }));
  });
}

const cache = new Map();
function cachedGet(target, ttlMs) {
  const hit = cache.get(target);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.body);
  return new Promise((resolve, reject) => {
    const req = https.get(target, { headers: { 'user-agent': 'mandarinjam-local/1.0', accept: 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks);
        if (res.statusCode === 200) {
          cache.set(target, { at: Date.now(), body });
          resolve(body);
        } else {
          cache.delete(target);
          reject(new Error('upstream ' + res.statusCode));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(25000, () => req.destroy(new Error('upstream timeout')));
  });
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('404'); return; }
    res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- W3.2: đơn hàng server-side ----------
// Object đơn: {id, createdAt, status, subtotal, discount, total, items:[{spuId,skuId,name_vi,name_en,name_ko,name_zh,unit_vi,unit_en,unit_ko,unit_zh,img,qty,brand}], buyer:{...}}
// Giá CHỐT server-side theo §7.1 (đọc từ LOT1_BY_ID), KHÔNG tin giá client đẩy lên.
const ORDERS_DIR = process.env.MJ_ORDERS_DIR ? path.resolve(process.env.MJ_ORDERS_DIR) : path.join(__dirname, 'data', 'orders');
const ORDER_FIELDS = ['name_zh','name_vi','name_en','name_ko','desc_zh','desc_vi','desc_en','desc_ko',
  'price_vi','price_en','price_ko','price_zh','price_cny','img','brand','category','spuId','tier'];
function ensureOrdersDir(){ try { fs.mkdirSync(ORDERS_DIR, { recursive: true }); } catch (e) {} }
function orderFile(id){ return path.join(ORDERS_DIR, id + '.json'); }
function roundPrice(n){ return Math.round(Number(n) || 0); }
function handleCreateOrder(req, res){
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 1e6) req.destroy(); });
  req.on('end', async () => {
    // ACCOUNT brief §4D + WEB-PAY-01: guard verified + registrationComplete TRƯỚC mọi side effect.
    // Không tin body (emailVerified/role/customerId do client gửi đều bỏ qua).
    const g = await requireVerifiedCustomer(req);
    if (!g.ok) { res.writeHead(g.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: g.error })); }
    const customer = g.user;
    try {
      const body = JSON.parse(raw);
      ensureLot1();
      const items = Array.isArray(body.items) ? body.items.slice(0, 50) : [];
      if (!items.length) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'no_items' })); }
      // chốt giá + tên 4 ngôn ngữ từ LOT1_BY_ID (chuẩn §7.1), bỏ qua giá client
      const locked = [];
      for (const it of items) {
        const f = LOT1_BY_ID[String(it.spuId)];
        const qty = Math.max(1, Math.min(50, parseInt(it.qty, 10) || 1));
        if (!f) throw new Error('sku_unknown:' + it.spuId);
        locked.push({
          spuId: Number(f.spuId), brand: f.brand,
          name_vi: f.name_vi || '', name_en: f.name_en || '', name_ko: f.name_ko || '', name_zh: f.name_zh || '',
          img: (f.img && f.img[0]) || '',
          qty,
          unit_vi: roundPrice(f.price_vi), unit_en: roundPrice(f.price_en),
          unit_ko: roundPrice(f.price_ko), unit_zh: roundPrice(f.price_zh),
        });
      }
      const subtotal_vi = locked.reduce((s, i) => s + i.unit_vi * i.qty, 0);
      // W5.5: mã ưu đãi web MJWEB5 −5% đơn đầu (server-side validate, 1 lần dùng)
      let discount_vi = 0, promo = null;
      const code = String(body.promo?.code || body.code || '').trim().toUpperCase();
      if (code) {
        if (code === 'MJWEB5') {
          // "dùng 1 lần" — đã có đơn web dùng mã này thì từ chối (không áp dụng lần 2)
          let used = false;
          try { const dir = path.join(__dirname, 'data', 'orders'); for (const f of fs.readdirSync(dir)) { if (!f.endsWith('.json')) continue; try { const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (o.promo && o.promo.code === 'MJWEB5') { used = true; break; } } catch (e) {} } } catch (e) {}
          if (used) {
            res.writeHead(400, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ error: 'code_used', detail: 'Mã MJWEB5 đã được dùng cho một đơn trước đó.' }));
          }
          discount_vi = roundPrice(subtotal_vi * 0.05);
          promo = { code, pct: 5, discount_vi };
        } else {
          res.writeHead(400, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({ error: 'invalid_code', detail: 'Không có mã ưu đãi này.' }));
        }
      }
      const order = {
              id: 'MJ' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex'),
              lang: body.lang || 'vi',
              createdAt: new Date().toISOString(),
              status: 'created',
              // ACCOUNT §4D: ownership — customer verified do SERVER gắn (không tin client).
              // Legacy guest orders (không customer) giữ nguyên, KHÔNG auto-assign hàng loạt.
              customer: { id: customer.id, email: customer.email, namespace: 'MANDARIN', channel: 'WEB_MANDARINJAM' },
              orderNamespace: 'MANDARIN',
              items: locked,
              subtotal_vi, discount: discount_vi, promo, total_vi: subtotal_vi - discount_vi,
              buyer: { name: String(body.buyer?.name || '').slice(0,120), phone: String(body.buyer?.phone || '').slice(0,30),
                       email: String(body.buyer?.email || customer.email).slice(0,160), address: String(body.buyer?.address || '').slice(0,300) },
              shipping: { method: String(body.shipping?.method || 'standard').slice(0,40),
                          fee_vi: roundPrice(body.shipping?.fee_vi || 0) },
              payment: { method: body.payment?.method || 'pending', status: 'pending' },
              utm: (body.utm && typeof body.utm === 'object' && body.utm.source) ? { source: String(body.utm.source).slice(0,40), medium: String(body.utm.medium || '').slice(0,20), campaign: String(body.utm.campaign || '').slice(0,40) } : undefined,
            };
            ensureOrdersDir();
            const file = orderFile(order.id);
            fs.writeFileSync(file + '.tmp', JSON.stringify(order, null, 2), 'utf8');
            fs.renameSync(file + '.tmp', file);
            // ownership phụ trợ (order_ownership) — idempotent, không sửa đơn legacy
            try {
              const db2 = require('better-sqlite3')(AUTH_LIB.DB_PATH);
              db2.prepare('INSERT INTO order_ownership(orderId, customerId, assignedAt, source) VALUES (?,?,?,?) ON CONFLICT(orderId) DO NOTHING')
                .run(order.id, customer.id, new Date().toISOString(), 'order_create_verified');
              db2.close();
            } catch (e) { /* ownership table là phụ trợ — không chặn order vì nó */ }
            // backup G
            try { const gb = path.join('G:/VIEC_BACKUP', 'orders', order.id + '.json'); fs.mkdirSync(path.dirname(gb), { recursive: true }); fs.copyFileSync(file, gb); } catch (e) {}
            // đổi status sau khi đã có file: không cần — keep created
            res.writeHead(201, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ ok: true, order }));
          } catch (e) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ error: 'bad_order', detail: String(e.message || e) }));
          }
        });
      }
      function handleGetOrder(req, p, res){
              const id = decodeURIComponent(p.slice('/api/order/'.length));
              if (!/^MJ[0-9a-z]+$/.test(id)) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'bad_id' })); return; }
              // ACCOUNT §4D + W02/W11: owner-scoped — chỉ chủ đơn (verified customer) đọc được.
              // Legacy order không customer + không ownership mapping → 404 (không auto-assign, không lộ PII).
              (async () => {
                              const g = await requireVerifiedCustomer(req).catch(() => ({ ok: false, status: 401, error: 'AUTH_REQUIRED' }));
                              const user = (g && g.ok) ? g.user : null;
                              // Chưa đăng nhập / chưa verify: không lộ tồn tại của order (401, không 404)
                              if (!user) { res.writeHead(g.status || 401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: g.error || 'AUTH_REQUIRED' })); }
                              fs.readFile(orderFile(id), 'utf8', (err, data) => {
                                                              if (err) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'not_found' })); }
                                                              let parsed = {}; try { parsed = JSON.parse(data); } catch (e) {}
                                                      const db2 = (() => { try { return require('better-sqlite3')(AUTH_LIB.DB_PATH); } catch (e) { return null; } })();
                        const own = db2 ? db2.prepare('SELECT customerId FROM order_ownership WHERE orderId = ?').get(id) : null;
                        if (db2) try { db2.close(); } catch (e) {}
                          // legacy (không customer) — chỉ cho đọc nếu ownership mapping trỏ đúng user (không auto-assign)
                          const isLegacy = !parsed.customer || !parsed.customer.id;
            const ownerOk = (parsed.customer && parsed.customer.id === user.id) || (!isLegacy && false) || (isLegacy && own && own.customerId === user.id);
            if (!ownerOk) { res.writeHead(404, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'not_found' })); }
            // owner-scoped DTO — bỏ PII buyer thô + payment logs, giữ dữ liệu hiển thị
            const dto = {
              id: parsed.id, createdAt: parsed.createdAt, status: parsed.status,
              items: parsed.items, subtotal_vi: parsed.subtotal_vi, discount: parsed.discount, promo: parsed.promo, total_vi: parsed.total_vi,
              shipping: parsed.shipping, payment: parsed.payment ? { method: parsed.payment.method, status: parsed.payment.status } : undefined,
              address: parsed.buyer ? { address: parsed.buyer.address, phone: parsed.buyer.phone } : undefined,
            };
            res.writeHead(200, { 'content-type': 'application/json' });
                        res.end(JSON.stringify(dto));
                      });
                          })();
                  }

/* ---------------- V2 STORE BRIDGE (CATALOG_FILTER_USD_R1): kho 738k (api.dev.manjaglobal.com) ----------------
   Contract verified live 20/9 (DATA_CONTRACT.md):
   - Một route duy nhất /api/v1/product/search: fullTextSearch rỗng = browse toàn kho; có giá trị = search server-side
     (brandId/category/price/sort kết hợp được — đã verify tổng đúng query).
   - category: MỖI segment một param riêng (category=Women&category=Clothing) — path nối dash KHÔNG hoạt động ($all regex per segment).
   - brand: brandId (brandName conflict 400 khi ghép category).
   - sort: sortBy=_priceMin&sortType=asc|desc (lowercase) — 'ASC' uppercase 400.
   - Giá: item.currency='USD'; salePriceRange/marketPriceRange (USD); SKU: salePrice+currency / marketPrice+marketCurrency.
     KHÔNG map USD vào price_cny — client cũ CNY×4000×margin = double markup. Price legacy = null.
   - SKU lookup: /search?fullTextSearch={skuId} → SPU cha + skuIdList; matchedSku gán server khi q ⊂ skuIdList.
   - Currency public = USD cố định (backend đọc req.user.currency, default USD; param currency=VND → items rỗng). */
const V2_API = 'https://api.dev.manjaglobal.com';
const V2_ID_RE = /^1000\d{9}$/; // productId store B: 13 chữ số, bắt đầu 1000 (lot-1 spuId 8 số -> không đụng)
const V2_CACHE = new Map(); // path -> {t, body}
function v2CachePut(path, body) {
  if (V2_CACHE.size > 300) { const ks = [...V2_CACHE.keys()]; for (const k of ks.slice(0, 150)) V2_CACHE.delete(k); }
  V2_CACHE.set(path, { t: Date.now(), body });
}
function v2GetJson(path, ttlMs) {
  const now = Date.now();
  const hit = V2_CACHE.get(path);
  if (hit && now - hit.t < ttlMs) return Promise.resolve(hit.body);
  return new Promise((resolve, reject) => {
    const rq = https.get(V2_API + path, { timeout: 20000, headers: { accept: 'application/json' } }, r => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('v2 http ' + r.statusCode)); }
      let buf = ''; r.on('data', c => { buf += c; if (buf.length > 25e6) rq.destroy(); });
      r.on('end', () => { try { const j = JSON.parse(buf); v2CachePut(path, j); resolve(j); } catch (e) { reject(e); } });
    });
    rq.on('timeout', () => rq.destroy(new Error('v2 timeout')));
    rq.on('error', reject);
  });
}
function v2RangeNums(arr) { return (Array.isArray(arr) ? arr : []).map(x => Number(x)).filter(x => Number.isFinite(x) && x > 0); }
// q dạng SKU (chữ số 6–13) → matchedSku nếu item chứa đúng skuId
const V2_SKU_Q_RE = /^\d{6,13}$/;
function v2MapItem(p, qSku) {
  const sale = v2RangeNums(p.salePriceRange);
  const ref = v2RangeNums(p.marketPriceRange);
  const saleMin = sale.length ? Math.min(...sale) : 0;
  const saleMax = sale.length ? Math.max(...sale) : 0;
  const refMin = ref.length ? Math.min(...ref) : 0;
  const refMax = ref.length ? Math.max(...ref) : 0;
  const name = p.name || '';
  const catTok = Array.isArray(p.categoryToken) ? p.categoryToken.filter(Boolean) : [];
  // Danh mục thật của kho V2: category1 (nhóm KH/giới tính, zh), category2 (loại cha, zh),
  // category (loại con, zh), listItem.categoryName (loại EN), categoryToken.
  // Dùng HÀM DUY NHẤT từ lib/category-map.js (cùng nguồn với cấu hình bộ lọc + bài test).
  const c = mapItemCategory(p);
  const category = c.category;
  const categoryToken = c.categoryToken;
  const catVi = c.category_vi;
  const deptVi = c.dept_vi;
  const skuIds = (Array.isArray(p.skuIdList) ? p.skuIdList : []).map(String);
  return {
    spuId: String(p.productId), brand: p.brand || '—', brandId: (p.brandId != null ? p.brandId : null), tier: 'V2',
    currency: 'USD',
    saleUsdMin: saleMin, saleUsdMax: saleMax, refUsdMin: refMin, refUsdMax: refMax,
    hasPair: saleMin > 0 && refMin > 0,
    price_cny: null, price_vi: null, price_en: null, price_ko: null, price_zh: null,
    name_vi: name, name_en: name, name_ko: name, name_zh: name,
    desc_vi: p.composition || '', desc_en: p.composition || '', desc_ko: p.composition || '', desc_zh: p.composition || '',
    category,
    categoryToken,
    category1: c.category1,
    category2: c.category2,
    categoryName: c.categoryName,
    categoryEn: c.categoryEn,
    category_vi: catVi,
    dept: c.dept, dept_vi: deptVi,
    img: (p.images || []).slice(0, 9),
    skuIdList: skuIds,
    matchedSku: (qSku && skuIds.includes(qSku)) ? qSku : '',
    _v2: true, inStock: !!p.inStock, soldOut: !!p.soldOut
  };
}
function v2SearchPath(q) {
  const limit = Math.min(Math.max(parseInt(q.limit, 10) || 24, 1), 60);
  const offset = Math.max(parseInt(q.offset, 10) || 0, 0);
  const page = Math.floor(offset / limit) + 1;
  const parts = ['page=' + page, 'limit=' + limit];
  parts.push('fullTextSearch=' + encodeURIComponent(String(q.q || '').trim()));
  // brand: client gửi brandId (number) hoặc brand label; V2 chỉ nhận brandId.
  const bid = parseInt(q.brand, 10);
  if (Number.isFinite(bid) && bid > 0) parts.push('brandId=' + bid);
  // category: department (đoạn 1) + cat (đoạn 2/3, multi-seg cách nhau '+').
  // Mỗi đoạn = 1 param category riêng (backend regex per-segment; path dash KHÔNG hoạt động).
  const deptMap = { men: 'Men', women: 'Women', kids: 'Kids' };
  const segs = [];
  const dept = deptMap[String(q.department || '').toLowerCase()];
  if (dept) segs.push(dept);
  const cats = Array.isArray(q.cat) ? q.cat : (q.cat ? [q.cat] : []);
  for (const c of cats) {
    if (!c) continue;
    String(c).split('+').forEach(s => { const t = s.trim(); if (t && segs[segs.length - 1] !== t) segs.push(t); });
  }
  for (const s of segs) parts.push('category=' + encodeURIComponent(s));
  const pm = parseFloat(q.minPrice); if (Number.isFinite(pm) && pm > 0) parts.push('priceMin=' + pm);
  const px = parseFloat(q.maxPrice); if (Number.isFinite(px) && px > 0) parts.push('priceMax=' + px);
  if (q.sort === 'price-asc') parts.push('sortBy=_priceMin&sortType=asc');
  else if (q.sort === 'price-desc') parts.push('sortBy=_priceMin&sortType=desc');
  return { path: '/api/v1/product/search?' + parts.join('&'), limit, offset };
}
async function handleShopV2(q, res) {
  const qSku = (V2_SKU_Q_RE.test(String(q.q || '').trim()) ? String(q.q).trim() : '');
  const { path, limit, offset } = v2SearchPath(q);
  try {
    const j = await v2GetJson(path, 60 * 1000);
    const d = (j && j.data) || {};
    const items = (d.data || []).map(p => v2MapItem(p, qSku));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ total: d.total != null ? d.total : items.length, offset, limit, items, _feed: 'v2', currency: 'USD' }));
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'v2_unavailable', detail: String(e.message || e) }));
  }
}
// /api/shopv2/config — facets cùng feed V2 (filter-config, TTL 10 phút): departments + category tree + brands(id,count)
let V2_CONFIG_CACHE = null;
async function handleShopV2Config(res) {
  try {
    if (!V2_CONFIG_CACHE || Date.now() - V2_CONFIG_CACHE.t > 10 * 60 * 1000) {
      const j = await v2GetJson('/api/v1/product/filter-config', 10 * 60 * 1000);
            const d = (j && j.data) || {};
            const tree = {};
            const counts = { dept: {}, cat: {}, type: {} }; // global counts theo token (đúng nhãn, không phải count kết quả hiện tại)
            (d.categories || []).forEach(c => {
              const t = Array.isArray(c.tokens) ? c.tokens.filter(Boolean) : [];
              const n = Number(c.productCount) || 0;
              if (t.length >= 1) counts.dept[t[0]] = (counts.dept[t[0]] || 0) + n;
              if (t.length >= 2) {
                counts.cat[t[0] + '/' + t[1]] = (counts.cat[t[0] + '/' + t[1]] || 0) + n;
                if (!tree[t[0]]) tree[t[0]] = {};
                if (!tree[t[0]][t[1]]) tree[t[0]][t[1]] = new Set();
                if (t[2]) {
                  tree[t[0]][t[1]].add(t[2]);
                  const k3 = t[0] + '/' + t[1] + '/' + t[2];
                  counts.type[k3] = (counts.type[k3] || 0) + n;
                }
              }
            });
      const treeOut = {};
      for (const [dep, cats] of Object.entries(tree)) {
        treeOut[dep] = {};
        for (const [cat, types] of Object.entries(cats)) treeOut[dep][cat] = [...types].sort((a, b) => a.localeCompare(b));
      }
      const body = {
              departments: ['Women', 'Men', 'Kids', 'Unisex'].filter(x => treeOut[x]),
              tree: treeOut,
              counts,
              brands: (d.brands || []).map(b => ({ id: b.brandId, label: b.label, count: b.productCount || 0 })),
              source: 'v2-filter-config', observedAt: Date.now()
            };
      V2_CONFIG_CACHE = { t: Date.now(), body };
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' });
    res.end(JSON.stringify(V2_CONFIG_CACHE.body));
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'v2_config_unavailable' }));
  }
}
async function handleV2Pdp(spuId, res) {
  try {
    const j = await v2GetJson('/api/v1/product/' + encodeURIComponent(spuId) + '/detail', 5 * 60 * 1000);
    const p = (j && j.data) || {};
    const skus = (p.skus || []).map(s => ({
          skuId: String(s.skuId), spuId: String(p.productId), size: s.size || '—',
          stock: s.stock,
          salePriceUsd: Number(s.salePrice) || 0, currency: s.currency || 'USD',
          referencePriceUsd: Number(s.marketPrice) || 0, referenceCurrency: s.marketCurrency || s.currency || 'USD',
          image: (s.skuImages || [])[0] || null,
          // R1-08 PDP facts (dữ liệu thật, không bịa): màu/origin/tên theo SKU
          skuColor: s.skuColor || '', origin: s.origin || '', skuName: s.skuName || '',
          // legacy compat — R1 CATALOG: client KHÔNG chạy CNY×4000×margin lên item _v2 (double markup);
          // giữ 0 để mọi đường giá cũ hiển thị '—' thay vì số sai, chờ UI USD.
          totalPrice: 0, imPrice: 0
        }));
        const name = p.name || '';
        const sale = v2RangeNums(p.salePriceRange);
        const ref = v2RangeNums(p.marketPriceRange);
        const saleMin = sale.length ? Math.min(...sale) : 0;
        const saleMax = sale.length ? Math.max(...sale) : 0;
        const refMin = ref.length ? Math.min(...ref) : 0;
        const refMax = ref.length ? Math.max(...ref) : 0;
        // R1-08: facts thật từ V2 detail — composition=mô tả/chất liệu, color=màu,
        // brandCode=mã mẫu hãng (THẬT, không lấy số "product" bù), seasonCode=mùa.
        const payload = {
          spuId: String(p.productId), _v2: true,
          currency: 'USD',
          saleUsdMin: saleMin, saleUsdMax: saleMax, refUsdMin: refMin, refUsdMax: refMax,
          brandCode: p.brandCode || '',
          color: p.color || '', composition: p.composition || '', seasonCode: p.seasonCode || '',
          _i18n: { name_vi: name, name_en: name, name_ko: name, name_zh: name,
                   desc_vi: p.composition || '', desc_en: p.composition || '', desc_ko: '', desc_zh: '', category_vi: '' },
          detail: { pics: (p.images || []).slice(0, 9), brand: p.brand || '', brandCode: p.brandCode || '', name,
                    color: p.color || '', composition: p.composition || '', seasonCode: p.seasonCode || '',
                    salePrice: null, salePriceUsd: saleMin, currency: 'USD',
                    sizeDetail: { spuBlockInfos: [{ spuDetailInfos: skus }] } },
          listItem: { spuName: name, brandName: p.brand || '',
                      coverImg: JSON.stringify((p.images || []).slice(0, 1)),
                      categoryName: Array.isArray(p.category) ? p.category.join('/') : (p.category || ''),
                      categoryToken: Array.isArray(p.categoryToken) ? p.categoryToken : [] }
        };
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(payload));
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'v2_pdp_unavailable', detail: String(e.message || e) }));
  }
}

/* ---------------- USD QUOTE ROUTE (WEB-PAY-01 / CATALOG-FILTER-USD §6) ----------------
   NEW `POST /api/checkout/quote` — read-only, idempotent, server-verified against V2.
   Dựa USD_QUOTE_CONTRACT.md chính xác: mọi số tiền do server tính, KHÔNG client-trusted.
   Quote = 100% USD lines; legacy VND đi qua /api/order cũ. Fee shipping mặc định preview,
   KHÔNG charge thật (NO_REAL_CHARGE). */
const SHIP_LANES = {
  VN_STANDARD:  { label: 'Việt Nam — tiêu chuẩn', usd: 0,  freeOverUsd: 500 },
  SEA_AIR:      { label: 'ĐN Á — hàng không',     usd: 35, freeOverUsd: null },
  GLOBAL_AIR:   { label: 'Quốc tế — hàng không',  usd: 65, freeOverUsd: null }
};
const QUOTE_TTL_MS = 900 * 1000;

async function quoteV2Detail(spuId) {
  // Test-only fixture gate (ISOLATED env only, never production): lets the real /api/order/usd +
  // /api/payment/start routes run end-to-end deterministically (idempotency, auth, ownership) even
  // when the V2 detail endpoint is the missing API (404). Mirrors PAYDOLLAR_MOCK convention.
  if (process.env.MJ_QUOTE_FIXTURE === '1') {
    const fixedSku = process.env.MJ_QUOTE_FIXTURE_SKU || '1000000000001-S';
    const price = Number(process.env.MJ_QUOTE_FIXTURE_PRICE) || 99.5;
    return { productId: String(spuId), name: 'FIXTURE V2 AUTH ROUTE TEST', brand: 'FIXTURE',
      skus: [{ skuId: fixedSku, size: 'M', stock: 5, salePriceUsd: price, currency: 'USD', color: '', skuName: '' }] };
  }
  // trả {skus:[{skuId,size,stock,salePriceUsd,...}], name} hoặc throw
  const j = await v2GetJson('/api/v1/product/' + encodeURIComponent(spuId) + '/detail', 5 * 60 * 1000);
  const p = (j && j.data) || {};
  const skus = (p.skus || []).map(s => ({
    skuId: String(s.skuId), size: s.size || '—', stock: Number(s.stock) || 0,
    salePriceUsd: Number(s.salePrice) || 0, currency: s.currency || 'USD',
    color: s.skuColor || '', skuName: s.skuName || ''
  }));
  return { productId: String(p.productId), name: p.name || '', brand: p.brand || '', skus };
}

function handleQuote(req, res) {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 65536) req.destroy(); });
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(raw || '{}'); } catch (e) { return fail400(res, 'BAD_REQUEST', 'body not json', 0); }
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length || lines.length > 20) return fail400(res, 'BAD_REQUEST', 'lines 1..20', 0);
    // validate shape của từng dòng trước khi gọi V2 (none side effect)
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln || typeof ln !== 'object') return fail400(res, 'BAD_REQUEST', 'line not object', i);
      if (typeof ln.spuId !== 'string' || ln.spuId.length > 40 ||
          typeof ln.skuId !== 'string' || ln.skuId.length > 40)
        return fail400(res, 'BAD_REQUEST', 'spuId/skuId string<=40', i);
      const qty = ln.qty;
      if (!Number.isSafeInteger(qty) || qty < 1 || qty > 20)
        return fail400(res, 'BAD_REQUEST', 'qty int 1..20 (no clamp)', i);
    }
    const shipLane = String(body.shipLane || '').trim();
    if (!SHIP_LANES[shipLane]) return fail400(res, 'LANE_UNKNOWN', 'no lane ' + shipLane, 0);
    // promoCode: chỉ áp dòng legacy VND; cart có dòng USD -> từ chối (PROMO_VND_ONLY)
    const promo = String(body.promoCode || '').trim().toUpperCase();
    if (promo) return fail400(res, 'PROMO_VND_ONLY', 'promo áp cho đơn VND legacy; quote USD không áp', 0);

    // Phân loại dòng: V2 (13-số 1000…) = USD; legacy (khác) = VND
    const usdIdxs = [], vndIdxs = [];
    lines.forEach((ln, i) => { if (V2_ID_RE.test(ln.spuId)) usdIdxs.push(i); else vndIdxs.push(i); });
    if (usdIdxs.length && vndIdxs.length) return fail400(res, 'MIXED_CURRENCY', 'không gộp USD+VND 1 order', 0);
    if (!usdIdxs.length) return fail400(res, 'BAD_REQUEST', 'quote USD yêu cầu dòng SPU V2 (13-số 1000…)', 0);

    // Verify từng dòng USD với V2 detail (cache 5')
    const quoted = [];
    for (const i of usdIdxs) {
      const ln = lines[i];
      let det;
      try { det = await quoteV2Detail(ln.spuId); }
      catch (e) {
        // upstream lỗi -> không đoán
        return fail400(res, 'UPSTREAM_ERROR', String(e.message || e), i);
      }
      if (String(det.productId) !== String(ln.spuId)) return fail400(res, 'SKU_NOT_FOUND', 'spu mismatch', i);
      const sku = det.skus.find(s => s.skuId === ln.skuId);
      if (!sku) return fail400(res, 'SKU_NOT_FOUND', 'skuId không có trong SPU (không bịa size)', i);
      if (!(sku.stock > 0)) return fail400(res, 'SOLD_OUT', 'SKU ' + ln.skuId + ' hết hàng.', i);
      if (!(sku.salePriceUsd > 0)) return fail400(res, 'PRICE_UNAVAILABLE', 'chưa có giá USD thật', i);
      quoted.push({
        spuId: ln.spuId, skuId: ln.skuId, qty: ln.qty,
        unitUsd: sku.salePriceUsd, lineUsd: Math.round(sku.salePriceUsd * ln.qty * 100) / 100,
        name: det.name, size: sku.size, color: sku.color || ''
      });
    }
    const subtotalUsd = Math.round(quoted.reduce((s, l) => s + l.lineUsd, 0) * 100) / 100;
    const lane = SHIP_LANES[shipLane];
    const shippingUsd = (lane.freeOverUsd != null && subtotalUsd >= lane.freeOverUsd) ? 0 : lane.usd;
    const totalUsd = Math.round((subtotalUsd + shippingUsd) * 100) / 100;
    const totalUsdCents = Math.round(totalUsd * 100);

    // quoteId idempotent: hash canonical (lines,lane) — same payload trong TTL trả same quoteId
    const canon = JSON.stringify({ lines: quoted.map(l => [l.spuId, l.skuId, l.qty]), lane: shipLane });
    const quoteId = 'Q-' + new Date().toISOString().slice(0, 10).replace(/-/g, '') + '-' +
      crypto.createHash('sha256').update(canon).digest('hex').slice(0, 8);

    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({
      ok: true, quoteId, currency: 'USD',
      lines: quoted, subtotalUsd, shippingUsd, totalUsd, totalUsdCents,
      fxVndApprox: null, fxVndNote: 'FX_REFERENCE_PENDING',
      lane: { id: shipLane, label: lane.label },
      expiresAt: Date.now() + QUOTE_TTL_MS, ttlSec: 900
    }));
  });
}
function fail400(res, error, detail, line) {
  res.writeHead(400, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error, line, detail }));
}

/* ---------------- WEB-PAY-01/03 USD ORDER + PAY-START (SHARED_PAYMENT_CONTRACT §B) ----------------
   handleCreateUsdOrder: verified customer; server-re-quotes via the SAME V2 source as handleQuote,
   locks real product name + SKU + USD price, persists a USD order with SENSER/namespace + ownership,
   returns {ok, order}. This is the order the /api/payment/start adapter refers to. NO settlement here.
   handlePayStart: given a USD order owned by the verified customer, calls the core consumer API
   /issue then /start/:token/redeem (channel=WEB_MANDARINJAM). Returns {ok, endpoint, form} for the
   client to auto-submit into PayDollar. Truthful PAYDOLLAR_ENABLED_OFF on 404. */
function handleCreateUsdOrder(req, res) {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 65536) req.destroy(); });
  req.on('end', async () => {
    let body; try { body = JSON.parse(raw || '{}'); } catch (e) { return fail400(res, 'BAD_REQUEST', 'body not json', 0); }
    const g = await requireVerifiedCustomer(req).catch(() => ({ ok: false, status: 401, error: 'AUTH_REQUIRED' }));
    if (!g.ok) { res.writeHead(g.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: g.error })); }
    const customer = g.user;
    const lines = Array.isArray(body.lines) ? body.lines : [];
    if (!lines.length || lines.length > 20) return fail400(res, 'BAD_REQUEST', 'lines 1..20', 0);
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i];
      if (!ln || typeof ln !== 'object') return fail400(res, 'BAD_REQUEST', 'line not object', i);
      if (typeof ln.spuId !== 'string' || ln.spuId.length > 40 || typeof ln.skuId !== 'string' || ln.skuId.length > 40)
        return fail400(res, 'BAD_REQUEST', 'spuId/skuId string<=40', i);
      if (!Number.isSafeInteger(ln.qty) || ln.qty < 1 || ln.qty > 20) return fail400(res, 'BAD_REQUEST', 'qty int 1..20', i);
    }
    const shipLane = String(body.shipLane || 'VN_STANDARD').trim();
    if (!SHIP_LANES[shipLane]) return fail400(res, 'LANE_UNKNOWN', 'no lane ' + shipLane, 0);
    // Idempotency (WEB-PAY idemKey): client mints ONE idemKey per checkout intent and reuses it on
    // retry/re-click. If a non-terminal order with the SAME idemKey + same owner already exists,
    // return it (200, reused) instead of minting a duplicate order or re-binding a payment.
    const idemKey = String(body.idemKey || '').trim();
    if (idemKey) {
      try {
        const dbI = require('better-sqlite3')(AUTH_LIB.DB_PATH);
        const row = dbI.prepare('SELECT orderId FROM order_idem WHERE idemKey=? AND customerId=?').get(idemKey, customer.id);
        dbI.close();
        if (row && row.orderId) {
          const existing = payment.readOrderSafe(row.orderId);
          if (existing && existing.id) {
            res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
            return res.end(JSON.stringify({ ok: true, reused: true, order: existing }));
          }
        }
      } catch (e) { /* index is best-effort; a DB failure must NOT block order creation */ }
    }
    // only USD (V2 13-digit) lines here — reject mixed + NO promo on USD
    if (body.promoCode) return fail400(res, 'PROMO_VND_ONLY', 'promo áp cho đơn VND legacy', 0);
    const quoted = [], usdIdxs = [];
    lines.forEach((ln, i) => { if (V2_ID_RE.test(ln.spuId)) usdIdxs.push(i); });
    if (!usdIdxs.length) return fail400(res, 'BAD_REQUEST', 'order USD yêu cầu dòng SPU V2', 0);
    if (usdIdxs.length !== lines.length) return fail400(res, 'MIXED_CURRENCY', 'không gộp USD+VND 1 order', 0);
    for (const i of usdIdxs) {
      const ln = lines[i];
      let det; try { det = await quoteV2Detail(ln.spuId); } catch (e) { return fail400(res, 'UPSTREAM_ERROR', String(e.message || e), i); }
      if (String(det.productId) !== String(ln.spuId)) return fail400(res, 'SKU_NOT_FOUND', 'spu mismatch', i);
      const sku = det.skus.find(s => s.skuId === ln.skuId);
      if (!sku) return fail400(res, 'SKU_NOT_FOUND', 'skuId không có trong SPU', i);
      if (!(sku.stock > 0)) return fail400(res, 'SOLD_OUT', 'SKU ' + ln.skuId + ' hết hàng.', i);
      if (!(sku.salePriceUsd > 0)) return fail400(res, 'PRICE_UNAVAILABLE', 'chưa có giá USD thật', i);
      quoted.push({ spuId: ln.spuId, skuId: ln.skuId, qty: ln.qty, unitUsd: sku.salePriceUsd, lineUsd: Math.round(sku.salePriceUsd * ln.qty * 100) / 100, name: det.name, size: sku.size, color: sku.color || '' });
    }
    const subtotalUsd = Math.round(quoted.reduce((s, l) => s + l.lineUsd, 0) * 100) / 100;
    const lane = SHIP_LANES[shipLane];
    const shippingUsd = (lane.freeOverUsd != null && subtotalUsd >= lane.freeOverUsd) ? 0 : lane.usd;
    const totalUsd = Math.round((subtotalUsd + shippingUsd) * 100) / 100;
    const totalUsdCents = Math.round(totalUsd * 100);
    const orderId = 'MJ' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const order = {
      id: orderId, ns: PAYDOLLAR.CHANNEL, status: 'pending', currency: 'USD', totalUsd, totalUsdCents, subtotalUsd, shippingUsd,
      orderNamespace: PAYDOLLAR.CHANNEL, // SENSER/web namespace for the core aggregate
      principalId: (customer && customer.id) || null,
      customer: customer ? { id: customer.id, email: customer.email, namespace: 'MANDARIN', channel: PAYDOLLAR.CHANNEL } : null,
      items: quoted, // real product name + SKU locked from source (never client-supplied)
      buyer: { name: String(body.buyer?.name || '').slice(0,120), phone: String(body.buyer?.phone || '').slice(0,30), email: String(body.buyer?.email || customer.email).slice(0,160), address: String(body.buyer?.address || '').slice(0,300) },
      shipping: { method: 'standard', lane: shipLane, label: lane.label, feeUsd: shippingUsd },
      payment: { method: 'paydollar', status: 'pending' }, // attemptId bound by PAY-START after core /issue
      createdAt: new Date().toISOString(), lang: body.lang || 'vi',
      utm: (body.utm && typeof body.utm === 'object' && body.utm.source) ? { source: String(body.utm.source).slice(0,40) } : undefined,
    };
    ensureOrdersDir();
    const file = orderFile(orderId);
    try { fs.writeFileSync(file + '.tmp', JSON.stringify(order, null, 2), 'utf8'); fs.renameSync(file + '.tmp', file); }
    catch (e) { return fail400(res, 'STORAGE_FAIL', String(e.message || e), 0); }
    try { const db2 = require('better-sqlite3')(AUTH_LIB.DB_PATH); db2.exec('CREATE TABLE IF NOT EXISTS order_idem(idemKey TEXT NOT NULL, customerId TEXT NOT NULL, orderId TEXT NOT NULL, createdAt TEXT, PRIMARY KEY(idemKey, customerId))'); db2.prepare('INSERT INTO order_ownership(orderId, customerId, assignedAt, source) VALUES (?,?,?,?) ON CONFLICT(orderId) DO NOTHING').run(orderId, customer.id, new Date().toISOString(), 'usd_order_verified'); db2.close(); } catch (e) {}
    try { const db3 = require('better-sqlite3')(AUTH_LIB.DB_PATH); db3.exec('CREATE TABLE IF NOT EXISTS order_idem(idemKey TEXT NOT NULL, customerId TEXT NOT NULL, orderId TEXT NOT NULL, createdAt TEXT, PRIMARY KEY(idemKey, customerId))'); if (idemKey) db3.prepare('INSERT OR IGNORE INTO order_idem(idemKey, customerId, orderId, createdAt) VALUES (?,?,?,?)').run(idemKey, customer.id, orderId, new Date().toISOString()); db3.close(); } catch (e) {}
    try { const gb = path.join('G:/VIEC_BACKUP', 'orders', orderId + '.json'); fs.mkdirSync(path.dirname(gb), { recursive: true }); fs.copyFileSync(file, gb); } catch (e) {}
    res.writeHead(201, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, order }));
  });
}

function handlePayStart(req, res) {
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 8192) req.destroy(); });
  req.on('end', () => {
    // Per-order async mutex (bấm đồng thời / mất kết nối): serialize issue/redeem/persist for the same
    // order so two concurrent /payment/start can't both mint/issue a payment. The mutex is a map-entry +
    // promise chain; the second caller awaits the first, then re-reads the persisted attempt and reuses
    // it. This is what makes the "CONCURRENT pay-start x4" route check pass (no race duplicate).
    return payStartMutex(orderIdFromBody(raw), () => handlePayStartInner(req, res, raw));
  });
}

let _payLocks = new Map();
function payStartMutex(orderId, action) {
  const prev = _payLocks.get(orderId) || Promise.resolve();
  const next = prev.then(action);
  _payLocks.set(orderId, next);
  // release the map entry after the chain settles
  const clear = () => { if (_payLocks.get(orderId) === next) _payLocks.delete(orderId); };
  next.then(clear, clear);
  return next;
}
function orderIdFromBody(raw) {
  try { const b = JSON.parse(raw || '{}'); return String(b.orderId || b.orderCode || '').trim(); } catch (e) { return ''; }
}

async function handlePayStartInner(req, res, raw) {
  try {
    let body; try { body = JSON.parse(raw || '{}'); } catch (e) { return fail400(res, 'BAD_REQUEST', 'body not json', 0); }
    const orderId = String(body.orderId || body.orderCode || '').trim();
    if (!/^MJ[0-9a-z]+$/.test(orderId)) return fail400(res, 'BAD_ID', 'orderId invalid', 0);
    const g = await requireVerifiedCustomer(req).catch(() => ({ ok: false, status: 401, error: 'AUTH_REQUIRED' }));
    if (!g.ok) { res.writeHead(g.status, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: g.error })); }
    const order = payment.readOrderSafe(orderId);
    if (!order || !order.id) return fail400(res, 'ORDER_NOT_FOUND', 'no order', 0);
    // ownership: order.principalId OR order.customer.id must equal verified customer; never leak another's order
    const ownerId = order.principalId || (order.customer && order.customer.id);
    if (!ownerId || String(ownerId) !== String(g.user.id)) { res.writeHead(403, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: false, error: 'FORBIDDEN' })); }
    if (!order.totalUsdCents || order.currency !== 'USD') return fail400(res, 'NOT_USD_ORDER', 'order not USD', 0);
    const pay = order.payment || {};
    // Idempotency (WEB-PAY): if this order already has a bound NON-terminal attempt with a stored
    // FNOS continue URL, a retry/re-click reuses it — NEVER mints a duplicate payment or re-issues.
    if (pay.attemptId && pay.status && pay.status !== 'paid' && pay.status !== 'cancelled' && pay.status !== 'refunded' && pay.status !== 'failed' && pay.startUrl) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, reused: true, orderId, attemptId: pay.attemptId, startUrl: pay.startUrl, expiresAt: pay.expiresAt || null }));
    }
    // Real service auth is the bot-app web-channel credential (PAYDOLLAR_WEB_SERVICE_TOKEN) gửi qua
    // header x-paydollar-service-token (contract chốt). The web NEVER passes its own session token
    // (contract §B; correction doc §6.3) — paydollar-web.cjs surfaces AUTH_UNAVAILABLE khi thiếu.
    // Web KHÔNG build form PayDollar, KHÔNG redeem, KHÔNG tự ghép BASE/start/token: /issue trả về
    // startUrl (core /start/<token> CONTINUE URL) — web check domain FNOS allowlist rồi dùng ngyuyên vẹn,
    // chuyển khách SANG FNOS top-level SAME-TAB (contract §2 L91-93).
    // idemKey lấy từ đơn đã xác thực (bảng order_idem: idemKey→orderId) — server-verified, không tin client.
    let orderIdemKey = '';
    try { const dbI = require('better-sqlite3')(AUTH_LIB.DB_PATH); const rw = dbI.prepare('SELECT idemKey FROM order_idem WHERE orderId=?').get(orderId); orderIdemKey = (rw && rw.idemKey) || ''; dbI.close(); } catch (e) {}
    const issued = await PAYDOLLAR.startUrl({
      orderCode: orderId,
      orderId,
      principalId: String(g.user.id),
      totalMinor: order.totalUsdCents,
      currency: order.currency || 'USD',
      idemKey: orderIdemKey,
    });
    if (issued.status !== 200 || !issued.json || !issued.json.startUrl) {
      res.writeHead((issued.json && (issued.json.error === 'PAYDOLLAR_ENABLED_OFF' || issued.json.error === 'PAYDOLLAR_AUTH_UNAVAILABLE')) ? 503 : ((issued.json && (issued.json.error === 'START_URL_DOMAIN_REJECTED')) ? 502 : 502), { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(JSON.stringify({ ok: false, error: (issued.json && issued.json.error) || 'ISSUE_FAILED', detail: (issued.json && (issued.json.detail || issued.json.error)) || '', code: issued.status }));
    }
    // bind attempt + persist the backend-returned startUrl so a retry reuses it (idempotent), not re-issue.
    order.payment = order.payment || {};
    if (issued.json.attemptId) order.payment.attemptId = issued.json.attemptId;
    order.payment.status = order.payment.status || 'pending';
    order.payment.startToken = issued.json.startToken || null;
    order.payment.startUrl = issued.json.startUrl;   //nguyên backend, đã check domain FNOS
    order.payment.expiresAt = issued.json.startTokenExpiresAt || issued.json.expiresAt || null;
    order.payment.startedAt = new Date().toISOString();
    payment.writeOrderSafe(orderId, order);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, orderId, attemptId: issued.json.attemptId || null, startUrl: issued.json.startUrl, expiresAt: issued.json.startTokenExpiresAt || issued.json.expiresAt || null }));
  } catch (e) {
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'UPSTREAM_ERROR', detail: String(e.message || e) }));
  }
}

/* ---------------- WEB-PAY-02 adapter routes (SHARED_PAYMENT_CONTRACT v1.0.0) ----------------
   1) POST /payment/datafeed — PayDollar server-to-server settlement. Signed hash, amount/currency
      hash_equals vs attempt, idempotent on fingerprint, state machine paid/failed/on-hold.
      Secret resolved per merchant from LOCAL test-only store (NO deploy, NO real charge) -> 503 unset.
   2) GET  /payment/return — browser-return UX: redirect to order status page. NOT a settlement signal.
   3) GET  /api/order/:id/payment-status — status polling (client polls AFTER return). */
function resolveDfSecret(merchantId, secretId) {
  // local TEST-ONLY store. Production secret config is owner-gated (never hardcoded here).
  try {
    const f = path.join(__dirname, 'data', 'df_secrets.local.json');
    if (!fs.existsSync(f)) return null;
    const store = JSON.parse(fs.readFileSync(f, 'utf8'));
    const rec = store[merchantId] && store[merchantId].secrets;
    if (!rec) return null;
    // secretId is PAYDOLLAR 1-based; array stored 0-based -> rec[Number-1]
    const key = String(secretId);
    if (rec[key]) return rec[key];
    if (Array.isArray(rec)) {
      const i = Number(key) - 1;            // 1-based -> 0-based
      if (rec[i] != null) return String(rec[i]);
      if (rec[Number(key)] != null) return String(rec[Number(key)]); // tolerate direct index
    }
    return null;
  } catch (e) { return null; }
}

function handlePaymentDatafeedInert(req, res) {
  // Correction §R6.2: INERT/ISOLATED. This legacy provider-callback verifier does NOT advance
  // a web order to paid. It validates structure only (so existing fixtures still observe the
  // protocol), records a durable reconcile/audit note, and returns that settlement is via core.
  // The authoritative web projection is updated ONLY by POST /api/ns/web/core/events.
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 65536) req.destroy(); });
  req.on('end', () => {
    let p;
    try { p = JSON.parse(raw || '{}'); } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok:false, error:'BAD_REQUEST' })); return;
    }
    if (typeof p.src !== 'string' || typeof p.Ref !== 'string' || !p.Ref.startsWith('MJ')) {
      res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok:false, error:'UNKNOWN' })); return;
    }
    const attempt = payment.findAttemptByRef(p.Ref);
    if (!attempt) { res.writeHead(409, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok:false, error:'MISMATCH' })); return; }
    // structural verify only — never settle from this path. Record durable audit.
    const order = payment.readOrderSafe(attempt.orderId);
    payment.recordReconcile(order, attempt, p, 'datafeed-inert-no-settle');
    // Return 200-OK to stop provider retries, but clearly mark settlement is NOT applied here.
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('OK (received; web settlement pending authoritative core event)');
  });
}

function handleCoreEventIngress(req, res) {
  // Correction §R6.2: the ONLY path that advances a web order projection. Consumes
  // AUTHENTICATED, namespace-bound CORE events (durable eventId) idempotently.
  // This endpoint is NOT customer-facing: it must present a verified delivery credential —
  // EITHER the §G signed backend outbox envelope (x-event-signature HMAC, authoritative for
  // the PayDollar OUTBOX delivery) OR the shared core-delivery bearer token (legacy/test).
  let raw = '';
  req.on('data', c => { raw += c; if (raw.length > 65536) req.destroy(); });
  req.on('end', () => {
    let ev;
    try { ev = JSON.parse(raw || '{}'); } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok:false, error:'BAD_REQUEST' })); return;
    }
    // §G envelope auth: x-event-signature = "sha256=" + HMAC-SHA256(PAYDOLLAR_WEB_EVENT_KEY, raw body).
    // Verifies over the SAME raw bytes the backend signed (canonical payload JSON) — constant-time.
    const sigHeader = String(req.headers['x-event-signature'] || '');
    if (sigHeader) {
      const key = process.env.PAYDOLLAR_WEB_EVENT_KEY;
      if (!key) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok:false, error:'WEB_EVENT_KEY_UNSET', dependency:'PAYDOLLAR_WEB_EVENT_KEY (owner-gated)' })); return;
      }
      const expected = 'sha256=' + crypto.createHmac('sha256', key).update(raw).digest('hex');
      const a = Buffer.from(sigHeader), b = Buffer.from(expected);
      const valid = /^sha256=[0-9a-f]{64}$/i.test(sigHeader) && a.length === b.length && crypto.timingSafeEqual(a, b);
      if (!valid) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok:false, error:'UNAUTHENTICATED' })); return; }
      // (1) NAMESPACE GATE (co-van verified, independent): this inbox is the WEB-lane
      // consumer. Sender stamps the web lane namespace MANDARIN_WEB
      // (PAYDOLLAR_NAMESPACES: WEB_MANDARINJAM -> MANDARIN_WEB). Wrong or missing
      // namespace = not our lane -> reject BEFORE any data conversion. A signed
      // envelope only proves authenticity, not lane ownership.
      if (ev.namespace !== 'MANDARIN_WEB') {
        res.writeHead(422, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok:false, error:'UNRECOGNIZED_NAMESPACE', expected:'MANDARIN_WEB', got: String(ev.namespace != null ? ev.namespace : '(missing)') })); return;
      }
      // (2) START_REDEEMED (co-van verified, revised): a durable redeem fact, NOT a settlement.
      // Store it durably (reconcile journal) and ACK 2xx — BUT ONLY if the save actually
      // succeeded. A save failure returns 5xx so the backend sees not-delivered and retries.
      // Same eventId is never written twice (idempotent dedupe). Never set paid.
      if (ev.outcome === 'START_REDEEMED') {
        const o = payment.readOrderSafe(String(ev.orderCode || ''));
        const eventId = String(ev.eventId || '');
        // Idempotent dedupe: a START_REDEEMED record already persisted for this eventId
        // means we already acked it -> acknowledge again without re-writing.
        let already = false;
        if (eventId && fs.existsSync(payment.RECON_DIR)) {
          try {
            for (const fn of fs.readdirSync(payment.RECON_DIR)) {
              if (!fn.endsWith('.json')) continue;
              try {
                const j = JSON.parse(fs.readFileSync(path.join(payment.RECON_DIR, fn), 'utf8'));
                if (j && j.reason === 'START_REDEEMED' && String(j.eventId) === eventId) { already = true; break; }
              } catch (e) {}
            }
          } catch (e) {}
        }
        if (already) {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok:true, recorded:'START_REDEEMED', idempotent:true, note:'redeem fact already stored (same eventId)' })); return;
        }
        // Durable save: success -> 2xx (backend marks DELIVERED); failure -> 5xx (backend retries).
        const f = payment.recordReconcile(o || null, null, ev, 'START_REDEEMED');
        if (!f) {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok:false, error:'STORE_FAILED', retryable:true, note:'START_REDEEMED not persisted; sender should retry' })); return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok:true, recorded:'START_REDEEMED', idempotent:false, note:'redeem fact stored, not a settlement' })); return;
      }
      // Adapter-shape (backend ORDER_PAID payload) -> core-event shape for applyCoreEvent.
      const mappedOutcome =
        (ev.outcome === 'APPROVED' && ev.handling === 'SETTLED') ? 'paid'
        : (ev.outcome === 'DECLINED' || ev.outcome === 'FAILED') ? 'failed'
        : null;
      if (mappedOutcome === null) { res.writeHead(422, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok:false, error:'UNRECOGNIZED_OUTCOME' })); return; }
      ev = {
        eventId: ev.eventId, namespace: payment.NS, orderId: ev.orderCode,
        principalId: ev.principalId, attemptId: ev.attemptId, payref: ev.payRef,
        amount: ev.amountMinor, currency: ev.currency || ev.currencyCode,
        outcome: mappedOutcome, paidAt: ev.paidAt,
      };
    } else {
      // Legacy auth: shared core-delivery bearer token (NOT the customer session, NOT provider secret).
      const expected = process.env.MJ_CORE_DELIVERY_TOKEN;
      const auth = String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
      if (!expected) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok:false, error:'CORE_DELIVERY_TOKEN_UNSET', dependency:'MJ_CORE_DELIVERY_TOKEN (owner-gated)' })); return;
      }
      if (!auth || auth !== expected) {
        res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok:false, error:'UNAUTHENTICATED' })); return;
      }
    }
    const r = payment.applyCoreEvent(ev);
    res.writeHead(r.code, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: r.ok, error: r.error || null, idempotent: !!r.idempotent }));
  });
}

function handlePaymentReturn(req, res) {
  const u = url.parse(req.url, true);
  const ref = String(u.query.Ref || '');
  // Naked Ref / arbitrary orderId CANNOT substitute (correction §R6.4). FNOS validates the
  // stored attempt's return state; the web return issues a SHORT-LIVED, OWNER-BOUND, single-use
  // ticket to the status page. Return alone NEVER sets paid (settlement only via core events).
  if (!ref || !ref.startsWith('MJ')) {
    res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'BAD_REF' })); return;
  }
  const attempt = payment.findAttemptByRef(ref);
  if (!attempt || !attempt.orderId) {
    res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'UNKNOWN' })); return;
  }
  const orderId = attempt.orderId;
  const order = payment.readOrderSafe(orderId);
  if (!order) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'UNKNOWN' })); return; }
  // Owner-bound (correction R2): a raw Ref must NOT mint viewing authority. Require a VERIFIED
  // Mandarin owner (actual server session result, not a caller header). No null-owner fallback.
  // Canonical ownership = principalId OR customer.id (customer.id-owned records are NOT an
  // unowned fallback). Missing auth enters the existing sign-in recovery path WITHOUT consuming
  // the handoff, then revalidates owner/state on return.
  (async () => {
    const g = await requireVerifiedCustomer(req).catch(() => ({ ok: false, status: 401, error: 'AUTH_REQUIRED' }));
    const user = (g && g.ok) ? g.user : null;
    if (!user || !user.id) {
      // Anonymous: do NOT issue a ticket. Route to the existing sign-in recovery (login modal on
      // the home page), preserving the intended order so the handoff is NOT consumed.
      const next = '/payment/return?Ref=' + encodeURIComponent(ref);
      res.writeHead(303, { location: '/?login=1&next=' + encodeURIComponent(next), 'cache-control': 'no-store' });
      res.end();
      return;
    }
    const principalId = String(user.id);
    // Server-verified session identity (R04): do NOT trust a caller-chosen x-mj-session header.
    const sessionKey = (g && g.sessionKey) || principalId;
    // Canonical owner: principalId OR customer.id. If the order is bound to an owner and the
    // verified session is a DIFFERENT owner, do NOT issue (R02).
    const canOwner = order.principalId || (order.customer && order.customer.id) || null;
    if (canOwner && String(canOwner) !== principalId) {
      res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ error: 'WRONG_OWNER' })); return;
    }
    const ticket = payment.issueReturnTicket({ orderId, principalId, sessionKey });
    if (!ticket.ok) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'TICKET_ISSUE_FAILED' })); return; }
    const target = '/order-status?t=' + encodeURIComponent(ticket.ticket);
    res.writeHead(303, { location: target, 'cache-control': 'no-store' });
    res.end();
  })();
}

function handleTicketStatus(req, res, pathname, query) {
  // Correction §R6.3/§R6.4: a bare ticket resolves to the owner-bound order. OrderId is NOT
  // guessed from the URL; it comes from the redeemed ticket. Minimal customer DTO only.
  const q = query || {};
  const ticketId = String(q.t || '');
  if (!ticketId) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok:false, error:'bad_ticket' })); return; }
  (async () => {
    const g = await requireVerifiedCustomer(req).catch(() => ({ ok: false, status: 401, error: 'AUTH_REQUIRED' }));
    const user = (g && g.ok) ? g.user : null;
    if (!user || !user.id) {
      // Missing auth: do NOT disclose. Route to the existing sign-in recovery (login modal),
      // preserving the ticket so no handoff is consumed.
      const next = '/order-status?t=' + encodeURIComponent(ticketId);
      res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok:false, error:'AUTH_REQUIRED' })); return;
    }
    const redemption = payment.redeemReturnTicket(ticketId, {
      principalId: String(user.id),
      sessionKey: (g && g.sessionKey) || String(user.id)   // server-verified, NOT caller header
    });
    if (!redemption.ok || !redemption.orderId) {
      res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok:false, error:'not_found' })); return;   // no leak
    }
    const order = payment.readOrderSafe(redemption.orderId);
    if (!order) { res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok:false, error:'not_found' })); return; }
    const pay = order.payment || {};
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok:true, order: { id: order.id, status: order.status }, payment: { status: pay.status || 'none' } }));
  })();
}

function handlePaymentStatus(req, res, pathname, query) {
  // Owner-scoped + ticket-bound (correction §R6.3). A naked orderId in the URL is NOT enough:
  // the caller must present a valid unexpired owner-bound ticket OR a verified session that owns
  // the order. Minimal customer DTO only — NO raw provider refs / internal conflict metadata.
  const m = pathname.match(/^\/api\/order\/([^/?]+)\/payment-status$/);
  const orderId = m && m[1];
  if (!orderId || !/^MJ[0-9a-z]+$/.test(orderId)) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'bad_id' })); return; }
  const q = query || {};
  (async () => {
    // 1) Ticket redemption (single-use, expiring, owner-bound).
    const ticketId = String(q.t || '');
    if (ticketId) {
      const g = await requireVerifiedCustomer(req).catch(() => ({ ok: false, status: 401, error: 'AUTH_REQUIRED' }));
      const user = (g && g.ok) ? g.user : null;
      if (!user || !user.id) {
        res.writeHead(401, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok: false, error: 'AUTH_REQUIRED' })); return;   // no leak, no consume
      }
      const redemption = payment.redeemReturnTicket(ticketId, {
        principalId: String(user.id),
        sessionKey: (g && g.sessionKey) || String(user.id)   // server-verified, NOT caller header
      });
      if (!redemption.ok || redemption.orderId !== orderId) {
        res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        res.end(JSON.stringify({ ok: false, error: 'not_found' })); return;   // no leak
      }
      const order = payment.readOrderSafe(orderId);
      if (!order) { res.writeHead(404, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'not_found' })); return; }
      const pay = order.payment || {};
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, order: { id: order.id, status: order.status }, payment: { status: pay.status || 'none' } }));
      return;
    }
    // 2) Session-ownership path: verified owner reads the order's minimal state.
    const g = await requireVerifiedCustomer(req).catch(() => ({ ok: false, status: 401 }));
    const user = (g && g.ok) ? g.user : null;
    if (!user) { res.writeHead(g.status || 401, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok: false, error: g.error || 'AUTH_REQUIRED' })); return; }
    const order = payment.readOrderSafe(orderId);
    if (!order) { res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok: false, error: 'not_found' })); return; }
    // ownership: only the verified owner of the order may read payment state
    const own = (order.customer && order.customer.id && String(order.customer.id) === String(user.id)) ||
                (order.principalId && String(order.principalId) === String(user.id));
    if (!own) { res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok: false, error: 'not_found' })); return; }
    const pay = order.payment || {};
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: true, order: { id: order.id, status: order.status }, payment: { status: pay.status || 'none' } }));
  })();
}

const server = http.createServer(async (req, res) => {
  const u = url.parse(req.url, true);
  const clientIp = (req.socket && req.socket.remoteAddress) || '';
  const clientUA = String(req.headers['user-agent'] || '').slice(0, 200);

  // --- ACCOUNT (21/9): Better Auth cho /api/auth/* (send-otp, signin, session, revoke) ---
  // toNodeHandler build Request từ req.url full — basePath /api/auth tự strip. KHÔNG strip tay.
  if (u.pathname === '/api/auth' || u.pathname.startsWith('/api/auth/')) {
    try {
      await authNodeHandler(req, res);
    } catch (e) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'auth_handler_error', detail: String(e.message || e) }));
      } else {
        res.end();
      }
    }
    return;
  }
  // --- ACCOUNT: routes nghiệp vụ (guard verified + registrationComplete) ---
  if (u.pathname === '/api/account/send-otp' && req.method === 'POST') {
      let raw = ''; req.on('data', c => { raw += c; if (raw.length > 4096) req.destroy(); });
      req.on('end', async () => {
        try {
          const b = JSON.parse(raw || '{}');
          const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid_email' })); }
          const rl = rateLimitCheck(email, clientIp);
          if (!rl.ok) { res.writeHead(429, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'rate_limited', reason: rl.reason, retryInSec: rl.retryInSec || null })); }
          rateLimitRecord(email, clientIp);
                    // Better Auth 1.7.5: sendVerificationOTP({ body, asNewUser }) — KHÔNG phải requestVerificationOtp
                    const r = await mjAuth.api.sendVerificationOTP({ body: { email, type: 'sign-in' }, asNewUser: true }, { headers: req.headers, ip: clientIp, ua: clientUA });
          res.writeHead(r.status || 200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ ok: true, email, expiresInSeconds: 600 }));
        } catch (e) { res.writeHead(e.statusCode || 400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'otp_failed', detail: String(e.message || e) })); }
      });
      return;
    }
    if (u.pathname === '/api/account/signin-otp' && req.method === 'POST') {
      let raw = ''; req.on('data', c => { raw += c; if (raw.length > 4096) req.destroy(); });
      req.on('end', async () => {
        try {
          const b = JSON.parse(raw || '{}');
          const email = String(b.email || '').trim().toLowerCase().slice(0, 120);
          const code = String(b.otp || '').trim().slice(0, 8);
          if (!email || !/^[0-9]{6}$/.test(code)) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'bad_input' })); }
          const r = await mjAuth.api.signInEmailOTP({ body: { email, otp: code } }, { headers: req.headers, ip: clientIp, ua: clientUA });
                    // 1.7.5: r = { token, user } trực tiếp (không r.headers). Set session cookie mj_auth_session.
                    const tk = r.token || (r.body && r.body.token);
                    const ck = tk ? ['mj_auth_session=' + tk + '; Path=/; HttpOnly; SameSite=Lax' + (process.env.MJ_COOKIE_SECURE === '1' ? '; Secure' : '')] : ['mj_auth_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax'];
                    res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': ck });
                    const uu = r.user || (r.body && r.body.user);
                    res.end(JSON.stringify({ ok: true, token: tk || null, user: uu ? { id: uu.id, email: uu.email, emailVerified: !!uu.emailVerified, registrationComplete: !!uu.registrationComplete, termsVersion: uu.termsVersion || null } : null }));
        } catch (e) { res.writeHead(e.statusCode || 401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'invalid_otp', detail: String(e.message || e) })); }
      });
      return;
    }
  if (u.pathname === '/api/account/me' && req.method === 'GET') {
    try {
      const session = await mjAuth.api.getSession({ headers: req.headers });
      if (!session || !session.user) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'no_session' })); }
      const us = session.user;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, user: { id: us.id, email: us.email, emailVerified: !!us.emailVerified, registrationComplete: !!us.registrationComplete, termsVersion: us.termsVersion || null }, termsVersion: termsVersion() }));
    } catch (e) { res.writeHead(401, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'no_session' })); }
    return;
  }
  if (u.pathname === '/api/account/complete' && req.method === 'POST') {
    try {
      const r = await handleAccountComplete(req, { ip: clientIp });
      res.writeHead(r.status || 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify(r.body || { error: 'complete_failed' }));
    } catch (e) { res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'complete_failed' })); }
    return;
  }
  if (u.pathname === '/api/account/logout' && req.method === 'POST') {
    // Đọc session từ signed cookie -> lấy token -> revoke -> clear cookie better-auth.session_token.
    // KHÔNG tự build cookie mj_auth_session (tên cookie thật là better-auth.session_token).
    try {
      let token = null;
      try {
        const sess = await mjAuth.api.getSession({ headers: req.headers });
        token = (sess && sess.session && sess.session.token) || null;
      } catch (e) { token = null; }
      if (token) { try { await mjAuth.api.revokeSession({ headers: req.headers, body: { token } }); } catch (e) {} }
      res.writeHead(200, { 'content-type': 'application/json',
        'set-cookie': 'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(200, { 'content-type': 'application/json',
        'set-cookie': 'better-auth.session_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax' });
      res.end(JSON.stringify({ ok: true }));
    }
    return;
  }

  // --- V2 bridge routes (20/9): shopv2 list + PDP intercept cho productId store B ---
    if (u.pathname === '/api/shopv2/config') { await handleShopV2Config(res); return; }
    if (u.pathname === '/api/shopv2') { await handleShopV2(u.query, res); return; }
  // --- USD QUOTE (WEB-PAY-01): POST /api/checkout/quote — read-only, idempotent ---
  if (u.pathname === '/api/checkout/quote' && req.method === 'POST') { return handleQuote(req, res); }
  // WEB-PAY-02 adapter routes
  // Correction §R6.2: the customer-facing website does NOT independently settle from a raw
  // provider callback. The legacy /payment/datafeed verifier is isolated/inert for fixtures;
  // the live customer settlement path consumes AUTHENTICATED core events via /api/ns/web/core/events.
  // Hypothesis/expectation (correction §R2 step 6): the public web-only synthetic callback must be
  // REMOVED from the normal route and isolated as FIXTURE-ONLY. It must neither create
  // unauthenticated reconciliation records nor ACK unprocessed provider funds merely to stop retries.
  // It is only reachable when MJ_FIXTURE_ONLY=1 (isolated tests); in normal operation it 404s.
  if (u.pathname === '/payment/datafeed' && req.method === 'POST') {
    if (process.env.MJ_FIXTURE_ONLY !== '1') {
      res.writeHead(404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok:false, error:'NOT_FOUND' })); return;
    }
    return handlePaymentDatafeedInert(req, res);
  }
  if (u.pathname === '/payment/return' && req.method === 'GET') { return handlePaymentReturn(req, res); }
  if (u.pathname === '/api/ns/web/core/events' && req.method === 'POST') { return handleCoreEventIngress(req, res); }
  if (/^\/api\/order\/[^\/?]+\/payment-status$/.test(u.pathname) && req.method === 'GET') { return handlePaymentStatus(req, res, u.pathname, u.query); }
  if (u.pathname === '/api/payment/status' && req.method === 'GET') { return handleTicketStatus(req, res, u.pathname, u.query); }
  const mV2Pdp = u.pathname.match(/^\/api\/src\/products\/([^/?]+)/);
  if (mV2Pdp && V2_ID_RE.test(decodeURIComponent(mV2Pdp[1]))) { await handleV2Pdp(decodeURIComponent(mV2Pdp[1]), res); return; }
  // --- proxy nguồn hàng (payload API, rewrite URL ảnh -> /img/*) ---
  if (u.pathname.startsWith('/api/src/')) {
    const sub = req.url.slice('/api/src/'.length); // giữ cả query string: products?size=24&page=1
    const target = SOURCE_BASE + '/shadow/api/' + sub;
    const ttl = u.pathname.startsWith('/api/src/products/') ? 5 * 60 * 1000 : 60 * 1000;
    try {
      let body = await cachedGet(target, ttl);
      // W2.3: inject bản dịch VI/EN/KO (nếu có trong catalog lô 1) vào PDP hoặc list
      const mP = u.pathname.match(/^\/api\/src\/products\/([^/?]+)/);
      if (mP) {
        let spuId;
        try { spuId = decodeURIComponent(mP[1]); } catch (e) { spuId = mP[1]; }
        body = injectI18n(body, spuId);
      } else if (/\/api\/src\/products$/.test(u.pathname) || u.pathname === '/api/src/products') {
        body = injectListI18n(body);
      }
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(rewriteImageUrls(body));
    } catch (e) {
      res.writeHead(502, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'source_unavailable', detail: String(e.message || e) }));
    }
    return;
  }
  // --- image proxy (W1.2) — hash-only path, URL nguồn nằm trong registry server-side ---
  // --- W3.2: order server-side API (object đơn, giá chốt §7.1 server, lưu file atomic+backup) ---
  // --- USD ORDER (WEB-PAY-01/03): POST /api/order/usd — verified customer, server-quote, USD ---
  if (u.pathname === '/api/order/usd' && req.method === 'POST') { return handleCreateUsdOrder(req, res); }
  // --- PAY-START adapter (SHARED_PAYMENT_CONTRACT §B): POST /api/payment/start ---
  // Web does NOT settle. It asks the core to /issue + /start/:token/redeem (channel=WEB_MANDARINJAM),
  // then hands the returned PayDollar form back to the client for auto-submit. Truthful when the
  // backend contract API is not yet mounted (PAYDOLLAR_ENABLED_OFF) — no fabricated settlement.
  if (u.pathname === '/api/payment/start' && req.method === 'POST') { return handlePayStart(req, res); }
  if (u.pathname === '/api/order' && req.method === 'POST') {
    return handleCreateOrder(req, res);
  }
  if (u.pathname.startsWith('/api/order/')) {
      return handleGetOrder(req, u.pathname, res);
    }
  if (u.pathname === '/api/promo/validate' && req.method === 'POST') {
    // W5.5: validate mã ưu đãi — OK + discount, hoặc 400 + detail
    let raw = ''; req.on('data', c => { raw += c; if (raw.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const b = JSON.parse(raw || '{}');
        const code = String(b.code || '').trim().toUpperCase();
        if (code !== 'MJWEB5') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'invalid_code', detail: 'Không có mã ưu đãi này.' })); }
        // dùng 1 lần
        let used = false;
        try { const dir = path.join(__dirname, 'data', 'orders'); for (const f of fs.readdirSync(dir)) { if (!f.endsWith('.json')) continue; try { const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (o.promo && o.promo.code === 'MJWEB5') { used = true; break; } } catch (e) {} } } catch (e) {}
        if (used) { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error: 'code_used', detail: 'Mã MJWEB5 đã được dùng cho một đơn trước đó.' })); }
        const total = Number(b.total_vi) || 0;
        const discount_vi = Math.round(total * 0.05);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, code, pct: 5, discount_vi }));
      } catch (e) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'bad', detail: String(e.message || e) })); }
    });
    return;
  }
  // W5.6: ghi sự kiện funnel (session/pdp/cart/place/order) kèm UTM, atomic JSONL theo ngày
  const timeDayFile = () => new Date().toISOString().slice(0, 10);
  if (u.pathname === '/api/track' && req.method === 'POST') {
    let raw = ''; req.on('data', c => { raw += c; if (raw.length > 4096) req.destroy(); });
    req.on('end', () => {
      try {
        const b = JSON.parse(raw || '{}');
        const evDir = path.join(__dirname, 'data', 'events');
        if (!fs.existsSync(evDir)) fs.mkdirSync(evDir, { recursive: true });
        const evFile = path.join(evDir, timeDayFile() + '.jsonl');
        const rec = { ts: Date.now(), iso: new Date().toISOString(), type: String(b.type || 'session'), sid: String(b.sid || 'anon').slice(0, 40),
          utm: b.utm && typeof b.utm === 'object' ? { source: String(b.utm.source || '').slice(0, 40), medium: String(b.utm.medium || '').slice(0, 20), campaign: String(b.utm.campaign || '').slice(0, 40) } : null,
          spuId: b.spuId ? String(b.spuId).slice(0, 20) : undefined, orderId: b.orderId ? String(b.orderId).slice(0, 30) : undefined };
        const line = JSON.stringify(rec) + '\n';
        fs.appendFileSync(evFile, line, 'utf8');          // atomic-ish: append
        try { const bk = path.join('G:/VIEC_BACKUP', 'events'); if (!fs.existsSync(bk)) fs.mkdirSync(bk, { recursive: true }); fs.appendFileSync(path.join(bk, timeDayFile() + '.jsonl'), line, 'utf8'); } catch (e) {}
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true }));
      } catch (e) { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'bad' })); }
    });
    return;
  }
  // W5.6: dashboard 1 trang — số thật từ orders + events
  if (u.pathname === '/api/dashboard') {
    try {
      const evDir = path.join(__dirname, 'data', 'events');
      const events = [];
      try { if (fs.existsSync(evDir)) for (const f of fs.readdirSync(evDir)) { if (!f.endsWith('.jsonl')) continue; for (const l of fs.readFileSync(path.join(evDir, f), 'utf8').split('\n')) { if (!l.trim()) continue; try { events.push(JSON.parse(l)); } catch (e) {} } } } catch (e) {}
      const ordDir = path.join(__dirname, 'data', 'orders');
      const orders = [];
      try { if (fs.existsSync(ordDir)) for (const f of fs.readdirSync(ordDir)) { if (!f.endsWith('.json')) continue; try { orders.push(JSON.parse(fs.readFileSync(path.join(ordDir, f), 'utf8'))); } catch (e) {} } } catch (e) {}
      const webOrders = orders.filter(o => o.id);
      const socialOrders = orders.filter(o => o.utm && o.utm.source);
      const sessions = events.filter(e => e.type === 'session').length;
      const pdp = events.filter(e => e.type === 'pdp').length;
      const carts = events.filter(e => e.type === 'cart').length;
      const places = events.filter(e => e.type === 'place').length;
      const total = webOrders.reduce((s, o) => s + (o.total_vi || 0), 0);
      const aov = webOrders.length ? Math.round(total / webOrders.length) : 0;
      // dau nguon per order
      const bySource = {};
      for (const o of socialOrders) { const s = (o.utm && o.utm.source) || 'khac'; bySource[s] = (bySource[s] || 0) + 1; }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        orders: webOrders.length, socialOrders: socialOrders.length, pctSocial: webOrders.length ? Math.round(socialOrders.length / webOrders.length * 100) : 0,
        sessions, pdp, carts, places,
        conversion: sessions ? +(webOrders.length / sessions * 100).toFixed(1) : 0,
        total_vi: total, aov, avgItemsPerSession: sessions ? +(pdp / sessions).toFixed(1) : 0,
        bySource, sampleEvents: events.slice(-5)
      }));
    } catch (e) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: String(e.message || e) })); }
    return;
  }
  if (u.pathname === '/api/shop') {
    // STOREFRONT 4B/4E/4F: catalog lô 1 (280 SPU) + sidecar metadata (department/skuIds) đọc read-only.
    // Search: brand token / name 4-locale normalize / mã-shop exact SPU (MJ- prefix) / SKU exact variantId.
    let list = ensureLot1();
    const meta = loadShopMetadata().records || {};
    const q = String(u.query.q || '').trim();
    const brand = String(u.query.brand || '').trim();
    const cat = String(u.query.cat || '').trim();
    const department = String(u.query.department || '').trim();
    const sort = String(u.query.sort || 'default');
    const minP = u.query.minPrice !== undefined && u.query.minPrice !== '' ? Number(u.query.minPrice) : null;
    const maxP = u.query.maxPrice !== undefined && u.query.maxPrice !== '' ? Number(u.query.maxPrice) : null;
    // department filter (sidecar) — men/women/kids; unisex người lớn xuất trong men & women
    if (department) {
      const validDept = ['men','women','kids'].includes(department);
      list = list.filter(x => {
        if (!validDept) return true;
        const m = meta[String(x.spuId)] || {};
        const dep = m.department;
        if (dep === department) return true;
        if (department !== 'kids' && dep === 'unisex') return true;  // unisex trong men/women
        return false;
      });
    }
    // SKU index: SPU -> skuIds (từ sidecar). Exact variant match ưu tiên.
    let skuMatched = new Set();
    if (q) {
      const ql = q.toLowerCase().trim();
      const norm = (s) => String(s || '').toLowerCase().trim().replace(/\s+/g, ' ');
      const qn = norm(ql);
      // 1) exact SKU (variantId) — mapping thật từ sidecar
      for (const spuId of Object.keys(meta)) {
        if ((meta[spuId].skuIds || []).includes(q) || (meta[spuId].skuIds || []).includes(ql)) skuMatched.add(String(spuId));
      }
      // 2) exact SPU code (MJ-34422653 hoặc 34422653)
      const spuExact = /^MJ-?(\d+)$/i.test(ql) ? ql.replace(/^MJ-?/i, '') : (/^\d+$/.test(ql) ? ql : null);
      const bySpu = spuExact ? list.filter(x => String(x.spuId) === spuExact) : [];
      if (bySpu.length) {
        const spuSet = new Set(bySpu.map(x => String(x.spuId)));
        skuMatched.forEach(s => spuSet.add(s));
        list = list.filter(x => spuSet.has(String(x.spuId)));
      } else if (skuMatched.size) {
        list = list.filter(x => skuMatched.has(String(x.spuId)));
      } else {
        // 3) name 4-locale (normalize unicode, token AND) + brand exact token
        const tok = qn.split(/\s+/).filter(Boolean).map(tk => norm(tk));
        list = list.filter(x => {
          const hay = norm([x.brand, x.name_vi, x.name_en, x.name_zh, x.name_ko].join(' '));
          return tok.every(t => hay.includes(t));
        });
      }
    }
    if (brand) list = list.filter(x => x.brand === brand);
    if (cat) list = list.filter(x => (x.category || '') === cat);
    if (minP != null) list = list.filter(x => x.price_vi >= minP);
    if (maxP != null) list = list.filter(x => x.price_vi <= maxP);
    if (sort === 'priceAsc') list = [...list].sort((a, b) => a.price_vi - b.price_vi || Number(a.spuId) - Number(b.spuId));
    else if (sort === 'priceDesc') list = [...list].sort((a, b) => b.price_vi - a.price_vi || Number(b.spuId) - Number(a.spuId));
    const total = list.length;
    const limit = Math.min(Number(u.query.limit) || 24, 280);
    const offset = Math.max(Number(u.query.offset) || 0, 0);
    const items = list.slice(offset, offset + limit).map(x => ({ ...x, department: (meta[String(x.spuId)] || {}).department || null }));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ total, offset, limit, items, matchedSku: (skuMatched && skuMatched.size) ? q : null }));
    return;
  }
  if (u.pathname === '/api/shop/cats') {
    // W5.2: danh sách danh mục (tiếng Việt) duy nhất trong lô 1 để build dropdown lọc
    const cats = {};
    for (const x of ensureLot1()) if (x.category) cats[x.category] = true;
    const arr = Object.keys(cats).sort((a, b) => a.localeCompare(b, 'vi'));
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ categories: arr }));
    return;
  }

  if (u.pathname === '/api/shop/metadata-status') {
    // STOREFRONT 4B: coverage department/SKU read-only cho QA — không lộ raw supplier/provenance URL
    const meta = loadShopMetadata();
    const recs = meta.records || {};
    let skuWith = 0, conflicts = 0;
    const seenSku = {};
    for (const sid of Object.keys(recs)) {
      const r = recs[sid];
      if ((r.skuIds || []).length) skuWith++;
      for (const s of (r.skuIds || [])) {
        if (seenSku[s] && seenSku[s] !== sid) conflicts++;
        seenSku[s] = sid;
      }
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ coverage: meta.coverage, skuCoverage: { withSku: skuWith, total: Object.keys(recs).length }, skuConflicts: conflicts, catalogHash: meta.catalogHash, generatedAt: meta.generatedAt }));
    return;
  }
  if (u.pathname.startsWith('/img/')) {
    const m = u.pathname.match(/^\/img\/([a-f0-9]{40})$/);
    if (!m) {
      res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'bad_img_path' })); return;
    }
    serveImage(res, m[1]);
    return;
  }
  if (u.pathname === '/api/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  // --- static (SPA: mọi route không phải file -> index.html) ---
    // WEB-PAY-03: /order-status là trang return riêng (không phải SPA index)
    if (u.pathname === '/order-status') { serveFile(res, path.join(ROOT, 'order-status.html')); return; }
    let p = u.pathname === '/' ? '/index.html' : u.pathname;
    const clean = path.normalize(p).replace(/^([.][.][/\\])+/g, '');
    const abs = path.join(ROOT, clean);
    if (!abs.startsWith(ROOT)) { res.writeHead(403); res.end('403'); return; }
    const lastSeg = clean.split('/').pop() || '';
    fs.stat(abs, (err, st) => {
      if (!err && st.isFile()) { serveFile(res, abs); return; }
      // Path có dạng file thật (chứa dấu chấm) mà không tồn tại -> 404,
      // KHÔNG fallback SPA (W1.5: chống URL ghost kiểu /app.js.bak-* trả 200).
      if (lastSeg.includes('.')) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('404'); return; }
      // W2.5: chỉ fallback SPA cho các route hợp lệ; còn lại -> 404 THẬT (không ghost 200)
      // dùng u.pathname (dạng POSIX /foo) — clean có thể là \foo trên Windows sau path.normalize
      const routePath = u.pathname.replace(/\/+$/, '');
      const isLegalRoute = /(?:^\/product\/\d+|^\/shop$|^\/about$|^\/cart$|^\/checkout$|^\/order-request$|^\/dashboard$|^\/order\/[A-Za-z0-9]+|^\/legal$|^\/legal\/[a-z0-9\-]+)/.test(routePath);
      const isHome = routePath === '' || routePath === '/' || routePath === '/index.html';
      if (isHome || isLegalRoute) { serveFile(res, path.join(ROOT, 'index.html')); return; }
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="robots" content="noindex"><title>404 — Không tìm thấy</title><style>body{font-family:sans-serif;background:#fff;color:#222;display:flex;height:100vh;align-items:center;justify-content:center;margin:0}.w{text-align:center}.a{font-size:80px;line-height:1}.h{margin:12px 0 6px;font-size:26px}p{color:#666}.b{display:inline-block;margin-top:18px;padding:12px 22px;background:#f37a3d;color:#fff;text-decoration:none;border-radius:10px}</style></head><body><div class="w"><div class="a">404</div><div class="h">Trang không tồn tại</div><p>Đường dẫn này không có trên Mandarin Jam.</p><a class="b" href="/">Về trang chủ</a></div></body></html>');
    });
});

server.listen(PORT, process.env.MJ_BIND || '0.0.0.0', () => {
  console.log('mandarinjam (bound ' + (process.env.MJ_BIND || '0.0.0.0') + '): http://localhost:' + PORT);
});