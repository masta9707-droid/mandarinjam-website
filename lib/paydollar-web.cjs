'use strict';
// PAYDOLLAR-WEB CONSUMER CLIENT (contract CHOT — nối đúng API bot app hiện tại)
// API (backend bot app, api.dev.manjaglobal.com):
//   POST /api/v1/payment/paydollar/web/issue   body {principalId, orderCode, totalMinor, currency, idemKey}
//   GET  /api/v1/payment/paydollar/web/status/:orderCode
//   Header: x-paydollar-service-token: <service credential do bot app cấp cho kênh WEB_MANDARINJAM>
// The web is a CONSUMER: nó KHÔNG self-assemble BASE/start/<token>, KHÔNG ghi đè startUrl, KHÔNG build
// form PayDollar, KHÔNG gọi redeem. Nó:
//   (1) tạo USD order server-quote (name+SKU locked) — caller của file này,
//   (2) POST /issue với đủ field từ đơn đã xác thực trên server,
//   (3) dùng startUrl backend trả về — SAU KHI kiểm tra đúng domain FNOS (allowlist) — làm top-level
//       SAME-TAB continue URL; web KHÔNG tự ghép hay thay thế startUrl,
//   (4) GET /status/:orderCode (service auth) + consume sự kiện PAYDOLLAR_ORDER_PAID.
//
// Module core FLAG-GATED (PAYDOLLAR_ENABLED / PAYDOLLAR_ISSUANCE_ENABLED default OFF): route 404 khi OFF.
// Client surfaçe thật (PAYDOLLAR_ENABLED_OFF) thay vì bịa settlement.

const https = require('https');
const crypto = require('crypto');
const urlmod = require('url');

const BASE = process.env.PAYDOLLAR_CONSUMER_BASE ||
  'https://api.dev.manjaglobal.com/api/v1/payment/paydollar/web';
const CHANNEL = 'WEB_MANDARINJAM';

// FNOS domain allowlist — web chỉ follow startUrl trỏ tới đúng domain FNOS (core continue page).
// Owner 21/09: CHỈ HTTPS FNOS. KHÔNG đưa BASE host (api.dev.manjaglobal.com) vào allowlist —
// khách không được redirect về api.dev (core), chỉ tới FNOS continue (fnosofficial.com).
// Định nghĩa qua env; default = fnosofficial.com + www. MOCK: fixture host (test-only).
const FNOS_ALLOW = (process.env.PAYDOLLAR_FNOS_ALLOW || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
function fnosAllowlist() {
  if (FNOS_ALLOW.length) return FNOS_ALLOW;
  const base = [];
  base.push('fnosofficial.com', 'www.fnosofficial.com');
  if (MOCK) { try { const mh = urlmod.parse(MOCK_CONTINUE_BASE).hostname || ''; if (mh) base.unshift(mh); } catch (e) {} }
  return base;
}

// Test-only fixture transport (NO production effect; NO_REAL_CHARGE). Enabled ONLY when PAYDOLLAR_MOCK=1.
// Mirrors the exact response shapes (issue→{result,attemptId,startUrl}; status) so the web UI can be
// tested for success/fail/cancel/pending without any real charge. Not reachable in live ops.
const MOCK = process.env.PAYDOLLAR_MOCK === '1';
const MOCK_MODE = process.env.PAYDOLLAR_MOCK_MODE || 'pending'; // success|fail|cancel|pending
const MOCK_CONTINUE_BASE = process.env.PAYDOLLAR_MOCK_CONTINUE_BASE || 'https://fixture.paydollar.mock/api/v1/payment/paydollar/web';

// REAL web-channel service credential (bot app cung cấp cho kênh WEB_MANDARINJAM).
// Header x-paydollar-service-token (contract chốt). NEVER the web's own better-auth sessionKey
// (contract §B / correction doc §6.3: "do not use ... JWT to impersonate the web customer").
// Absent + non-mock -> truthful AUTH_UNAVAILABLE, not a fabricated token.
const SERVICE_TOKEN = process.env.PAYDOLLAR_WEB_SERVICE_TOKEN || '';

function httpReq(method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + urlPath);
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      method,
      hostname: u.hostname,
      path: u.pathname + u.search,
      headers: Object.assign({ 'content-type': 'application/json' }, headers || {}, payload ? { 'content-length': Buffer.byteLength(payload) } : {}),
      timeout: 20000,
    }, (r) => {
      let data = '';
      r.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
      r.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { json = { raw: data }; }
        resolve({ status: r.statusCode, json, raw: data });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function mockIssue(orderCode) {
  // Backend trả startUrl TRỰC TIẾP (web dùng nguyên vẹn, không tự ghép). Mock trỏ fixture continue base.
  const startToken = 'MT_' + crypto.createHash('sha256').update(orderCode + MOCK_MODE).digest('hex').slice(0, 24);
  return { status: 200, json: {
    result: 'READY',
    attemptId: 'AT_' + orderCode.slice(-8),
    startToken,
    startTokenExpiresAt: Date.now() + 600000,
    startUrl: MOCK_CONTINUE_BASE + '/start/' + encodeURIComponent(startToken),
  } };
}

function unauth() {
  return { status: 503, json: { error: 'PAYDOLLAR_AUTH_UNAVAILABLE', detail: 'x-paydollar-service-token (PAYDOLLAR_WEB_SERVICE_TOKEN) not provisioned for the WEB_MANDARINJAM namespace (owner-gated, like the module which returns 404). The web does not substitute its own session as a Bearer/header.' } };
}

// Header authentication theo contract chốt: x-paydollar-service-token.
function authHeader() {
  if (SERVICE_TOKEN) return { 'x-paydollar-service-token': SERVICE_TOKEN };
  return null;
}

// POST /issue với đầy đủ field từ server-verified order. orderArg: {orderId, orderCode, principalId,
// totalMinor, currency, idemKey}. Trả {status, json} với json.startUrl là của backend (web check domain).
async function issue(orderArg) {
  if (MOCK) return mockIssue(orderArg && (orderArg.orderCode || orderArg.orderId));
  const h = authHeader(); if (!h) return unauth();
  const principalId = String((orderArg && (orderArg.principalId || (orderArg.owner && orderArg.owner.id))) || '');
  const payload = {
    orderCode: String((orderArg && (orderArg.orderCode || orderArg.orderId)) || ''),
    principalId,
    totalMinor: Number((orderArg && orderArg.totalMinor) != null ? orderArg.totalMinor : ((orderArg && orderArg.totalUsdCents) || 0)),
    currency: String((orderArg && orderArg.currency) || 'USD'),
    idemKey: String((orderArg && orderArg.idemKey) || ''),
  };
  const r = await httpReq('POST', '/issue', payload, h);
  if (r.status === 404) {
    r.json = { error: 'PAYDOLLAR_ENABLED_OFF', detail: 'Backend PayDollar web module not mounted (api.dev /api/v1/payment/paydollar/web/issue -> 404). Missing API (contract gate).' };
  }
  return r;
}

// startUrl = UY QUYỀN từ backend: gọi /issue, nhận json.startUrl (FNOS continue), KIỂM TRA host ∈ FNOS
// allowlist, dùng NGUYÊN VẸN. Nếu backend không trả startUrl, hoặc host KHÔNG thuộc allowlist -> không
// tự ghép BASE/start/token, không ghi đè: fail rõ ràng (tránh redirect khách tới host lạ).
async function startUrl(orderArg) {
  const r = await issue(orderArg);
  if (r.status !== 200 || !r.json || !r.json.startUrl) return r;
  // Owner 21/09: startUrl CHỈ được theo khi (a) HTTPS + (b) host thuộc FNOS allowlist.
  // KHÔNG chỉ dựa vào host — bắt buộc protocol https (comment "HTTPS" không bảo đảm scheme).
  let u = null;
  try { u = new URL(r.json.startUrl); } catch (e) { u = null; }
  const hostOk = u && fnosAllowlist().includes(u.hostname.toLowerCase());
  const httpsOk = u && u.protocol === 'https:';
  if (!u || !httpsOk || !hostOk) {
    return { status: 502, json: { error: 'START_URL_DOMAIN_REJECTED', detail: 'startUrl phải là HTTPS trên host thuộc FNOS allowlist (fnosofficial.com); web KHÔNG tự ghép/ghi đè startUrl. Không redirect khách (got="' + (u ? u.hostname + ' ' + u.protocol : 'unparsable') + '").' } };
  }
  // Dùng NGUYÊN startUrl backend trả về — KHÔNG ghi đè.
  return { status: 200, json: Object.assign({}, r.json, { startUrl: r.json.startUrl }) };
}

// GET /status/:orderCode (service auth, chỉ order của namespace). MOCK theo MOCK_MODE.
async function status(orderCode, orderArg) {
  if (MOCK) {
    const paid = MOCK_MODE === 'success';
    return { status: 200, json: {
      orderCode,
      attempt: { attemptId: 'AT_' + String(orderCode).slice(-8), status: paid ? 'paid' : (MOCK_MODE === 'fail' ? 'failed' : (MOCK_MODE === 'cancel' ? 'cancelled' : 'pending')), amountMinor: Number((orderArg && orderArg.totalMinor != null) ? orderArg.totalMinor : 9950), chargeCurrency: '840', channel: CHANNEL, expiresAt: Date.now() + 600000, paidAt: paid ? new Date().toISOString() : null },
    } };
  }
  const h = authHeader(); if (!h) return unauth();
  const r = await httpReq('GET', '/status/' + encodeURIComponent(orderCode), null, h);
  if (r.status === 404) r.json = { error: 'PAYDOLLAR_ENABLED_OFF', detail: 'backend web status not mounted (404)' };
  return r;
}

module.exports = { issue, startUrl, status, CHANNEL, BASE, MOCK, MOCK_MODE };
