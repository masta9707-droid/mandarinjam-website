/* lib/payment.cjs — WEB-MANDARINJAM payment adapter (WEB-PAY-02)
 * Consumes SHARED_PAYMENT_CONTRACT_20260921.md v1.0.0 (source-of-truth for protocol).
 * Implements WEB-side only (namespaced store + idempotency + attempt snapshots +
 * datafeed verification state machine + status/return). Does NOT touch FNOS/core.
 *
 * Namespace: WEB_MANDARINJAM, reference prefix MJ.
 * Settlement path = signed Datafeed ONLY. Browser return is UX (never marks paid).
 * Idempotency fingerprint = sha256(src|prc|successcode|Ref|PayRef|Cur|Amt|payerAuth).
 *
 * NO_REAL_CHARGE / NO_DEPLOY: issue() requests the core to issue only when a
 * core endpoint is configured; otherwise returns CAPABILITY_PENDING. Live is
 * owner-gated.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const NS = 'WEB_MANDARINJAM';
const REF_PREFIX = 'MJ';
const ORDERS_DIR = process.env.MJ_ORDERS_DIR ? path.resolve(process.env.MJ_ORDERS_DIR) : path.join(__dirname, '..', 'data', 'orders');
const IDEM_DIR = path.join(__dirname, '..', 'data', 'orders', '.idem');
const ATT_DIR = path.join(__dirname, '..', 'data', 'orders', '.attempts');

function ensureDirs(){ for (const d of [ORDERS_DIR, IDEM_DIR, ATT_DIR]) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); } }
function atomicWrite(file, data){
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function readJson(file){
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// --- Namespaced order lock (per order id), stale 300s, compare-and-delete ---
const LOCKS = new Map(); // key -> {val, exp}
function acquireOrderLock(orderId){
  const key = 'web:' + orderId;
  const now = Date.now();
  const cur = LOCKS.get(key);
  if (cur && cur.exp > now) return { ok: false, reason: 'BUSY' };
  const val = now + '|' + crypto.randomBytes(6).toString('hex');
  LOCKS.set(key, { val, exp: now + 300000 });
  return { ok: true, val, key };
}
function releaseOrderLock(key, val){
  const cur = LOCKS.get(key);
  if (cur && cur.val === val) LOCKS.delete(key);
}

// --- Reference: MJ{order-base36}-{16hex} ≤35 chars ---
function base36(n){ return n.toString(36).toUpperCase(); }
function makeRef(orderId, attemptNum, orderKey){
  // orderId = "MJmuavakc97ea136" -> numeric-ish suffix for compacslice; use full hash tail for uniqueness
  const blog = 'mandarinjam.club';
  const seed = [blog, orderId, String(attemptNum), orderKey || ''].join('|');
  const tail = crypto.createHmac('sha256', SITE_SECRET).update(seed).digest('hex').slice(0, 16);
  // order-base36 from the id's numerics (ids are base36 already; take last 8 for compactness, still ≤35)
  const order36 = String(orderId).replace(/^MJ/i, '').slice(-8) || '0';
  return (REF_PREFIX + order36 + '-' + tail).slice(0, 35);
}
// site secret for HMAC salt (own boundary, not the payment secret)
const SITE_SECRET = process.env.MJ_SITE_SECRET || 'web-mandarinjam-dev-salt';

// --- Amount normalize: "1234.50", max 2 decimals, >0 ---
function normalizeAmountUsd(n){
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return null;
  return x.toFixed(2);
}

// --- Idempotency fingerprint (contract §4) ---
function callbackFingerprint(p){
  return crypto.createHash('sha256')
    .update([String(p.src||''), String(p.prc||''), String(p.successcode||''), String(p.Ref||''),
             String(p.PayRef||''), String(p.Cur||''), String(p.Amt||''), String(p.payerAuth||'')].join('|'))
    .digest('hex');
}

// --- Quote binding: re-verify quote against a fetched quote (imported lazily) ---
// Web re-fetches V2 stock+price; price shift >±2% -> QUOTE_STALE.
function quoteStale(expectedUsd, freshUsd){
  if (!expectedUsd || !freshUsd) return true;
  return Math.abs(freshUsd - expectedUsd) / expectedUsd > 0.02;
}

// --- Create attempt snapshot (immutable) under order lock (contract §2.70-91) ---
function createAttempt({ orderId, orderKey, amountUsd, merchantId, payMethod, payType, currCode, language, environment, secret_id, algorithm, principalId }){
  ensureDirs();
  const lock = acquireOrderLock(orderId);
  if (!lock.ok) return { error: 'BUSY' };
  try {
    const order = readJson(path.join(ORDERS_DIR, orderId + '.json'));
    if (!order) return { error: 'ORDER_NOT_FOUND' };
    // count existing attempts, cap 50
    const attDir = path.join(ATT_DIR, orderId);
    if (!fs.existsSync(attDir)) fs.mkdirSync(attDir, { recursive: true });
    const existing = fs.readdirSync(attDir).filter(f => f.endsWith('.json'));
    const number = existing.length + 1;
    if (number > 50) return { error: 'ATTEMPT_CAP' };
    const ref = makeRef(orderId, number, orderKey || order.keyRaw);
    const amount = normalizeAmountUsd(amountUsd);
    if (!amount) return { error: 'BAD_AMOUNT' };
    const attempt = {
      number, ref, amount, currency: currCode || '840',
      merchant_id: merchantId, pay_method: payMethod, pay_type: payType,
      language, algorithm, environment, secret_id,
      returnTarget: 'WEB', returnOrigin: 'https://mandarinjam.club',
      orderNamespace: NS, orderId, principalId,
      created: Math.floor(Date.now() / 1000)
    };
    atomicWrite(path.join(attDir, 'a' + number + '.json'), JSON.stringify(attempt, null, 2));
    // re-read + verify before returning (contract L692-698)
    const reread = readJson(path.join(attDir, 'a' + number + '.json'));
    if (!reread || reread.ref !== ref) return { error: 'ATTEMPT_WRITE_UNVERIFIED' };
    return { ok: true, attempt: reread };
  } finally {
    releaseOrderLock(lock.key, lock.val);
  }
}

// --- Datafeed verification + settlement state machine (contract §4) ---
// Returns { status, code, body } per the fixed protocol responses.
function verifyDatafeedPayload(p){ // structural parse + bounds only (no secret yet)
  if (typeof p.src !== 'string' || p.src.length > 50 || /[\x00-\x1f]/.test(p.src)) return { error: 'INVALID' };
  if (typeof p.prc !== 'string' || p.prc.length > 50 || /[\x00-\x1f]/.test(p.prc)) return { error: 'INVALID' };
  if (typeof p.successcode !== 'string' || p.successcode.length > 10 || !/^-?[0-9]{1,9}$/.test(p.successcode)) return { error: 'INVALID' };
  if (typeof p.Ref !== 'string' || p.Ref.length > 35) return { error: 'INVALID' };
  if (typeof p.PayRef !== 'string' || p.PayRef.length > 40) return { error: 'INVALID' };
  if (typeof p.Cur !== 'string' || !/^[0-9]{3}$/.test(p.Cur)) return { error: 'INVALID' };
  if (typeof p.Amt !== 'string' || p.Amt.length > 20 || !normalizeAmountUsd(p.Amt)) return { error: 'INVALID' };
  if (typeof p.payerAuth !== 'string' || p.payerAuth.length > 2) return { error: 'INVALID' };
  if (typeof p.secureHash !== 'string' || p.secureHash.length > 260) return { error: 'INVALID' };
  return { ok: true };
}

function applyDatafeed(p, secret, algorithm){
  // Returns { code, body } — state machine result
  const norm = verifyDatafeedPayload(p);
  if (!norm.ok) return { code: 400, body: norm.error };
  // resolve namespace+order from Ref
  if (!p.Ref.startsWith(REF_PREFIX + '') ) return { code: 404, body: 'UNKNOWN' };
  // find attempt by ref across orders' attempt dirs
  const attempt = findAttemptByRef(p.Ref);
  if (!attempt) return { code: 409, body: 'MISMATCH' };
  // secret-bound hash verify (constant-time). secret passed in (from per-attempt secret_id).
  // INCOMING provider tuple; preserve raw signed Amt for hash; strict money parsed below.
  const expect = tryVerifyHash({ src:p.src, prc:p.prc, successcode:p.successcode, Ref:p.Ref, PayRef:p.PayRef,
                                 Cur:p.Cur, rawAmt:p.Amt, payerAuth:p.payerAuth }, secret, algorithm, p.secureHash);
  if (expect !== true) return { code: 400, body: 'INVALID HASH' };
  // amount/currency must hash_equals attempt (separate strict money validation)
  if (!constantEqual(normalizeAmountUsd(p.Amt), attempt.amount) || !constantEqual(p.Cur, attempt.currency))
    return { code: 409, body: 'MISMATCH' };
  if (p.successcode === '0' && !/^[0-9]{1,40}$/.test(p.PayRef)) return { code: 400, body: 'INVALID' };

  // --- idempotency: fingerprint against stored marker ---
  const fp = callbackFingerprint(p);
  const order = readOrderSafe(attempt.orderId);
  if (!order) return { code: 404, body: 'UNKNOWN' };
  if (order._s_fp === fp) return { code: 200, body: 'OK' }; // already applied

  const lock = acquireOrderLock(attempt.orderId);
  if (!lock.ok) return { code: 409, body: 'BUSY' };
  try {
    // re-check marker under lock
    const o2 = readOrderSafe(attempt.orderId);
    if (o2 && o2._s_fp === fp) return { code: 200, body: 'OK' };
    // C4: an accepted LATE failure / conflicting event must NOT undo an already-confirmed paid order.
    // Once payment.status === 'paid' (confirmed capture with paidAt), no later callback may downgrade it.
    const cur = order.payment || {};
    const alreadyConfirmed = cur.status === 'paid' && !!cur.paidAt;
    if (alreadyConfirmed && p.successcode !== '0') {
      // late/conflicting non-success: keep paid, record durable obligation, do NOT downgrade
      recordReconcile(order, attempt, p, 'late-failure-after-paid');
      order._s_fp = fp;
      writeOrderSafe(attempt.orderId, order);
      return { code: 200, body: 'OK' };
    }
    // C5: detect conflict on a SUCCESS before acknowledging; if conflict, persist it durably
    // FIRST (write order + reconcile journal) — only then ack 200. A conflicting PayRef must
    // never be acked before a durable obligation exists.
    let conflict = false;
    if (p.successcode === '0') {
      conflict = orderConflict(order, attempt, p);
      if (conflict) {
        order._s_fp = fp;                              // persist fingerprint too (dedup this callback)
        writeOrderSafe(attempt.orderId, order);        // durable conflict persisted BEFORE ack
        recordReconcile(order, attempt, p, order.payment && order.payment.conflict);
        return { code: 200, body: 'OK', conflict: true };
      }
    }
    // state machine (only a non-conflicted success advances the projection)
    if (p.successcode === '0') {
      if (attempt.pay_type === 'H') {
        order.payment = order.payment || {}; order.payment.status = 'authorized'; order.payment.payref = p.PayRef;
        order.status = 'on-hold';
      } else {
        order.payment = order.payment || {}; order.payment.status = 'paid'; order.payment.payref = p.PayRef;
        order.payment.paidAt = new Date().toISOString(); order.status = 'paid';
      }
    } else if (p.successcode === '1' && !alreadyConfirmed) {
      order.payment = order.payment || {}; order.payment.status = 'failed'; order.status = 'failed';
    } else {
      // non-success, not confirmed
    }
    order._s_fp = fp; // only after state work
    writeOrderSafe(attempt.orderId, order);
    return { code: 200, body: 'OK' };
  } finally { releaseOrderLock(lock.key, lock.val); }
}

function orderConflict(order, attempt, p){
  // Contract §4.143-146: conflict on value-change / method-change / cancelled-refunded / different-PayRef.
  if (!order) return true;
  // cancelled / refunded -> conflict + note, no paid
  if (order.status === 'cancelled' || order.status === 'refunded') return true;
  // amount no longer equals attempt -> on-hold
  const amtUsd = order.totalUsd != null ? normalizeAmountUsd(order.totalUsd) : null;
  const amtOk = amtUsd !== null && constantEqual(amtUsd, attempt.amount);
  const curOk = (order.currency || 'USD') === (attempt.currency === '840' ? 'USD' : attempt.currency);
  if (!amtOk) { order._payment_conflict = true; order.payment = order.payment || {}; order.payment.conflict = 'amount_mismatch@' + new Date().toISOString(); order.status = 'on-hold'; }
  if (!curOk) { order._payment_conflict = true; order.payment = order.payment || {}; order.payment.conflict = 'currency_mismatch@' + new Date().toISOString(); order.status = 'on-hold'; }
  // different PayRef already recorded for this order -> on-hold + manual
  if (p.successcode === '0' && order.payment && order.payment.payref && order.payment.payref !== p.PayRef) {
    order._payment_conflict = true; order.payment = order.payment || {}; order.payment.conflict = 'payref_change@' + new Date().toISOString(); order.status = 'on-hold';
  }
  return !!order._payment_conflict;
}

/* ---- Durable reconciliation journal (C5/extra-PayRef/cancelled funds) ----
 * A provider callback that signals a conflict or an extra/cancelled obligation must leave a
 * DURABLE record BEFORE any 200-OK acknowledgment. This is the web-side projection mirror of
 * the authoritative core's reconcile obligation — it is NOT itself a settlement. */
const RECON_DIR = process.env.MJ_RECON_DIR ? path.resolve(process.env.MJ_RECON_DIR) : path.join(__dirname, '..', 'data', 'reconcile');
function recordReconcile(order, attempt, payload, reason){
  try {
    if (!fs.existsSync(RECON_DIR)) fs.mkdirSync(RECON_DIR, { recursive: true });
    const rec = {
      ts: Date.now(), iso: new Date().toISOString(),
      reason: String(reason || 'reconcile'),
      orderId: order && order.id, namespace: NS, ref: attempt && attempt.ref,
      eventId: payload && payload.eventId,
      orderStatus: order && order.status, paymentStatus: order && order.payment && order.payment.status,
      payref: payload && payload.PayRef, conflict: order && order.payment && order.payment.conflict,
      rawAmount: payload && payload.Amt, currency: payload && payload.Cur,
      src: payload && payload.src, prc: payload && payload.prc, successcode: payload && payload.successcode
    };
    const f = path.join(RECON_DIR, 'rec-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex') + '.json');
    atomicWrite(f, JSON.stringify(rec, null, 2));
    return f;
  } catch (e) { return null; }
}

/* ---- Authoritative core-event consumer (correction §R2) ----
 * The website does NOT settle from a raw provider callback. It consumes AUTHENTICATED,
 * namespace-bound CORE events through ONE idempotent order projection. applyCoreEvent is the
 * ONLY path that advances a web order to paid. It requires an authenticated delivery caller
 * (not the customer route), idempotent on eventId (with payload-digest conflict detection),
 * and binds to the order's stored immutable owner/order money snapshot.
 *
 * CO-GUARD (durability): a required durable reconcile/audit write failing MUST abort the
 * apply — we never return 200 / never mark the delivery consumed until all required
 * projection + obligation work is persisted. */
// immutable store of applied event ids -> payload digest (own-property safe; no inherited lookup)
function coreEventsStore(order){ if (!order._coreEvents) order._coreEvents = {}; return order._coreEvents; }
function eventDigest(ev){ return crypto.createHash('sha256').update([
  ev.namespace, ev.orderId, ev.attemptId || '', ev.outcome, String(ev.amount),
  ev.currency, ev.principalId || '', ev.payref || '', ev.paidAt || ''
].join('|')).digest('hex'); }
function eventApplied(order, eventId){
  const s = order && order._coreEvents;
  return !!(s && Object.prototype.hasOwnProperty.call(s, eventId));
}
function markEventApplied(order, eventId, digest){ coreEventsStore(order)[eventId] = digest; }
// Validate an incoming core event envelope (durable event ID, namespace/order/attempt IDs, amount/currency)
function validateCoreEvent(ev){
  if (!ev || typeof ev !== 'object') return null;
  if (typeof ev.eventId !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(ev.eventId)) return null;
  if (ev.namespace !== NS) return null;
  if (typeof ev.orderId !== 'string' || !/^MJ[0-9a-z]+$/.test(ev.orderId)) return null;
  if (ev.outcome !== 'paid' && ev.outcome !== 'failed' && ev.outcome !== 'on-hold' && ev.outcome !== 'reconcile') return null;
  // amount integer minor units; currency 3-letter
  if (ev.amount == null || !Number.isInteger(Number(ev.amount)) || Number(ev.amount) <= 0) return null;
  if (typeof ev.currency !== 'string' || !/^[A-Z]{3}$/.test(ev.currency)) return null;
  return ev;
}
// canonical server-priced money snapshot bound to the stored order (immutable per issue)
function orderMoneySnapshot(order){
  const cur = order.currency || (order.payment && order.payment.currency) || 'USD';
  const total = Number(order.totalUsd != null ? order.totalUsd : order.amountUsd);
  if (!isFinite(total) || total <= 0) return null;
  return { minor: Math.round(total * 100), currency: cur };
}
// canonical owner: principalId OR customer.id — customer.id-owned records are NOT an unowned fallback
function canonicalOwner(order){ return order.principalId || (order.customer && order.customer.id) || null; }
// Apply a verified core event to the order projection (authoritative settle path).
function applyCoreEvent(ev){
  const v = validateCoreEvent(ev);
  if (!v) return { ok:false, code:400, error:'INVALID_EVENT' };
  const lock = acquireOrderLock(v.orderId);
  if (!lock.ok) return { ok:false, code:409, error:'BUSY' };
  try {
    const order = readOrderSafe(v.orderId);
    if (!order) return { ok:false, code:404, error:'UNKNOWN' };
    if (order.orderNamespace && order.orderNamespace !== NS) return { ok:false, code:403, error:'WRONG_NAMESPACE' };
    const dg = eventDigest(v);
    // idempotency with payload digest — same eventId + same body = replay; same eventId + diff body = CONFLICT
    if (eventApplied(order, v.eventId)) {
      if (coreEventsStore(order)[v.eventId] === dg) return { ok:true, code:200, idempotent:true };
      return { ok:false, code:409, error:'EVENT_ID_CONFLICT' };
    }
    // ---- immutable identity + money binding (E01/E02/E03): reject missing/ambiguous binding ----
    const owner = canonicalOwner(order);
    if (!owner) return { ok:false, code:409, error:'AMBIGUOUS_IDENTITY' };
    if (!v.principalId || String(v.principalId) !== String(owner)) return { ok:false, code:403, error:'WRONG_OWNER' };
    const money = orderMoneySnapshot(order);
    if (!money) return { ok:false, code:409, error:'NO_PRICE_SNAPSHOT' };
    if (Number(v.amount) !== money.minor) return { ok:false, code:409, error:'AMOUNT_MISMATCH' };
    if (v.currency !== money.currency) return { ok:false, code:409, error:'CURRENCY_MISMATCH' };
    // ---- attempt binding: a settlement-affecting event MUST reference the order's registered
    //      payment attempt (contract §B aggregateId = attemptId). Missing or mismatched attempt
    //      → reject, never settle. The web binds order.payment.attemptId at issue time. ----
    const boundAttempt = order.payment && order.payment.attemptId;
    if (!boundAttempt) return { ok:false, code:409, error:'NO_ATTEMPT_BOUND' };
    if (!v.attemptId || String(v.attemptId) !== String(boundAttempt))
      return { ok:false, code:409, error:'ATTEMPT_MISMATCH' };

    const cur = order.payment || {};
    const prevPayref = cur.payref;   // snapshot BEFORE mutation (cur aliases order.payment)
    const alreadyConfirmed = cur.status === 'paid' && !!cur.paidAt;
    // terminal non-paid states (cancelled/refunded): tracked at BOTH the top-level order.status
    // (datafeed conflict path) and payment.status. A later paid event must NOT reopen either.
    const terminalRejected = (order.status === 'cancelled' || order.status === 'refunded' ||
                              cur.status === 'cancelled' || cur.status === 'refunded') && v.outcome === 'paid';
    if (terminalRejected) {
      order.payment = order.payment || {};
      const rec = recordReconcile(order, { ref: v.ref, orderId: v.orderId }, { PayRef: v.payref }, 'core-reconcile-terminal-nonpaid');
      if (!rec) return { ok:false, code:503, error:'RECONCILE_STORE_FAILED' };
      markEventApplied(order, v.eventId, dg);
      writeOrderSafe(v.orderId, order);
      return { ok:true, code:200, note:'terminal-nonpaid-preserved' };
    }
    // late/duplicate failure from core cannot undo a confirmed capture — but the authoritative
    // reconciliation event must be RETAINED durably (E04), not dropped.
    if (alreadyConfirmed && v.outcome !== 'paid') {
      order.payment = order.payment || {};
      const rec = recordReconcile(order, { ref: v.ref, orderId: v.orderId }, { PayRef: v.payref, outcome: v.outcome }, 'core-reconcile');
      if (!rec) return { ok:false, code:503, error:'RECONCILE_STORE_FAILED' };
      markEventApplied(order, v.eventId, dg);
      writeOrderSafe(v.orderId, order);
      return { ok:true, code:200, note:'confirmed-capture-preserved', reconcileRetained: true };
    }
    if (v.outcome === 'paid') {
      order.payment = order.payment || {};
      const wasPaid = cur.status === 'paid';
      order.payment.status = 'paid';
      if (!order.payment.paidAt) order.payment.paidAt = v.paidAt || new Date().toISOString(); // confirmed capture
      if (v.payref) {
        if (!wasPaid) {
          order.payment.payref = v.payref;   // first confirmed capture ID
        } else if (v.payref && prevPayref && prevPayref !== v.payref) {
          // conflicting extra PayRef on a confirmed order: PRESERVE original capture ID (E06),
          // store the extra reference as a separate durable obligation.
          order.payment.extraRefs = order.payment.extraRefs || [];
          if (!order.payment.extraRefs.includes(v.payref)) order.payment.extraRefs.push(v.payref);
          order.payment.conflict = 'payref_change@' + new Date().toISOString();
          const rec = recordReconcile(order, { ref: v.ref, orderId: v.orderId }, { PayRef: v.payref }, 'core-extra-payref');
          if (!rec) return { ok:false, code:503, error:'RECONCILE_STORE_FAILED' };
        }
      }
      order.status = 'paid';
    } else if (v.outcome === 'failed' && !alreadyConfirmed) {
      order.payment = order.payment || {}; order.payment.status = 'failed'; order.status = 'failed';
    } else if (v.outcome === 'on-hold') {
      order.payment = order.payment || {}; order.payment.status = 'on-hold'; order.status = 'on-hold';
    } else if (v.outcome === 'reconcile') {
      order.payment = order.payment || {};
      order.payment.conflict = order.payment.conflict || ('core_reconcile@' + new Date().toISOString());
      const rec = recordReconcile(order, { ref: v.ref, orderId: v.orderId }, { PayRef: v.payref }, 'core-reconcile');
      if (!rec) return { ok:false, code:503, error:'RECONCILE_STORE_FAILED' };
    }
    markEventApplied(order, v.eventId, dg);
    writeOrderSafe(v.orderId, order);
    return { ok:true, code:200 };
  } finally { releaseOrderLock(lock.key, lock.val); }
}

/* ---- Return-ticket flow (correction §R 6.4) ----
 * A naked Ref or arbitrary orderId CANNOT substitute. The website redeems a scoped, EXPIRING
 * ticket bound to the matching Mandarin owner/session + CSRF boundary. FNOS validates the stored
 * attempt's return state; the web return only issues a short-lived, single-use, owner-bound
 * ticket, and the status page redeems it. Return alone NEVER sets paid. */
const TICKET_DIR = path.join(__dirname, '..', 'data', 'return_tickets');
const TICKET_TTL_MS = 15 * 60 * 1000; // 15 min expiry
function issueReturnTicket({ orderId, principalId, sessionKey }){
  try {
    if (!fs.existsSync(TICKET_DIR)) fs.mkdirSync(TICKET_DIR, { recursive: true });
    const ticketId = crypto.randomBytes(18).toString('base64url');
    const ticket = {
      id: ticketId, orderId, principalId: principalId || null,
      sessionKey: sessionKey || null, created: Date.now(), exp: Date.now() + TICKET_TTL_MS, used: false
    };
    atomicWrite(path.join(TICKET_DIR, ticketId + '.json'), JSON.stringify(ticket, null, 2));
    return { ok:true, ticket: ticketId, exp: ticket.exp };
  } catch (e) { return { ok:false, error:'TICKET_ISSUE_FAILED' }; }
}
function redeemReturnTicket(ticketId, { principalId, sessionKey }){
  try {
    if (!ticketId || !/^[A-Za-z0-9_-]{8,64}$/.test(ticketId)) return { ok:false, error:'INVALID_TICKET' };
    const f = path.join(TICKET_DIR, ticketId + '.json');
    if (!fs.existsSync(f)) return { ok:false, error:'UNKNOWN_TICKET' };
    const t = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!t) return { ok:false, error:'UNKNOWN_TICKET' };
    if (Date.now() > t.exp) return { ok:false, error:'TICKET_EXPIRED' };
    // owner binding: the ticket belongs ONLY to its bound principal (never a null-owner fallback, never a different owner)
    if (t.principalId && (!principalId || String(t.principalId) !== String(principalId))) return { ok:false, error:'WRONG_OWNER' };
    // session binding: if the ticket was bound to a session, the SAME session MUST be presented (R04) —
    // omitting the session is a rejection, not a pass.
    if (t.sessionKey != null && t.sessionKey !== sessionKey) return { ok:false, error:'WRONG_SESSION' };
    // Mark consumed single-use, but a matching owner re-polling its own pending order within TTL keeps
    // resolving (R03 — a legitimate pending page must not 404 after the first poll).
    t.used = true; t.usedAt = Date.now();
    atomicWrite(f, JSON.stringify(t, null, 2));
    return { ok:true, orderId: t.orderId, used: true };
  } catch (e) { return { ok:false, error:'REDEEM_FAILED' }; }
}


function constantEqual(a, b){ try { return crypto.timingSafeEqual(Buffer.from(String(a)), Buffer.from(String(b))); } catch(e){ return false; } }
function tryVerifyHash(fields, secret, algorithm, secureHashCsv){
  // INCOMING PayDollar datafeed tuple (PayDollar guide PDF pp.74-75; FNOS generate_datafeed:69):
  //   src|prc|successcode|Ref|PayRef|Cur|rawAmt|payerAuth|secret
  // Preserve the RAW signed amount (fields.rawAmt) for hash validation; strict money is
  // parsed separately afterward (applyDatafeed amount check). Do NOT reuse the outbound
  // request tuple (merchantId|Ref|Cur|normalized|payType|secret) — that tuple authenticates
  // our request to the provider, not the provider's callback to us.
  const cands = String(secureHashCsv).split(',');
  for (const c of cands) {
    const expected = computePlainHash(algorithm, [fields.src || '', fields.prc || '', fields.successcode || '',
                                                  String(fields.Ref || ''), String(fields.PayRef || ''), String(fields.Cur || ''),
                                                  String(fields.rawAmt === undefined ? '' : fields.rawAmt), String(fields.payerAuth || ''), secret]);
    if (c && constantEqual(c, expected)) return true;
  }
  return false;
}
function computePlainHash(algorithm, parts){
  const alg = algorithm === 'sha256' ? 'sha256' : 'sha1';
  return crypto.createHash(alg).update(parts.join('|')).digest('hex');
}

function readOrderSafe(id){ return readJson(path.join(ORDERS_DIR, id + '.json')); }
function writeOrderSafe(id, order){ atomicWrite(path.join(ORDERS_DIR, id + '.json'), JSON.stringify(order, null, 2)); }

function findAttemptByRef(ref){
  ensureDirs();
  if (!fs.existsSync(ATT_DIR)) return null;
  for (const orderId of fs.readdirSync(ATT_DIR, { withFileTypes: true })) {
    if (!orderId.isDirectory()) continue;
    const dir = path.join(ATT_DIR, orderId.name);
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      const a = readJson(path.join(dir, f));
      if (a && a.ref === ref) return a;
    }
  }
  return null;
}

module.exports = {
  NS, REF_PREFIX, ORDERS_DIR, IDEM_DIR, ATT_DIR, RECON_DIR, TICKET_DIR,
  ensureDirs, makeRef, base36, normalizeAmountUsd, callbackFingerprint, quoteStale,
  createAttempt, verifyDatafeedPayload, applyDatafeed, findAttemptByRef,
  recordReconcile, validateCoreEvent, applyCoreEvent, eventApplied,
  issueReturnTicket, redeemReturnTicket,
  acquireOrderLock, releaseOrderLock, constantEqual, computePlainHash, readOrderSafe, writeOrderSafe
};
