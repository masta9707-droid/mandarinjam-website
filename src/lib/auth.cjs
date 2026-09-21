// ============================================================================
// lib/auth.cjs — Better Auth 1.7.5 + better-sqlite3 (tài khoản Mandarin Jam RIÊNG)
// ACCOUNT_TRANSACTIONAL_EMAIL_BRIEF §4A/4C + WEB-PAY-MANDARIN §4D.
// KHÔNG dùng user/session/JWT của Manjam. DB riêng: data/identity/mandarinjam.sqlite.
// Cookie namespace mj_auth (host-only, SameSite=Lax). Secret riêng, không in log.
// Mail: transport test-capture (QA) — Resend chưa configure → MAIL_PROVIDER_SETUP_REQUIRED.
// ============================================================================
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const { betterAuth } = require('better-auth');
const { emailOTP } = require('better-auth/plugins');

const ID_DIR = path.join(__dirname, '..', 'data', 'identity');
const MAIL_DIR = process.env.MJ_MAIL_DIR ? path.resolve(process.env.MJ_MAIL_DIR) : path.join(__dirname, '..', 'data', 'mail-capture');
fs.mkdirSync(ID_DIR, { recursive: true });
fs.mkdirSync(MAIL_DIR, { recursive: true });

// --- AUTH_SECRET riêng: sinh 1 lần, lưu file ngoài public (không in ra log/report) ---
function loadOrCreateSecret() {
  const f = path.join(ID_DIR, '.secret');
  if (fs.existsSync(f)) {
    const s = fs.readFileSync(f, 'utf8').trim();
    if (s.length >= 32) return s;
  }
  const s = crypto.randomBytes(48).toString('base64');
  fs.writeFileSync(f, s, { mode: 0o600 });
  return s;
}

const DB_PATH = process.env.MJ_AUTH_DB || path.join(ID_DIR, 'mandarinjam.sqlite');
const BASE_URL = process.env.MJ_BASE_URL || 'http://127.0.0.1:3200';

const sqlite = new Database(DB_PATH);
sqlite.pragma('journal_mode = WAL');
// Migrations idempotent — chạy schema library (nên đã có) + bảng nghiệp vụ riêng
sqlite.exec(`
CREATE TABLE IF NOT EXISTS user (
  id text primary key, name text not null, email text not null unique,
  emailVerified integer not null, image text, createdAt date not null, updatedAt date not null,
  registrationComplete integer, termsVersion text
);
CREATE TABLE IF NOT EXISTS session (
  id text primary key, token text not null unique, expiresAt date not null,
  ipAddress text, userAgent text, userId text not null, createdAt date not null, updatedAt date not null
);
CREATE TABLE IF NOT EXISTS account (
  id text primary key, accountId text, providerId text not null, userId text not null,
  accessToken text, refreshToken text, idToken text, accessTokenExpiresAt date,
  refreshTokenExpiresAt date, scope text, password text, createdAt date not null, updatedAt date not null
);
CREATE TABLE IF NOT EXISTS verification (
  id text primary key, identifier text not null, value text not null unique,
  expiresAt date not null, createdAt date not null, updatedAt date not null
);
-- bảng nghiệp vụ riêng (ACCOUNT brief §4A: profile/terms, rate limit, outbox, ownership)
CREATE TABLE IF NOT EXISTS account_terms (
  customerId text primary key, version text not null, agreedAt date not null
);
CREATE TABLE IF NOT EXISTS otp_rate (
  email text not null, ip text, ts integer not null
);
CREATE INDEX IF NOT EXISTS idx_otp_rate_email ON otp_rate(email, ts);
CREATE INDEX IF NOT EXISTS idx_otp_rate_ip ON otp_rate(ip, ts);
-- outbox email bền (dedup eventId+template+recipient)
CREATE TABLE IF NOT EXISTS mail_outbox (
  id integer primary key autoincrement,
  eventId text not null, eventType text not null, recipient text not null,
  locale text, orderId text, template text not null, templateVersion text,
  payload text, status text not null default 'queued', attempts integer not null default 0,
  providerMessageId text, createdAt date not null, updatedAt date not null,
  UNIQUE(eventId, template, recipient)
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON mail_outbox(status);
-- ownership phụ trợ cho đơn legacy (không autoassign hàng loạt — §4D)
CREATE TABLE IF NOT EXISTS order_ownership (
  orderId text primary key, customerId text not null, assignedAt date not null, source text
);
`);

// --- Rate limit persistent (brief §4C): resend ≥60s/email, ≤5/email/giờ, ≤20/IP/15ph ---
const RATE = { RESEND_COOLDOWN_MS: 60_000, PER_EMAIL_PER_HOUR: 5, PER_IP_PER_15MIN: 20 };
const rlCheck = sqlite.prepare(`
  SELECT
    (SELECT MAX(ts) FROM otp_rate WHERE email = ?) AS lastEmail,
    (SELECT COUNT(*) FROM otp_rate WHERE email = ? AND ts > ?) AS emailHour,
    (SELECT COUNT(*) FROM otp_rate WHERE ip = ? AND ts > ?) AS ipWindow
`);
const rlRecord = sqlite.prepare(`INSERT INTO otp_rate(email, ip, ts) VALUES (?,?,?)`);
const rlPrune = sqlite.prepare(`DELETE FROM otp_rate WHERE ts < ?`);

function rateLimitCheck(email, ip) {
  const now = Date.now();
  rlPrune.run(now - 24 * 3600 * 1000);
  const r = rlCheck.get(email, email, now - 3600_000, ip || '', now - 15 * 60_000);
  if (r.lastEmail && now - r.lastEmail < RATE.RESEND_COOLDOWN_MS) {
    return { ok: false, reason: 'COOLDOWN', retryInSec: Math.ceil((RATE.RESEND_COOLDOWN_MS - (now - r.lastEmail)) / 1000) };
  }
  if (r.emailHour >= RATE.PER_EMAIL_PER_HOUR) return { ok: false, reason: 'EMAIL_HOUR_LIMIT' };
  if (ip && r.ipWindow >= RATE.PER_IP_PER_15MIN) return { ok: false, reason: 'IP_WINDOW_LIMIT' };
  return { ok: true };
}
function rateLimitRecord(email, ip) { rlRecord.run(email, ip || '', Date.now()); }

// --- Mail transport: test-capture (QA/preview) — label SIMULATED, KHÔNG gửi thật ---
// Resend: chưa credential/domain verified → MAIL_PROVIDER_SETUP_REQUIRED (không fake delivered).
const mailTransport = process.env.MJ_MAIL_TRANSPORT || 'test-capture';
function captureMail({ to, subject, html, text, eventId, eventType, orderId, locale }) {
  const f = path.join(MAIL_DIR, new Date().toISOString().slice(0, 10) + '-' + eventId + '.json');
  fs.writeFileSync(f, JSON.stringify({
    capturedAt: new Date().toISOString(), transport: 'test-capture', label: 'SIMULATED',
    to, subject, text, html, eventId, eventType, orderId, locale
  }, null, 1));
  return { provider: 'test-capture', accepted: true, label: 'SIMULATED' };
}

// --- OTP capture hook: log code CHỈ vào file private (không console/report/browser) ---
const otpLog = path.join(MAIL_DIR, 'otp.log.jsonl');

// --- Better Auth instance ---
const auth = betterAuth({
  // 21/9: baseURL = origin (KHÔNG thêm /api/auth). toNodeHandler giữ nguyên req.url full
  // (/api/auth/...) trong Request; handler tự strip basePath mặc định /api/auth.
  baseURL: BASE_URL,
  basePath: '/api/auth',
  secret: loadOrCreateSecret(),
  database: sqlite,
  emailAndPassword: { enabled: false },
  session: { cookieCache: false },        // tắt cache session khi check quyền (revoke thật ngay)
  advanced: {
    cookies: {
      sessionCookie: {
        name: 'mj_auth_session',          // namespace riêng, không chia với FNOS
        sameSite: 'Lax',
        secure: process.env.MJ_COOKIE_SECURE === '1',  // preview 127.0.0.1 HTTP = dev exception
        httpOnly: true,
        path: '/',
      },
    },
    crossSubdomainCookies: false,
  },
  user: {
    additionalFields: {
      registrationComplete: { type: 'boolean', required: false, default: false },
      termsVersion: { type: 'string', required: false, default: '' },
    },
  },
  plugins: [
    emailOTP({
      expiresIn: 600,            // 600s (10 phút)
      maxAttempts: 5,
      sendVerificationOTP: async (arg, ctx) => {
        const email = (arg && arg.email) || (ctx && (ctx.email || (ctx.user && ctx.user.email))) || '';
        const code = arg && arg.otp;
        // code không in console — chỉ file private (QA harness đọc)
        fs.appendFileSync(otpLog, JSON.stringify({ ts: Date.now(), email: email.slice(0, 40), codeLen: String(code || '').length }) + '\n');
        const eventId = 'otp-' + crypto.createHash('sha256').update(email + ':' + Date.now()).digest('hex').slice(0, 16);
        const locale = (ctx && ctx.headers && (ctx.headers.get ? ctx.headers.get('x-locale') : ctx.headers['x-locale'])) || 'en';
        const L = {
          en: { subject: 'Your Mandarin Jam verification code', body: `Your verification code is ${code}. It expires in 10 minutes. If you did not request this, you can ignore this email.` },
          vi: { subject: 'Mã xác minh Mandarin Jam', body: `Mã xác minh của bạn là ${code}. Mã có hiệu lực trong 10 phút. Nếu bạn không yêu cầu, vui lòng bỏ qua email này.` },
          zh: { subject: '您的 Mandarin Jam 验证码', body: `您的验证码为 ${code}。10 分钟内有效。如非本人操作，请忽略此邮件。` },
          ko: { subject: 'Mandarin Jam 인증 코드', body: `인증 코드는 ${code}입니다. 10분 동안 유효합니다. 요청하지 않으셨다면 무시해 주세요.` },
        }[locale] || { subject: 'Your Mandarin Jam verification code', body: `Your verification code is ${code}. It expires in 10 minutes.` };
        captureMail({
          to: email, subject: L.subject, text: L.body,
          html: `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px"><h2 style="font-size:18px;margin:0 0 16px">Mandarin Jam</h2><p style="font-size:14px;line-height:1.6">${L.body}</p><p style="font-size:12px;color:#888">Mandarin Jam · no-reply@mandarinjam.club</p></div>`,
          eventId, eventType: 'email_otp', locale,
        });
      },
    }),
  ],
});

// --- requireVerifiedCustomer(req) — guard checkout/order (brief §4D) ---
// Đọc session từ SERVER (cookie header), KHÔNG tin body. Trả { ok, user?, error? }.
async function requireVerifiedCustomer(req) {
  try {
    const sess = await auth.api.getSession({ headers: req.headers });
    const user = sess && sess.user;
    if (!user || !sess.session) return { ok: false, status: 401, error: 'AUTH_REQUIRED' };
    if (!user.emailVerified) return { ok: false, status: 403, error: 'EMAIL_UNVERIFIED' };
    if (!user.registrationComplete) return { ok: false, status: 403, error: 'REGISTRATION_INCOMPLETE' };
    return { ok: true, user, customerId: user.id, sessionKey: String(sess.session.id || sess.session.token || user.id) };
  } catch (e) {
    return { ok: false, status: 401, error: 'AUTH_REQUIRED' };
  }
}

// --- account complete (terms consent) — authenticated, version do server quyết ---
const TERMS_VERSION = process.env.MJ_TERMS_VERSION || '2026-09';
async function handleAccountComplete(req) {
  const sess = await auth.api.getSession({ headers: req.headers }).catch(() => null);
  const user = sess && sess.user;
  if (!user || !sess.session) return { status: 401, body: { error: 'AUTH_REQUIRED' } };
  if (!user.emailVerified) return { status: 403, body: { error: 'EMAIL_UNVERIFIED' } };
  const db2 = new Database(DB_PATH);
  try {
    db2.prepare('INSERT INTO account_terms(customerId, version, agreedAt) VALUES (?,?,?) ON CONFLICT(customerId) DO UPDATE SET version=excluded.version, agreedAt=excluded.agreedAt')
      .run(user.id, TERMS_VERSION, new Date().toISOString());
    db2.prepare('UPDATE user SET registrationComplete = 1, termsVersion = ? WHERE id = ?').run(TERMS_VERSION, user.id);
    return { status: 200, body: { ok: true, termsVersion: TERMS_VERSION } };
  } catch (e) {
    return { status: 500, body: { error: 'COMPLETE_FAILED' } };
  } finally { db2.close(); }
}

// --- outbox helper (durable, dedup) ---
function enqueueMail({ eventType, to, locale, orderId, template, templateVersion, payload }) {
  const eventId = (payload && payload.eventId) || ('ev-' + crypto.createHash('sha256').update(eventType + ':' + (orderId || '') + ':' + Date.now()).digest('hex').slice(0, 16));
  const db2 = new Database(DB_PATH);
  try {
    const info = db2.prepare(`INSERT OR IGNORE INTO mail_outbox(eventId, eventType, recipient, locale, orderId, template, templateVersion, payload, status, attempts, createdAt, updatedAt)
      VALUES (?,?,?,?,?,?,?,?, 'queued', 0, ?, ?)`).run(eventId, eventType, to, locale || 'en', orderId || null, template, templateVersion || '1', JSON.stringify(payload || {}), new Date().toISOString(), new Date().toISOString());
    // capture ngay (transport test) — status: provider_accepted (SIMULATED, KHÔNG phải delivered)
    if (info.changes > 0) {
      captureMail({ to, subject: template, text: JSON.stringify(payload || {}).slice(0, 500), eventId, eventType, orderId, locale: locale || 'en' });
      db2.prepare(`UPDATE mail_outbox SET status='provider_accepted', providerMessageId=?, updatedAt=? WHERE eventId=? AND template=? AND recipient=?`)
        .run('test-capture-' + eventId, new Date().toISOString(), eventId, template, to);
    }
    return { ok: true, eventId, deduped: info.changes === 0 };
  } finally { db2.close(); }
}

// --- terms version public (client render consent) ---
function termsVersion() { return TERMS_VERSION; }

module.exports = { auth, requireVerifiedCustomer, handleAccountComplete, rateLimitCheck, rateLimitRecord, enqueueMail, termsVersion, DB_PATH, RATE };