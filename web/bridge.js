/*
 * スクロール学習（iPhoneアプリ版）の橋渡し
 *
 * 1. アーティファクトが使っている window.claude.use('db' / 'user') を、
 *    Firebase（匿名ログイン＋Firestore）で同じ形に作り直す。
 * 2. window.claude.use('sample')（Claudeにポストを書かせる機能）のかわりに、
 *    アプリの中に入っている事前生成ポストから出す。通信はしない。
 * 3. iPhoneの機能（毎日のリマインド通知・振動・共有シート・文字の大きさ）を、
 *    アプリ本体から呼べるようにする。
 * 4. 設定画面に、通知・文字の大きさ・アカウント削除・利用規約・プライバシーポリシーを足す。
 *
 * window.__SS_FIREBASE__ はビルド時に firebase-config.json から埋め込まれる。
 * 設定が空（null）のときや、通信できないときは、アプリ本体が「この端末のみ」で動く。
 *
 * このファイルは直接アプリに入る。アプリ本体（scroll-study.html）は書き換えず、
 * 書き換えが必要なところは scripts/build-web.mjs の PATCHES に書く。
 */
(function () {
  'use strict';

  var RN = window.ReactNativeWebView || null;
  window.SS_APP = true;
  window.SS_NATIVE = !!RN;

  // 問い合わせ先。ビルド時に app-meta.json から置き換えられる。
  var SUPPORT_EMAIL = '__SUPPORT_EMAIL__';
  var SUPPORT_URL = '__SUPPORT_URL__';
  var OPERATOR = '__OPERATOR__';

  function post(msg) {
    try { if (RN) RN.postMessage(JSON.stringify(msg)); } catch (e) {}
  }
  var ENT = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ENT[c]; });
  }
  function app() { return window.ssApp || null; }
  function toast(msg) { var a = app(); if (a && a.toast) { try { a.toast(msg); } catch (e) {} } }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function store(k, v) {
    try {
      if (v === undefined) { var s = localStorage.getItem(k); return s == null ? null : JSON.parse(s); }
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
    return null;
  }

  /* ======================= 1. Firebase ======================= */

  var CFG = window.__SS_FIREBASE__ || null;
  var EMU = window.__SS_EMULATOR__ || null; // テスト用（本番では使わない）
  var fb = window.firebase;
  var ready = Promise.resolve(null);
  var fs = null, auth = null;
  var MY_UID = '';

  if (CFG && CFG.apiKey && CFG.projectId && fb && typeof fb.initializeApp === 'function') {
    try {
      fb.initializeApp(CFG);
      auth = fb.auth();
      fs = fb.firestore();
      if (EMU) {
        auth.useEmulator('http://' + EMU.auth);
        var eh = EMU.firestore.split(':');
        fs.useEmulator(eh[0], Number(eh[1]));
      }
      ready = new Promise(function (resolve) {
        var done = false;
        function finish(u) { if (!done) { done = true; resolve(u || null); } }
        // 通信できないまま待ち続けないように、10秒で「この端末のみ」に切り替える
        setTimeout(function () { finish(auth.currentUser); }, 10000);
        auth.signInAnonymously()
          .then(function (cred) { finish(cred && cred.user); })
          .catch(function () { finish(auth.currentUser); });
      });
    } catch (e) {
      ready = Promise.resolve(null);
    }
  }

  var userCap = {
    id: function () {
      return ready.then(function (u) { if (!u) throw new Error('not signed in'); return u.uid; });
    },
    isOwner: function () { return Promise.resolve(false); },
    can: function () { return true; },
    deleteAccount: function () {
      var u = auth && auth.currentUser;
      return u ? u.delete().catch(function () {}) : Promise.resolve();
    }
  };

  if (fs) {
    window.claude = {
      use: function (name) {
        if (name === 'db') return ready.then(function (u) { return u ? fs : null; });
        if (name === 'user') return ready.then(function (u) { return u ? userCap : null; });
        // 'sample' は使わない。ポストはアプリの中に入っている。
        return Promise.resolve(null);
      }
    };
  }

  ready.then(function (u) {
    if (u) { MY_UID = u.uid; repaint(); }
  }).catch(function () {});

  /* ==================== 2. 事前生成ポスト ==================== */
  /*
   * 分野ごとに1ファイル。選んだ分野の分だけ、iPhone側から受け取る。
   * 詰めた形（配列）で持ち、使うときにアプリ本体が読める形に戻す。
   *   [種類, 細目, 見出し, タグ, 用語, ...種類ごとの中身]
   */

  var POSTS = {};       // 分野id -> ポストの配列（展開後）
  var ASKED = {};       // 分野id -> 読み込み中の Promise
  var ASK_DONE = {};    // 分野id -> resolve 関数

  var TYPE = { t: 'tip', q: 'quiz', c: 'card', m: 'myth', d: 'dialog' };
  var ACCT = { s: 'sensei', b: 'bot', n: 'note' };
  var SOLVE = { tip: 1, myth: 1, dialog: 1 };   // 解説系
  var CHECK = { quiz: 1, card: 1 };             // 確認系

  function expand(a) {
    if (!a || !a.length) return null;
    var type = TYPE[a[0]];
    if (!type) return null;
    var o = { type: type, key: a[2] || '', tags: a[3] || [], terms: [] };
    if (a[1]) o.item = a[1];
    var raw = a[4] || [];
    for (var i = 0; i < raw.length; i++) {
      var x = raw[i];
      if (x && x.length >= 2) o.terms.push({ w: x[0], r: x[1] || '', m: x[2] == null ? x[1] : x[2] });
    }
    if (type === 'tip') { o.acct = ACCT[a[5]] || 'sensei'; o.text = a[6]; o.thread = a[7] || []; }
    else if (type === 'quiz') { o.text = a[5]; o.options = a[6]; o.answer = a[7]; o.explain = a[8] || ''; }
    else if (type === 'card') { o.text = a[5]; o.back = a[6]; o.note = a[7] || ''; }
    else if (type === 'myth') { o.text = a[5]; o.wrong = a[6]; o.right = a[7]; o.why = a[8] || ''; }
    else if (type === 'dialog') {
      o.lines = [];
      var ls = a[5] || [];
      for (var j = 0; j < ls.length; j++) o.lines.push([ls[j][0] === 's' ? 'suzume' : 'owl', ls[j][1]]);
    }
    return o;
  }

  // iPhone側が、分野のポストを渡してくる
  window.ssPosts = function (field, json) {
    var list = [];
    if (json) {
      try {
        var arr = JSON.parse(json) || [];
        for (var i = 0; i < arr.length; i++) { var o = expand(arr[i]); if (o) list.push(o); }
      } catch (e) { list = []; }
    }
    POSTS[field] = list;
    var done = ASK_DONE[field];
    if (done) { delete ASK_DONE[field]; done(list); }
  };

  function needPosts(field) {
    if (POSTS[field]) return Promise.resolve(POSTS[field]);
    if (ASKED[field]) return ASKED[field];
    ASKED[field] = new Promise(function (resolve) {
      ASK_DONE[field] = resolve;
      if (!RN) { POSTS[field] = []; delete ASK_DONE[field]; resolve([]); return; }
      post({ type: 'posts', field: field });
      // 返事が来ないときは、5秒であきらめる
      setTimeout(function () {
        if (ASK_DONE[field]) { delete ASK_DONE[field]; POSTS[field] = POSTS[field] || []; resolve(POSTS[field]); }
      }, 5000);
    });
    return ASKED[field];
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /*
   * アプリ本体の generate() から呼ばれる。Claudeのかわりに、事前生成ポストを流す。
   *   plan: [{t: 項目, it: 細目, c: 件数, focus: bool}, ...]
   *   seen: {項目id: Set(すでに出した見出し)}
   * 返り値は、アプリ本体が sample(prompt, opts) として呼べる関数。
   */
  window.ssSample = function (plan, n, seen) {
    return function (prompt, opts) {
      opts = opts || {};
      var signal = opts.signal;
      var emit = opts.onText || function () {};
      var fields = {};
      for (var i = 0; i < plan.length; i++) if (plan[i].t && plan[i].t.cat) fields[plan[i].t.cat] = 1;

      return Promise.all(Object.keys(fields).map(needPosts)).then(function () {
        var chosen = [];
        var used = {};

        plan.forEach(function (e) {
          var t = e.t;
          if (!t || !t.cat) return;
          var all = POSTS[t.cat] || [];
          var seenSet = (seen && seen[t.id]) || null;
          function isSeen(key) { return !!(seenSet && key && seenSet.has(key)); }
          function mark(o) { return o.key + '|' + t.id; }

          // まず、指定された細目の・まだ見ていないものを集める
          var pool = all.filter(function (o) {
            if (used[mark(o)]) return false;
            if (e.it && o.item !== e.it.k) return false;
            return !isSeen(o.key);
          });
          // 足りなければ、同じ項目の他の細目からも足す
          if (pool.length < e.c && e.it) {
            for (var k = 0; k < all.length && pool.length < e.c * 2; k++) {
              var o2 = all[k];
              if (used[mark(o2)] || isSeen(o2.key) || o2.item === e.it.k) continue;
              pool.push(o2);
            }
          }
          // それでも足りなければ、見たものも許す（見終わったあとも止まらないように）
          if (!pool.length) {
            pool = all.filter(function (o) { return !used[mark(o)] && (!e.it || o.item === e.it.k); });
            if (!pool.length) pool = all.filter(function (o) { return !used[mark(o)]; });
          }

          // 解説系 → 確認系 の順に並べる（アプリ本体の組み立て方に合わせる）
          var solve = pool.filter(function (o) { return SOLVE[o.type]; });
          var check = pool.filter(function (o) { return CHECK[o.type]; });
          for (var c = 0; c < e.c; c++) {
            var src = (c % 2 === 0) ? solve : check;
            var alt = (c % 2 === 0) ? check : solve;
            var o3 = src.shift() || alt.shift();
            if (!o3) break;
            used[mark(o3)] = 1;
            var copy = {};
            for (var p in o3) if (Object.prototype.hasOwnProperty.call(o3, p)) copy[p] = o3[p];
            copy.topic = t.id;
            chosen.push(copy);
          }
        });

        // 1件ずつ、少し間をおいて流す（アプリ本体は届いた順に表示する）
        var idx = 0;
        function step() {
          if (signal && signal.aborted) {
            var err = new Error('cancelled'); err.code = 'cancelled';
            return Promise.reject(err);
          }
          if (idx >= chosen.length) return Promise.resolve({ text: '', truncated: false });
          emit({ delta: JSON.stringify(chosen[idx]) });
          idx++;
          return sleep(idx === 1 ? 50 : 90 + Math.floor(Math.random() * 80)).then(step);
        }
        return step();
      });
    };
  };

  /* ================= 3. iPhoneの機能 ================= */

  // 振動（正解・不正解）
  window.ssHaptic = function (kind) { post({ type: 'haptic', kind: kind || 'success' }); };

  // 共有シート（ポストのテキストを、メモ・メール・メッセージなどに渡す）
  window.ssShare = function (text) {
    text = String(text || '');
    if (!text) return;
    if (RN) { post({ type: 'share', text: text.slice(0, 4000) }); return; }
    // iPhoneアプリ以外（テストやブラウザ）では、コピーで代用する
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { toast('テキストをコピーしました'); },
          function () { toast('コピーできませんでした'); }
        );
        return;
      }
    } catch (e) {}
    toast('コピーできませんでした');
  };

  /* ---- 毎日のリマインド通知 ---- */
  var REM_KEY = 'scrollstudy.reminder.v1';
  function getRem() {
    var j = store(REM_KEY);
    if (j && typeof j.on === 'boolean' && j.h >= 0 && j.h < 24 && (j.m === 0 || j.m === 30)) return j;
    return { on: false, h: 21, m: 0 };
  }
  function setRem(r) { store(REM_KEY, r); }

  /* ---- 文字の大きさ ---- */
  var FONT_KEY = 'scrollstudy.fontsize.v1';
  var STEPS = [
    { k: 's', label: '小', pct: 90 },
    { k: 'm', label: '標準', pct: 100 },
    { k: 'l', label: '大', pct: 115 },
    { k: 'xl', label: '特大', pct: 132 }
  ];
  function stepOf(k) {
    for (var i = 0; i < STEPS.length; i++) if (STEPS[i].k === k) return STEPS[i];
    return STEPS[1];
  }
  function getFont() {
    var j = store(FONT_KEY);
    if (j && j.k && stepOf(j.k).k === j.k) return j;
    return { k: 'm', auto: true };
  }
  function applyFont(k) {
    var pct = stepOf(k).pct;
    try {
      var el = document.documentElement;
      el.style.webkitTextSizeAdjust = pct + '%';
      el.style.textSizeAdjust = pct + '%';
    } catch (e) {}
  }
  function setFont(k, auto) {
    store(FONT_KEY, { k: k, auto: !!auto });
    applyFont(k);
  }
  // iPhoneの「文字の大きさ」設定から、近い段階を選ぶ
  function stepFromScale(scale) {
    if (scale >= 1.25) return 'xl';
    if (scale >= 1.1) return 'l';
    if (scale <= 0.92) return 's';
    return 'm';
  }
  applyFont(getFont().k);

  /* ---- iPhone側からの返事 ---- */
  window.ssFromNative = function (msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'font-scale') {
      var f = getFont();
      // 自分で選んでいない人だけ、iPhoneの設定に合わせる
      if (f.auto !== false) setFont(stepFromScale(Number(msg.scale) || 1), true);
      return;
    }

    if (msg.type === 'reminder-result') {
      if (msg.ok) {
        if (!msg.silent) {
          toast(msg.on ? '毎日 ' + msg.hour + ':' + pad(msg.minute) + ' に通知します' : '毎日の通知をオフにしました');
        }
        return;
      }
      var r = getRem(); r.on = false; setRem(r); repaint();
      if (!msg.silent) {
        toast(msg.reason === 'denied'
          ? '通知が許可されていません。iPhoneの「設定」→「スクロール学習」→「通知」から許可してください。'
          : '通知を設定できませんでした。もう一度お試しください。');
      }
    }
  };

  /* ================= 4. 設定画面に足す欄 ================= */

  function repaint() {
    var a = app();
    if (a && a.renderTopics && a.view && a.view() === 'topics') { try { a.renderTopics(); } catch (e) {} }
  }

  // 「学ぶ項目」画面では「＋」ボタンを隠す。
  // この画面の下のほうに、設定とアカウント削除のボタンが並ぶので、
  // 浮いているボタンが重なって押せない・見つからない、ということがないようにする。
  (function addStyle() {
    try {
      var s = document.createElement('style');
      s.textContent = 'body.ss-nofab .fab{display:none!important}' +
        '#view-topics{padding-bottom:24px}' +
        '.seg button[role="radio"]{white-space:nowrap}';
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  })();

  function segHtml(name, items, cur) {
    var h = '<div class="seg" role="radiogroup" aria-label="' + esc(name) + '">';
    for (var i = 0; i < items.length; i++) {
      h += '<button role="radio" data-ss="' + esc(items[i].act) + '" data-v="' + esc(items[i].v) +
        '" aria-checked="' + (items[i].v === cur) + '">' + esc(items[i].label) + '</button>';
    }
    return h + '</div>';
  }

  // 「学ぶ項目」画面に入れる設定欄
  window.ssSettingsHtml = function () {
    var h = '';

    /* 毎日のリマインド（iPhoneアプリのときだけ） */
    if (RN) {
      var r = getRem();
      var opts = '';
      for (var hh = 5; hh <= 23; hh++) {
        for (var mi = 0; mi < 2; mi++) {
          var mm = mi * 30;
          var sel = (hh === r.h && mm === r.m) ? ' selected' : '';
          opts += '<option value="' + hh + ':' + mm + '"' + sel + '>' + hh + ':' + pad(mm) + '</option>';
        }
      }
      h += '<div class="dsec">毎日のリマインド</div>' +
        segHtml('毎日のリマインド', [
          { act: 'rem', v: 'off', label: 'オフ' },
          { act: 'rem', v: 'on', label: 'オン' }
        ], r.on ? 'on' : 'off') +
        '<div class="svnote">決めた時刻に、今日のポストを読むよう通知が届きます。' +
        '通知はこのiPhoneの中だけで設定され、運営者には送られません。</div>' +
        '<div class="trow"><div class="tinfo"><b>通知する時刻</b></div><div class="tbtns">' +
        '<select id="ss-rem-time" aria-label="通知する時刻"' + (r.on ? '' : ' disabled') +
        ' style="font:inherit;color:inherit;background:var(--raise);border:1px solid var(--line);border-radius:999px;padding:8px 14px">' +
        opts + '</select></div></div>';
    }

    /* 文字の大きさ */
    var f = getFont();
    var items = [];
    for (var i = 0; i < STEPS.length; i++) items.push({ act: 'font', v: STEPS[i].k, label: STEPS[i].label });
    h += '<div class="dsec">文字の大きさ</div>' + segHtml('文字の大きさ', items, f.k) +
      '<div class="svnote">' +
      (f.auto === false
        ? 'いま、自分で選んだ大きさにしています。iPhoneの設定に合わせ直すときは、下の「iPhoneの設定に合わせる」を押してください。'
        : 'iPhoneの「設定」→「画面表示と明るさ」→「テキストサイズ」に合わせています。') +
      '</div>' +
      (f.auto === false
        ? '<div class="trow"><div class="tinfo"><b>iPhoneの設定に合わせる</b></div>' +
          '<div class="tbtns"><button class="pill sm" data-ss="font-auto">合わせる</button></div></div>'
        : '');

    return h;
  };

  // 利用規約・プライバシーポリシーへの入口
  window.ssLegalHtml = function () {
    return '<div class="dsec">このアプリについて</div>' +
      '<div class="trow"><div class="tinfo"><b>利用規約</b></div>' +
      '<div class="tbtns"><button class="pill sm" data-ss="terms">開く</button></div></div>' +
      '<div class="trow"><div class="tinfo"><b>プライバシーポリシー</b></div>' +
      '<div class="tbtns"><button class="pill sm" data-ss="privacy">開く</button></div></div>' +
      '<div class="trow"><div class="tinfo"><b>お問い合わせ・サポート</b>' +
      '<small>' + esc(SUPPORT_EMAIL) + '</small></div>' +
      '<div class="tbtns"><button class="pill sm" data-ss="support">開く</button></div></div>';
  };

  // アカウントとデータの削除（Firebaseに保存している場合に必要）
  window.ssDeleteHtml = function () {
    if (!fs) return '';
    return '<div class="dsec">アカウント</div>' +
      (MY_UID
        ? '<div class="trow"><div class="tinfo"><b>利用者ID</b>' +
          '<small style="word-break:break-all;user-select:all;-webkit-user-select:all">' + esc(MY_UID) + '</small>' +
          '<small>お問い合わせのときに伝えてください。</small></div>' +
          '<div class="tbtns"><button class="pill sm" data-ss="copy-id">コピー</button></div></div>'
        : '<div class="svnote">まだこの端末だけで動いています（通信できないか、設定が済んでいません）。</div>') +
      '<div class="svnote">削除すると、この端末とサーバーの両方から、学習の記録・用語集・いいね・ブックマーク・' +
      '自分のポストがすべて消えます。元に戻すことはできません。</div>' +
      '<button class="reset" data-ss="del-account">アカウントとデータを削除する</button>';
  };

  /* ---- 規約・ポリシーの本文（docs/index.html と同じ文章にする） ---- */

  var TERMS_HTML =
    '<h3>利用規約</h3>' +
    '<p>このアプリ「スクロール学習」（以下「本アプリ」）をお使いになる方（以下「利用者」）は、' +
    'この規約に同意したものとみなします。</p>' +
    '<p class="lbl">1. 使い方</p>' +
    '<p>本アプリは、資格試験や教養分野の学習を助けるためのものです。個人の学習の範囲でご自由にお使いください。' +
    '本アプリの内容を、無断で複製・配布・販売することはできません。</p>' +
    '<p class="lbl">2. 学習内容について</p>' +
    '<p>本アプリに入っている問題・解説・用語の説明は、作成した時点で確認できた資料にもとづいています。' +
    '各分野の画面に、どの時点の情報かを書いています。法令・試験の形式・税制・統計は変わります。' +
    '<b>大事なことは、必ず試験の実施団体や官公庁の公式の発表を確認してください。</b>' +
    '本アプリの内容を根拠にした判断について、運営者は責任を負いません。</p>' +
    '<p class="lbl">3. 禁止すること</p>' +
    '<p>本アプリを分解したり、通信を改変したりすること、法令に反する目的で使うことはできません。</p>' +
    '<p class="lbl">4. 止まること・終わること</p>' +
    '<p>通信の状態や保存先のサービスの都合で、本アプリの一部が使えなくなることがあります。' +
    '運営者は、予告なく本アプリの内容を変えたり、提供を終えることがあります。</p>' +
    '<p class="lbl">5. 責任の範囲</p>' +
    '<p>運営者は、本アプリを使ったことで生じた損害について、法令で免れられない場合を除き責任を負いません。</p>' +
    '<p class="lbl">6. 準拠法</p>' +
    '<p>この規約は日本法にしたがいます。</p>' +
    '<p class="lbl">運営者</p>' +
    '<p>' + esc(OPERATOR) + '<br>お問い合わせ：' + esc(SUPPORT_EMAIL) + '</p>';

  var PRIVACY_HTML =
    '<h3>プライバシーポリシー</h3>' +
    '<p>運営者（' + esc(OPERATOR) + '）は、本アプリでお預かりする情報を次のように扱います。</p>' +
    '<p class="lbl">1. 集める情報</p>' +
    '<p>本アプリは、氏名・メールアドレス・電話番号・住所・生年月日などの、あなたを直接特定する情報を集めません。' +
    'アカウントの作成に、メールアドレスやパスワードは要りません。</p>' +
    '<p>保存するのは、次の学習の記録だけです。</p>' +
    '<p>・選んだ学ぶ項目と、その設定<br>' +
    '・クイズと一問一答の成績、苦手リスト、どの細目を学んだかの記録<br>' +
    '・用語集にたまった用語<br>' +
    '・いいね・ブックマークしたポスト<br>' +
    '・自分で書いたポストと、ポストに残したメモ<br>' +
    '・文字の大きさなど、アプリの設定</p>' +
    '<p>また、あなたの端末を見分けるために、本アプリが自動で作る<b>匿名の利用者ID</b>（ランダムな文字列）を使います。' +
    'このIDから、あなたが誰かはわかりません。</p>' +
    '<p class="lbl">2. 使う目的</p>' +
    '<p>学習の記録を保存し、次に開いたときに続きから使えるようにするためだけに使います。' +
    '広告の配信や、利用状況を分析する外部のツールには使っていません（そうしたツールを入れていません）。</p>' +
    '<p class="lbl">3. 保存する場所と、外部への委託</p>' +
    '<p>学習の記録と匿名の利用者IDは、米国の Google LLC が提供するクラウドサービス' +
    '<b>「Firebase」（Firebase Authentication と Cloud Firestore）</b>に保存します。' +
    'そのため、情報は日本国外のサーバーで取り扱われることがあります。' +
    'Google LLC は運営者の委託先であり、Googleのプライバシーポリシーにしたがって取り扱われます。</p>' +
    '<p>保存した記録は、その利用者ID本人以外は読み書きできないように設定しています。運営者も個別の内容は見ません。</p>' +
    '<p class="lbl">4. 第三者への提供</p>' +
    '<p>上の委託を除き、あなたの情報を第三者に提供・販売することはありません。' +
    '法令にもとづく開示の求めがあった場合を除きます。</p>' +
    '<p class="lbl">5. 通知について</p>' +
    '<p>毎日のリマインド通知は、あなたのiPhoneの中だけで設定され、運営者やサーバーには送られません。' +
    '本アプリはプッシュ通知（運営者から送る通知）を使いません。</p>' +
    '<p class="lbl">6. 外部サイトへのリンク</p>' +
    '<p>出典のリンクを押すと、Safariで外部のサイトが開きます。' +
    'リンク先での情報の扱いは、そのサイトの方針にしたがいます。</p>' +
    '<p class="lbl">7. 削除のしかた</p>' +
    '<p>アプリの「学ぶ項目」画面の<b>「アカウントとデータを削除する」</b>から、' +
    'いつでも、端末とサーバーの両方の記録をすべて消せます。' +
    '削除すると匿名の利用者IDも消え、元に戻すことはできません。</p>' +
    '<p class="lbl">8. 子どもの利用について</p>' +
    '<p>本アプリは、あなたを特定する情報を集めません。年齢にかかわらず、同じ扱いをします。</p>' +
    '<p class="lbl">9. この方針の変更</p>' +
    '<p>内容を変えるときは、本アプリとサポートページの記載を新しくします。</p>' +
    '<p class="lbl">お問い合わせ</p>' +
    '<p>' + esc(OPERATOR) + '<br>' + esc(SUPPORT_EMAIL) + '</p>';

  function sheet(html) {
    var a = app();
    if (a && a.openSheet) { a.openSheet(html + '<div class="row2"><button class="btn" data-act="close-sheet">閉じる</button></div>'); }
  }

  /* ---- ボタンの処理（アプリ本体の data-act とぶつからないよう data-ss を使う） ---- */

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-ss]') : null;
    if (!el) return;
    var act = el.getAttribute('data-ss');
    var v = el.getAttribute('data-v') || '';

    if (act === 'rem') {
      var r = getRem();
      r.on = (v === 'on');
      setRem(r); repaint();
      post({ type: 'reminder', on: r.on, hour: r.h, minute: r.m, ask: true });
      return;
    }
    if (act === 'font') { setFont(v, false); repaint(); return; }
    if (act === 'font-auto') {
      setFont(getFont().k, true); repaint();
      toast('iPhoneの設定に合わせます。アプリを開き直すと反映されます');
      return;
    }
    if (act === 'terms') { sheet(TERMS_HTML); return; }
    if (act === 'privacy') { sheet(PRIVACY_HTML); return; }
    if (act === 'support') {
      sheet('<h3>お問い合わせ・サポート</h3>' +
        '<p>ご質問・不具合のご報告は、次のあて先までお送りください。</p>' +
        '<p class="lbl">メール</p><p style="user-select:all;-webkit-user-select:all">' + esc(SUPPORT_EMAIL) + '</p>' +
        '<p class="lbl">サポートページ</p><p><a href="' + esc(SUPPORT_URL) + '" target="_blank" rel="noopener">' +
        esc(SUPPORT_URL) + '</a></p>' +
        (MY_UID ? '<p class="lbl">利用者ID（お伝えいただくと調べられます）</p>' +
          '<p style="word-break:break-all;user-select:all;-webkit-user-select:all">' + esc(MY_UID) + '</p>' : ''));
      return;
    }
    if (act === 'copy-id') {
      var id = MY_UID;
      if (!id) return;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(id).then(
            function () { toast('利用者IDをコピーしました'); },
            function () { toast('利用者ID：' + id); }
          );
          return;
        }
      } catch (err) {}
      toast('利用者ID：' + id);
      return;
    }
    if (act === 'del-account') {
      if (el.getAttribute('data-confirm') !== '1') {
        el.setAttribute('data-confirm', '1');
        el.textContent = 'もう一度押すと、すべての記録を消します（元に戻せません）';
        return;
      }
      el.textContent = '削除しています…';
      el.setAttribute('data-ss', 'busy');
      deleteEverything();
      return;
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || t.id !== 'ss-rem-time') return;
    var parts = String(t.value || '21:0').split(':');
    var r = getRem();
    r.h = Number(parts[0]) || 0;
    r.m = Number(parts[1]) === 30 ? 30 : 0;
    setRem(r);
    post({ type: 'reminder', on: r.on, hour: r.h, minute: r.m, ask: true });
  });

  /* ---- アカウントとデータを、まるごと消す ---- */
  function deleteEverything() {
    var steps = Promise.resolve();

    // 1. サーバーの記録を消す
    if (fs && MY_UID) {
      steps = steps.then(function () {
        return fs.collection('data/users/' + MY_UID).get().then(function (snap) {
          var jobs = [];
          snap.forEach(function (d) { jobs.push(d.ref.delete().catch(function () {})); });
          return Promise.all(jobs);
        }).catch(function () {});
      });
    }
    // 2. ログインの情報（匿名アカウント）を消す
    steps = steps.then(function () { return userCap.deleteAccount(); });
    // 3. 通知の予約を取り消す
    steps = steps.then(function () {
      setRem({ on: false, h: 21, m: 0 });
      post({ type: 'reminder', on: false, hour: 21, minute: 0, ask: false });
    });
    // 4. この端末の記録を消す
    steps = steps.then(function () {
      try { localStorage.clear(); } catch (e) {}
    });
    // 5. はじめからやり直す
    steps.then(function () {
      try { location.reload(); } catch (e) {}
    }).catch(function () {
      try { localStorage.clear(); location.reload(); } catch (e) {}
    });
  }

  /* ---- 起動したら、保存してある設定で通知を予約し直す（許可の確認は出さない） ---- */
  if (RN) {
    var r0 = getRem();
    post({ type: 'reminder', on: r0.on, hour: r0.h, minute: r0.m, ask: false });
  }
})();
