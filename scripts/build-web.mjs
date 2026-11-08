// web/scroll-study.html（Claudeのアーティファクトのまま）から、
// iPhoneアプリに入れる src/webHtml.js を作る。
//
//   node scripts/build-web.mjs
//
// やっていること
//   1. アプリ本体に、iPhoneアプリ用の書き換えをする（PATCHES / REPLACE_ALL）
//   2. Firebase（app / auth / firestore の compat版）と設定、web/bridge.js を <head> に入れる
//   3. 1つの文字列として src/webHtml.js に書き出す
//
// 書き換えの目印が「ちょうど1か所」に見つからなければ、エラーで止まる。
// アーティファクトを更新したら、web/scroll-study.html を差し替えてこれを実行し直す。
//
// テスト用のオプション
//   --out=<path>              そのままのHTMLとして書き出す（ブラウザで開く用）
//   --no-sdk                  Firebase の本体を入れない（テスト側の偽物を使う）
//   --emulator=a:p,f:p        Firebase エミュレータに向ける
//   --posts                   ポストをHTMLに直接入れる（iPhone側がいないテスト用）
//   --check                   作るだけで、終了コードを0にする

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const args = new Set(process.argv.slice(2));
const outArg = process.argv.find((a) => a.startsWith('--out='));
const emuArg = process.argv.find((a) => a.startsWith('--emulator='));

let html = read('web/scroll-study.html');

const die = (msg) => {
  console.error('ビルドを中止しました：' + msg);
  process.exit(1);
};

/* ================= 0. アプリの情報（問い合わせ先など） ================= */

const meta = JSON.parse(read('app-meta.json'));
for (const k of ['supportEmail', 'supportUrl', 'operator']) {
  if (!meta[k] || String(meta[k]).includes('__')) {
    die(`app-meta.json の "${k}" が空です。先に埋めてください。`);
  }
}

/* ================= 1. 書き換え ================= */

// [説明, 探す文字列, 置き換える文字列]
// 探す文字列は、ちょうど1か所にないとエラーにする。
const PATCHES = [
  [
    'アプリ名に合わせてタイトルを変える',
    '<title>学びタイムライン</title>',
    '<title>スクロール学習</title>',
  ],
  [
    'ヘッダーのロゴの名前を変える',
    '<div class="logo"><b>学</b><span>学びTL</span></div>',
    '<div class="logo"><b>学</b><span>スクロール学習</span></div>',
  ],
  [
    '入力欄を押したときに画面が拡大されないようにする',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover">',
  ],
  [
    'アクセント色を、このアプリの色（インディゴ）にする',
    '  --accent:#1d9bf0; --like:#f91880; --rt:#00ba7c; --ng:#f4212e;',
    '  --accent:#4f46e5; --like:#f91880; --rt:#00ba7c; --ng:#f4212e;',
  ],
  [
    '暗い画面でも読めるように、アクセント色を明るいインディゴにする',
    '    --hover:rgba(231,233,234,.035); --veil:rgba(0,0,0,.72); --shade:rgba(91,112,131,.4);',
    '    --accent:#818cf8;\n    --hover:rgba(231,233,234,.035); --veil:rgba(0,0,0,.72); --shade:rgba(91,112,131,.4);',
  ],

  /* ---- ポストの出どころを、Claudeからアプリの中のデータに変える ---- */
  [
    'ポストを、アプリの中に入っている事前生成データから出す',
    "  const sample = await getSample();\n" +
      '  if (!sample){\n' +
      "    GEN.busy = false; GEN.disabled = 'この画面ではClaudeを呼び出せないため、新しいポストを作れません。claude.ai でこのページを開いてください。';",
    '  const sample = window.ssSample ? window.ssSample(plan, n, seenBefore) : await getSample();\n' +
      '  if (!sample){\n' +
      "    GEN.busy = false; GEN.disabled = 'ポストを読み込めませんでした。アプリを開き直してください。';",
  ],
  [
    'Claudeのエラー文を、アプリ用の文に変える',
    "    case 'not_granted': return 'Claudeの利用が許可されなかったため、新しいポストを作れません。ページを開き直すと、もう一度確認できます';\n" +
      "    case 'sampling_disabled': return 'このアカウントではClaudeを呼び出せないため、新しいポストを作れません';\n" +
      "    case 'not_declared': case 'capability_disabled': case 'capability_removed': return 'この画面ではClaudeを呼び出せないため、新しいポストを作れません';\n" +
      "    case 'rate_limited': return '使用量の上限か混雑のため、少し時間をおいてからもう一度どうぞ';\n" +
      "    case 'session_expired': return 'claude.ai にもう一度サインインしてください';",
    "    case 'not_granted': case 'sampling_disabled': case 'not_declared': case 'capability_disabled': case 'capability_removed':\n" +
      "      return 'ポストを読み込めませんでした。アプリを開き直してください';\n" +
      "    case 'rate_limited': case 'session_expired': return '少し時間をおいてから、もう一度お試しください';",
  ],
  [
    '読み込み中の文から「Claudeが」を外す（上部）',
    "  if (!tg.hidden) $('span', tg).textContent = 'Claudeが' + GEN.label + 'の新しいポストを書いています…';",
    "  if (!tg.hidden) $('span', tg).textContent = GEN.label + 'の新しいポストを読み込んでいます…';",
  ],
  [
    '読み込み中の文から「Claudeが」を外す（下部）',
    '<span>Claudeが${esc(GEN.label)}のポストを書いています…</span>',
    '<span>${esc(GEN.label)}のポストを読み込んでいます…</span>',
  ],
  [
    '引っぱって更新の文から「Claudeが」を外す',
    "$('.ptrtxt', PTR).textContent = 'Claudeが書いています…';",
    "$('.ptrtxt', PTR).textContent = '読み込んでいます…';",
  ],
  [
    'はじめての画面の説明を、アプリの実際の動きに合わせる',
    '    <p class="fine">ポストはClaudeがその場で書きます。最初の読み込みのときに、Claudeの利用を許可するか確認が出ます。読み込むたびに、あなたのClaudeの使用量を使います。</p>',
    '    <p class="fine">ポストはアプリの中に入っています。通信しないので、機内モードでも読めます。学習の内容は分野ごとに決めた基準時点のもので、最新の情報は試験の実施団体や官公庁の公式の発表をご確認ください。</p>',
  ],

  /* ---- 自由入力の項目は、ポストを用意できないので外す ---- */
  [
    'はじめての画面から「自由に入力する」を外す',
    '<div class="lbl2" style="color:var(--text);font-size:15px;margin-top:10px">自由に入力する</div>` : \'\'}\n    ${topicFormHtml()}',
    '` : \'\'}',
  ],
  [
    '「学ぶ項目」画面から「自由に入力する」を外す',
    '<div class="lbl2">自由に入力する</div>${topicFormHtml()}',
    '',
  ],
  [
    '項目を追加するシートから「自由に入力する」を外す',
    '    <span class="lbl" style="margin-top:16px">自由に入力する</span>${topicFormHtml(true)}`);',
    '`);',
  ],
  [
    '項目のメモの説明を、実際の動きに合わせる',
    '    <p style="color:var(--sub);font-size:13px">メモは次に読み込むポストから反映されます。</p>',
    '    <p style="color:var(--sub);font-size:13px">メモは、この項目の覚え書きです。タイムラインには出ません。</p>',
  ],

  /* ---- 「先生に返信」は、AIを呼ばないのでメモに変える ---- */
  [
    '返信欄を「メモ」に変える',
    '<textarea maxlength="280" placeholder="${esc(\'質問や感想を返信（\' + who + \'が答えます）\')}"></textarea><button class="send" type="submit">返信</button>',
    '<textarea maxlength="280" placeholder="${esc(\'このポストにメモを残す（自分だけに見えます）\')}"></textarea><button class="send" type="submit">保存</button>',
  ],
  [
    'メモを保存したら、AIの返信を待たずに終わる',
    '  openThread(p, sp); updReplyCount(p, sp);\n  streamReply(p, sp, who, prompt);\n}',
    "  openThread(p, sp); updReplyCount(p, sp);\n  if (window.SS_APP){ toast('メモを保存しました'); return; }\n  streamReply(p, sp, who, prompt);\n}",
  ],
  [
    '自分のポストの画面から「先生に返信してもらう」を外す',
    '    <label class="ask"><input type="checkbox" id="cask" checked> 先生に返信してもらう</label>\n',
    '',
  ],
  [
    '自分のポストのあと、AIの返信を呼ばない',
    "  const ask = $('#cask').checked;",
    '  const ask = false;',
  ],
  [
    'AIの返信が使えないときの文を、アプリ用の文に変える',
    "  if (!sample){ tx.textContent = 'この画面ではClaudeを呼び出せないため、返信できません。'; return; }",
    "  if (!sample){ tx.textContent = 'この機能は、いまのバージョンでは使えません。'; return; }",
  ],

  /* ---- iPhoneの機能 ---- */
  [
    '4択に答えたら、iPhoneを振動させる',
    '  const s = TS(sp.topic); s.q++; D().q++; if (ok){ s.qc++; D().qc++; } else addWeak(sp, sp.text, sp.options[sp.answer]);',
    '  const s = TS(sp.topic); s.q++; D().q++; if (ok){ s.qc++; D().qc++; } else addWeak(sp, sp.text, sp.options[sp.answer]);\n' +
      "  try { if (window.ssHaptic) window.ssHaptic(ok ? 'success' : 'error'); } catch(e){}",
  ],
  [
    '一問一答の自己採点で、iPhoneを振動させる',
    "  if (g === 'ok') s.cc++; else addWeak(sp, sp.text, sp.back);",
    "  if (g === 'ok') s.cc++; else addWeak(sp, sp.text, sp.back);\n" +
      "  try { if (window.ssHaptic) window.ssHaptic(g === 'ok' ? 'success' : 'error'); } catch(e){}",
  ],
  [
    'コピーのかわりに、iPhoneの共有シートを開く',
    "      try { navigator.clipboard.writeText(txt).then(() => toast('テキストをコピーしました'), () => toast('コピーできませんでした')); } catch(err){ toast('コピーできませんでした'); }",
    '      if (window.ssShare){ window.ssShare(txt); return; }\n' +
      "      try { navigator.clipboard.writeText(txt).then(() => toast('テキストをコピーしました'), () => toast('コピーできませんでした')); } catch(err){ toast('コピーできませんでした'); }",
  ],
  [
    '共有ボタンの読み上げ文を直す',
    '<button class="act share" data-act="share" aria-label="テキストをコピー">',
    '<button class="act share" data-act="share" aria-label="共有する">',
  ],

  /* ---- Firebase ---- */
  [
    'Firebaseのエラーコード（ハイフン付き）も受け取れるようにする',
    "    if (c === 'quota_exceeded') toast('保存できる数の上限に達しました。いくつか外してください');\n" +
      "    else if (c === 'invalid_argument' || c === 'revoked' || c === 'not_granted' || c === 'permission_denied'){ SAVE.db = null; renderSyncNote(); toast('アカウントに保存できませんでした。この端末にだけ保存します'); }",
    "    if (c === 'quota_exceeded' || c === 'resource-exhausted') toast('保存できる数の上限に達しました。いくつか外してください');\n" +
      "    else if (c === 'invalid_argument' || c === 'invalid-argument' || c === 'revoked' || c === 'not_granted' || c === 'permission_denied' || c === 'permission-denied' || c === 'unauthenticated'){ SAVE.db = null; renderSyncNote(); toast('アカウントに保存できませんでした。この端末にだけ保存します'); }",
  ],
  [
    '保存先の説明を、アプリの実際の動きに合わせる',
    "  el.textContent = SAVE.db && SAVE.live ? 'claude.ai のアカウントに保存しています（ほかの端末でも同じ項目・保存が見られます）。読み込んだタイムラインはこの端末にだけ残ります。' : 'この端末のブラウザに保存しています。';",
    "  el.textContent = SAVE.db && SAVE.live ? 'このアプリの匿名アカウントに保存しています。読み込んだタイムラインは、この端末にだけ残ります。' : 'いまはこの端末にだけ保存しています。通信できるようになると、自動で同期します。';",
  ],

  /* ---- 設定欄（通知・文字の大きさ・規約・アカウント削除）を足す ---- */
  [
    '「学ぶ項目」画面に、通知・文字の大きさ・規約・アカウント削除を足す',
    '    <div class="dsec">ポストの書き方</div>\n' +
      '    <div class="seg" role="radiogroup" aria-label="ポストの書き方"><button role="radio" data-act="mode" data-m="default" aria-checked="${S.mode !== \'quick\'}">ていねい</button><button role="radio" data-act="mode" data-m="quick" aria-checked="${S.mode === \'quick\'}">はやい</button></div>\n' +
      '    <div class="svnote">ていねい：考えてから書くので少し待ちますが、内容がしっかりします。はやい：すぐ出ますが、内容はかんたんめです。</div>\n' +
      '    <div class="dsec">保存先</div><div class="svnote" id="syncnote"></div>\n' +
      '    <div class="about"><p>ポストはClaudeがその場で書いています。アカウントはすべて架空で、いいね数なども雰囲気づくりの数字です。</p><p>内容にまちがいが含まれることがあります。大事なことは教科書や公式の資料で確かめてください。</p><p>読み込みや返信のたびに、あなたのClaudeの使用量を使います。</p></div>\n' +
      '    <button class="reset" data-act="reset">学習の記録をリセット</button>`;',
    '    ${window.ssSettingsHtml ? window.ssSettingsHtml() : \'\'}\n' +
      '    <div class="dsec">保存先</div><div class="svnote" id="syncnote"></div>\n' +
      '    <div class="about"><p>ポストはアプリの中にあらかじめ入っています。読み込みのときに通信はしません。アカウントはすべて架空で、いいね数なども雰囲気づくりの数字です。</p><p>学習の内容は、分野ごとに決めた基準時点のものです（各項目の「細目の地図」で確認できます）。法令・試験の形式・税制・統計は変わります。<b>最新の情報は、試験の実施団体や官公庁の公式の発表を確認してください。</b></p><p>出典のリンクを押すと、Safariで開きます。</p></div>\n' +
      '    ${window.ssLegalHtml ? window.ssLegalHtml() : \'\'}\n' +
      '    <button class="reset" data-act="reset">学習の記録をリセット</button>\n' +
      '    ${window.ssDeleteHtml ? window.ssDeleteHtml() : \'\'}`;',
  ],
  [
    '「学ぶ項目」画面では「＋」ボタンを隠す（設定やアカウント削除に重ならないように）',
    "  ['home', 'dict', 'topics', 'bm'].forEach(k => { $('#view-' + k).hidden = k !== v; });",
    "  ['home', 'dict', 'topics', 'bm'].forEach(k => { $('#view-' + k).hidden = k !== v; });\n" +
      "  document.body.classList.toggle('ss-nofab', v === 'topics');",
  ],
  [
    '橋渡し（bridge.js）から、アプリ本体の関数を使えるようにする',
    '/* ---------- 起動 ---------- */\nLIST = LIST.filter(',
    'window.ssApp = {toast: toast, renderTopics: renderTopics, openSheet: openSheet, view: function(){ return VIEW; }};\n\n' +
      '/* ---------- 起動 ---------- */\nLIST = LIST.filter(',
  ],
];

for (const [label, find, replace] of PATCHES) {
  const n = html.split(find).length - 1;
  if (n !== 1) die(`書き換えできません（${n}か所見つかりました）：${label}`);
  html = html.replace(find, () => replace);
}

// [説明, 探す文字列, 置き換える文字列, あるはずの件数]
const REPLACE_ALL = [
  ['アクセント色の半透明（ホバー・影）も、インディゴにする', 'rgba(29,155,240,', 'rgba(79,70,229,', 7],
];

for (const [label, find, replace, want] of REPLACE_ALL) {
  const n = html.split(find).length - 1;
  if (n !== want) die(`書き換えできません（${want}か所のはずが${n}か所）：${label}`);
  html = html.split(find).join(replace);
}

/* ================= 2. Firebaseと橋渡しを入れる ================= */

let cfg = null;
if (existsSync(join(root, 'firebase-config.json'))) {
  const c = JSON.parse(read('firebase-config.json'));
  cfg = c && c.apiKey && c.projectId ? c : null;
}
let emulator = null;
if (emuArg) {
  const [authHost, fsHost] = emuArg.slice('--emulator='.length).split(',');
  emulator = { auth: authHost, firestore: fsHost };
  cfg = cfg && cfg.apiKey ? cfg : { apiKey: 'demo-key', projectId: 'demo-scroll-study', authDomain: 'demo-scroll-study.firebaseapp.com' };
}

const noSdk = args.has('--no-sdk');
if (noSdk) cfg = { apiKey: 'test-key', projectId: 'test-scroll-study' };

let sdk = [];
if (!noSdk) {
  const fbDir = join(root, 'node_modules/firebase');
  if (!existsSync(fbDir)) die('node_modules/firebase がありません。先に npm install を実行してください。');
  sdk = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'].map((f) => {
    const p = join(fbDir, f);
    if (!existsSync(p)) die(`${f} が見つかりません。firebase のバージョンを確認してください。`);
    return readFileSync(p, 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '');
  });
}

// 橋渡しの中の目印を、実際の値に置き換える
let bridge = read('web/bridge.js');
const SUBS = [
  ['__SUPPORT_EMAIL__', meta.supportEmail],
  ['__SUPPORT_URL__', meta.supportUrl],
  ['__OPERATOR__', meta.operator],
];
for (const [mark, value] of SUBS) {
  const n = bridge.split(mark).length - 1;
  if (n < 1) die(`web/bridge.js に目印 ${mark} がありません。`);
  bridge = bridge.split(mark).join(value);
}
if (bridge.includes('__SUPPORT') || bridge.includes('__OPERATOR')) die('web/bridge.js に埋めきれていない目印が残っています。');

// テスト用：iPhone側がいない環境で動かすため、ポストをHTMLに直接入れる。
// 本番のビルド（--posts なし）には入らない。
let testPosts = '';
if (args.has('--posts')) {
  if (!outArg) die('--posts は --out= と一緒に使ってください（テスト用です）');
  const dir = join(root, 'web/posts');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json')) : [];
  if (!files.length) die('web/posts にポストがありません。');
  testPosts = '<script>document.addEventListener("DOMContentLoaded", function(){\n' +
    files.map((f) => {
      const id = f.replace(/\.json$/, '');
      const json = JSON.stringify(JSON.parse(readFileSync(join(dir, f), 'utf8')));
      return '  window.ssPosts(' + JSON.stringify(id) + ', ' + JSON.stringify(json) + ');';
    }).join('\n') +
    '\n});</script>\n';
  console.log(`テスト用にポストを入れました（${files.length} 分野）`);
}

const safe = (js) => js.replace(/<\/(script)/gi, '<\\/$1');
const head =
  sdk.map((s) => '<script>' + safe(s) + '</script>\n').join('') +
  '<script>window.__SS_FIREBASE__ = ' + JSON.stringify(cfg) + ';' +
  (emulator ? 'window.__SS_EMULATOR__ = ' + JSON.stringify(emulator) + ';' : '') + '</script>\n' +
  '<script>' + safe(bridge) + '</script>\n' +
  testPosts;

const marker = "<script>\n'use strict';\n(function(){";
if (html.split(marker).length !== 2) die('アプリ本体の <script> が見つかりません');
html = html.replace(marker, () => head + marker);

/* ================= 3. 書き出す ================= */

if (outArg) {
  writeFileSync(outArg.slice('--out='.length), html);
} else {
  const js =
    '// このファイルは scripts/build-web.mjs が作ります。直接書き換えないでください。\n' +
    'export default ' + JSON.stringify(html) + ';\n';
  writeFileSync(join(root, 'src/webHtml.js'), js);
}

console.log(
  `できました（${(html.length / 1024).toFixed(0)} KB、` +
  `Firebase：${cfg && cfg.apiKey && !noSdk ? '設定あり' : noSdk ? 'テスト用（本体なし）' : '未設定 → この端末のみで動きます'}` +
  `${emulator ? '、エミュレータ' : ''}、書き換え ${PATCHES.length + REPLACE_ALL.length} 件）`
);
