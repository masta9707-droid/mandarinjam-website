/* account.js — Mandarin Jam web sign-in / account (WEB-PAY b5)
 * Self-contained: injects an account button in the header + owns its own modal.
 * Uses NATIVE Better Auth endpoints so the session cookie is signed
 * (better-auth.session_token), which the server guard reads correctly.
 * Endpoints:
 *   POST /api/auth/email-otp/send-verification-otp  {email, type:'sign-in'}
 *   POST /api/auth/sign-in/email-otp                {email, otp}   -> sets signed cookie
 *   GET  /api/account/me                            -> {user, termsVersion}
 *   POST /api/account/complete                      -> terms consent -> registrationComplete
 *   POST /api/account/logout                        -> revoke + clear cookie
 */
(function () {
  if (window.__MJAccount) return;
  window.__MJAccount = true;

  var L = {
    vi: { signin:'Đăng nhập', email:'Email', send:'Gửi mã', sent:'Đã gửi mã — kiểm tra email (kể cả spam).', code:'Nhập mã 6 số', verify:'Xác nhận', welcome:'Xin chào', terms:'Tôi đồng ý với điều khoản & chính sách của Mandarin Jam', confirm:'Xác nhận', logout:'Thoát đăng nhập', close:'Đóng', err_email:'Email chưa hợp lệ.', err_code:'Mã phải đủ 6 số.', sending:'Đang gửi…', wait:'Kiểm tra email trong vài giây rồi nhập mã.' },
    en: { signin:'Sign in', email:'Email', send:'Send code', sent:'Code sent — check your email (incl. spam).', code:'Enter 6-digit code', verify:'Verify', welcome:'Welcome', terms:'I agree to Mandarin Jam’s terms & policy', confirm:'Confirm', logout:'Sign out', close:'Close', err_email:'Email looks invalid.', err_code:'Code must be 6 digits.', sending:'Sending…', wait:'Check your email in a moment, then enter the code.' },
    zh: { signin:'登录', email:'邮箱', send:'发送验证码', sent:'验证码已发送 — 请查收邮箱（含垃圾箱）。', code:'输入6位验证码', verify:'验证', welcome:'欢迎', terms:'我同意 Mandarin Jam 的条款与政策', confirm:'确认', logout:'退出登录', close:'关闭', err_email:'邮箱格式不正确。', err_code:'验证码必须为6位数字。', sending:'发送中…', wait:'稍后查看邮箱并输入验证码。' },
    ko: { signin:'로그인', email:'이메일', send:'코드 보내기', sent:'코드를 보냈습니다 — 이메일(스팸 포함)을 확인하세요.', code:'6자리 코드 입력', verify:'확인', welcome:'환영합니다', terms:'Mandarin Jam 이용약관 및 정책에 동의합니다', confirm:'확인', logout:'로그아웃', close:'닫기', err_email:'이메일 형식이 올바르지 않습니다.', err_code:'코드는 6자리여야 합니다.', sending:'전송 중…', wait:'잠시 후 이메일을 확인하고 코드를 입력하세요.' }
  };
  function lang(){ return (window.__MJ_LANG__) || document.documentElement.lang || 'en'; }
  function t(k){ return (L[lang()] || L.en)[k] || L.en[k]; }

  var origin = location.protocol + '//' + location.host;
  function state(){ return { user:null, email:'', otp:'', step:'idle' }; }
  var st = state();

  var modalId = 'mj-account-modal';

  function css(){ return `
#${modalId}{position:fixed;inset:0;z-index:20000;display:flex;align-items:center;justify-content:center;background:rgba(15,20,20,.45);padding:16px;font-family:inherit}
#${modalId} .mj-ac-card{background:#fff;border-radius:16px;max-width:380px;width:100%;padding:22px;box-shadow:0 18px 50px rgba(0,0,0,.2);color:#111}
#${modalId} .mj-ac-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px}
#${modalId} .mj-ac-h b{font-size:17px}
#${modalId} .mj-ac-x{border:0;background:#f1f1f1;width:28px;height:28px;border-radius:8px;cursor:pointer;font-size:15px;line-height:1}
#${modalId} label{display:block;font-size:13px;color:#555;margin:10px 0 5px}
#${modalId} input{width:100%;box-sizing:border-box;padding:11px 12px;border:1px solid #e3e3e3;border-radius:10px;font-size:15px;color:#111}
#${modalId} .mj-ac-btn{width:100%;margin-top:12px;padding:12px;border:0;border-radius:10px;background:#111;color:#fff;font-size:15px;font-weight:600;cursor:pointer}
#${modalId} .mj-ac-btn:disabled{opacity:.5;cursor:default}
#${modalId} .mj-ac-note{font-size:12px;color:#888;margin-top:10px;line-height:1.5}
#${modalId} .mj-ac-err{font-size:13px;color:#c0392b;margin-top:10px}
#${modalId} .mj-ac-ok{font-size:13px;color:#2e7d32;margin-top:10px}
#${modalId} .mj-ac-terms{display:flex;gap:8px;align-items:flex-start;margin-top:14px;font-size:13px;color:#333;cursor:pointer}
#${modalId} .mj-ac-terms input{width:auto;margin-top:2px}
#${modalId} .mj-ac-user{font-size:14px;color:#333;text-align:center;margin:6px 0 2px;word-break:break-all}
#${modalId} .mj-ac-sub{font-size:12px;color:#888;text-align:center}
`; }

  function openModal(){
    var old = document.getElementById(modalId); if (old) old.remove();
    var d = document.createElement('div'); d.id = modalId;
    d.innerHTML = '<div class="mj-ac-card" role="dialog" aria-modal="true" aria-label="Account">'+
      '<div class="mj-ac-h"><b>' + (st.user ? t('welcome') : t('signin')) + '</b>' +
      '<button class="mj-ac-x" aria-label="' + t('close') + '">&times;</button></div>' +
      '<div class="mj-ac-body"></div></div>';
    d.querySelector('.mj-ac-x').onclick = closeModal;
    d.addEventListener('click', function(e){ if (e.target === d) closeModal(); });
    document.body.appendChild(d);
    renderBody();
  }
  function closeModal(){ var d = document.getElementById(modalId); if (d) d.remove(); }
  function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function api(method, path, body){
    return fetch(origin + path, { method: method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(j){ return { status: r.status, json: j }; }); });
  }

  function renderBody(){
    var body = document.querySelector('#' + modalId + ' .mj-ac-body');
    if (!body) return;
    if (st.user && st.user.registrationComplete) {
      body.innerHTML =
        '<div class="mj-ac-user">' + esc(st.user.email) + '</div>' +
        '<div class="mj-ac-sub">' + t('welcome') + '</div>' +
        '<button class="mj-ac-btn" id="mjAcLogout">' + t('logout') + '</button>';
      body.querySelector('#mjAcLogout').onclick = function(){
        api('POST', '/api/account/logout').then(function(r){
          st.user = null; renderBody();
          emit('logout');
        });
      };
      return;
    }
    if (st.user && !st.user.registrationComplete) {
      // terms consent step
      body.innerHTML =
        '<div class="mj-ac-user">' + esc(st.user.email) + '</div>' +
        '<label class="mj-ac-terms"><input type="checkbox" id="mjAcTerms"> <span>' + t('terms') + '</span></label>' +
        '<button class="mj-ac-btn" id="mjAcComplete" disabled>'+t('confirm')+'</button>';
      var cb = body.querySelector('#mjAcTerms');
      var btn = body.querySelector('#mjAcComplete');
      cb.onchange = function(){ btn.disabled = !cb.checked; };
      btn.onclick = function(){
        btn.disabled = true;
        api('POST', '/api/account/complete').then(function(r){
          emit('session', null);
          api('GET', '/api/account/me').then(function(m){ st.user = m.json && m.json.user; renderBody(); });
        });
      };
      return;
    }
    if (st.step === 'sent') {
      body.innerHTML =
        '<div class="mj-ac-ok">' + t('sent') + '</div>' +
        '<label>' + t('email') + '</label><input type="email" id="mjAcEmail" value="' + esc(st.email) + '" disabled>' +
        '<label>' + t('code') + '</label><input type="text" id="mjAcCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6">' +
        '<div class="mj-ac-note">' + t('wait') + '</div>' +
        '<div class="mj-ac-err" id="mjAcErr"></div>' +
        '<button class="mj-ac-btn" id="mjAcVerify">' + t('verify') + '</button>';
      body.querySelector('#mjAcVerify').onclick = function(){
        var code = body.querySelector('#mjAcCode').value.trim();
        var err = body.querySelector('#mjAcErr');
        if (!/^\d{6}$/.test(code)) { err.textContent = t('err_code'); return; }
        err.textContent = '';
        api('POST', '/api/auth/sign-in/email-otp', { email: st.email, otp: code }).then(function(r){
          if (r.status !== 200) { err.textContent = (r.json && r.json.code === 'INVALID_CODE') ? t('err_code') : (r.json && r.json.message) || 'Error'; return; }
          // signed cookie set by server; fetch current session
          api('GET', '/api/account/me').then(function(m){
            st.user = m.json && m.json.user || {};
            if (!st.user.emailVerified && m.status === 401) { st.user = null; renderBody(); }
            else renderBody();
          });
        });
      };
      return;
    }
    // idle: email entry
    body.innerHTML =
      '<label>' + t('email') + '</label>' +
      '<input type="email" id="mjAcEmail" value="' + esc(st.email) + '" placeholder="you@example.com" autocomplete="email">' +
      '<div class="mj-ac-err" id="mjAcErr"></div>' +
      '<button class="mj-ac-btn" id="mjAcSend">' + t('send') + '</button>' +
      '<div class="mj-ac-note">' + t('wait') + '</div>';
    var inp = body.querySelector('#mjAcEmail');
    inp.focus();
    function doSend(){
      var email = inp.value.trim().toLowerCase();
      var err = body.querySelector('#mjAcErr');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { err.textContent = t('err_email'); return; }
      err.textContent = '';
      var btn = body.querySelector('#mjAcSend'); btn.disabled = true; btn.textContent = t('sending');
      api('POST', '/api/auth/email-otp/send-verification-otp', { email: email, type: 'sign-in' }).then(function(r){
        if (r.status !== 200) { btn.disabled = false; btn.textContent = t('send'); err.textContent = (r.json && r.json.message) || 'Error'; return; }
        st.email = email; st.step = 'sent'; renderBody();
      });
    }
    body.querySelector('#mjAcSend').onclick = doSend;
    inp.addEventListener('keydown', function(e){ if (e.key === 'Enter') doSend(); });
  }

  function emit(evt){ try { window.dispatchEvent(new CustomEvent('mj:account', { detail: { event: evt, user: st.user } })); } catch(e){} }

  // ---- header button injection ----
  function injectButton(){
    var actions = document.querySelector('.header-actions');
    if (!actions) return;
    if (document.getElementById('mj-account-btn')) return;
    var b = document.createElement('button');
    b.id = 'mj-account-btn'; b.type = 'button';
    b.style.cssText = 'display:inline-flex;align-items:center;gap:6px;background:none;border:0;cursor:pointer;color:inherit;font-size:14px;font-weight:500;padding:6px 4px';
    b.innerHTML = '<span class="hd-label" data-i18n="signin"></span>';
    b.setAttribute('data-i18n', 'signin');
    b.addEventListener('click', function(){ openModal(); });
    actions.insertBefore(b, actions.querySelector('.cart-btn'));
    // insert translations into app i18n dict if available
    applyLabel(b);
  }
  function applyLabel(b){
    // reuse app i18n if present
    var txt = t('signin');
    if (b) b.innerHTML = '<span class="hd-label">' + esc(txt) + '</span>';
    if (window.__MJ_SET_I18N__) { try { window.__MJ_SET_I18N__('signin', { vi:'Đăng nhập', en:'Sign in', zh:'登录', ko:'로그인' }); } catch(e){} }
  }

  // on load: try to restore session (silent); open the sign-in modal if a ?login=1 recovery
  // param is present (return/ticket pages route here for auth without consuming the handoff)
  function boot(){
    injectButton();
    var wantLogin = /[?&]login=1\b/.test(location.search);
    var tmr = setTimeout(function(){ closeModal(); }, 2000);
    api('GET', '/api/account/me').then(function(m){
      if (m.status === 200 && m.json && m.json.user) { st.user = m.json.user; applyLabel();
        if (wantLogin && location.search.indexOf('next=') !== -1) {
          var next = new URLSearchParams(location.search).get('next');
          if (next) { try { window.location.href = next; } catch(e){} }
        }
      } else if (wantLogin) { openModal(); }
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
