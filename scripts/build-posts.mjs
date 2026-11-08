// web/posts/<分野id>.json（事前に作ったポスト）を調べて、
// アプリに入れる src/posts/<分野id>.js と src/posts/index.js を作る。
//
//   node scripts/build-posts.mjs
//   node scripts/build-posts.mjs --check     作らずに、調べるだけ
//
// 調べること（1つでもだめなら、エラーで止まる）
//   ・分野idが、アプリ本体の学習データにあるか
//   ・細目（item）が、その分野に実際にあるか
//   ・種類が tip / quiz / card / myth / dialog のどれかか
//   ・4択の選択肢が4つあり、正解の番号が範囲内で、選択肢が重なっていないか
//   ・文字数が、アプリ本体が受け取れる上限を超えていないか（超えると黙って切られる）
//   ・見出し（key）が、同じ分野の中で重なっていないか
//   ・用語に、語と意味の両方があるか
//
// 詰めた形（配列）
//   [種類, 細目, 見出し, タグ, 用語, ...種類ごとの中身]
//     種類: t=tip / q=quiz / c=card / m=myth / d=dialog
//     tip   : [..., 'tip書き手', 本文, [続き...]]        書き手: s=先生 / b=bot / n=ノート
//     quiz  : [..., 問題文, [選択肢×4], 正解の番号, 解説]
//     card  : [..., 問い, 答え, 補足]
//     myth  : [..., 導入, よくある誤解, 正しい理解, 理由]
//     dialog: [..., [[話し手, 発言], ...]]               話し手: s=スズメさん / o=フクロウ先生

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const checkOnly = process.argv.includes('--check');

const errors = [];
const warns = [];
const err = (where, msg) => errors.push(`${where}：${msg}`);
const warn = (where, msg) => warns.push(`${where}：${msg}`);

/* ---------- アプリ本体の学習データを読む（細目の照合に使う） ---------- */

const html = read('web/scroll-study.html');
const m = html.match(/<script type="application\/json" id="fields-data">([\s\S]*?)<\/script>/);
if (!m) {
  console.error('web/scroll-study.html の中に学習データ（fields-data）が見つかりません');
  process.exit(1);
}
const FIELDS = JSON.parse(m[1]);
const FBY = {};
for (const f of FIELDS) {
  const byK = {};
  (f.units || []).forEach((u, ui) =>
    (u.items || []).forEach((it, ii) => {
      byK[ui + '.' + ii] = { u: u.u, n: it.n, p: it.p || [] };
    })
  );
  FBY[f.id] = { name: f.name, byK, count: Object.keys(byK).length };
}

/* ---------- 文字数の上限（アプリ本体の normalize() と同じ） ---------- */
// ここを超えると、アプリ本体が黙って切り詰めてしまうので、エラーにする。
const MAX = {
  key: 40, item: 10, tag: 30, termW: 30, termR: 40, termM: 160,
  tipText: 400, tipThread: 300,
  quizText: 300, quizOption: 140, quizExplain: 300,
  cardText: 300, cardBack: 200, cardNote: 240,
  mythText: 200, mythWrong: 200, mythRight: 240, mythWhy: 300,
  dialogLine: 240,
};
// 読みやすさのための目安（超えても止めないが、報告する）
const SOFT = { tipText: 200, tipThread: 170, quizText: 170, quizOption: 90, quizExplain: 170, cardBack: 120, dialogLine: 110 };

const TYPES = { t: 'tip', q: 'quiz', c: 'card', m: 'myth', d: 'dialog' };
const ACCTS = { s: 1, b: 1, n: 1 };
const SPEAKERS = { s: 1, o: 1 };

const S = (v) => (typeof v === 'string' ? v : null);
function lim(where, label, v, max, soft) {
  const s = S(v);
  if (s == null) { err(where, `${label} が文字列ではありません`); return; }
  if (!s.trim()) { err(where, `${label} が空です`); return; }
  if (s.length > max) err(where, `${label} が ${s.length} 文字です（上限 ${max} 文字。超えるとアプリ側で切られます）`);
  else if (soft && s.length > soft) warn(where, `${label} が ${s.length} 文字です（読みやすさの目安は ${soft} 文字）`);
}

/* ---------- 1つのポストを調べる ---------- */

// 日本語の文の途中に、英単語がそのまま紛れ込んでいないか調べる。
// （書いている途中で英語が混ざる取り違えが実際に起きたので、機械で止める）
const ALLOW_EN = /^(TOEIC|NISA|iDeCo|DI|GDP|CBT|ETF|REIT|PER|PBR|ROE|DCF|NPV|IRR|NOI|ABL|PL|DB|DC|MBS|TTS|TTB|TTM|IT|AI|CPU|OS|URL|HTTP|HTTPS|TCP|IP|DNS|SQL|API|RAM|ROM|USB|LAN|WAN|VPN|SSL|TLS|CSS|HTML|JSON|XML|UI|UX|QR|AR|VR|IoT|DX|RPA|BI|ERP|CRM|SFA|SLA|SNS|FAQ|PDF|CSV|ZIP|JPEG|PNG|GIF|MP3|MP4|DVD|SSD|HDD|GPU|NPU|LED|GPS|RFID|NFC|BLE|SIM|eSIM|ESG|SDGs|GX|CO2|TOPIX|MMF|ZEH|Tax|Buy|Sell|Mag|ZEB|LCCM)$/i;
function checkEnglish(where, a) {
  const s = JSON.stringify(a);
  const hits = s.match(/[ぁ-んァ-ヶ一-龠][A-Za-z]{3,}|[A-Za-z]{3,}[ぁ-んァ-ヶ一-龠]/g);
  if (!hits) return;
  for (const h of hits) {
    const word = h.replace(/[ぁ-んァ-ヶ一-龠]/g, '');
    if (ALLOW_EN.test(word)) continue;
    warn(where, `日本語の中に英単語「${word}」が混ざっています（書き間違いでないか確認）`);
  }
}

function checkPost(fieldId, idx, a) {
  const where = `${fieldId}[${idx}]`;
  if (!Array.isArray(a)) { err(where, '配列ではありません'); return null; }
  checkEnglish(where, a);

  const type = TYPES[a[0]];
  if (!type) { err(where, `種類 "${a[0]}" が t/q/c/m/d のどれでもありません`); return null; }

  // 細目
  const itemKey = a[1];
  if (itemKey != null && itemKey !== '') {
    if (typeof itemKey !== 'string' || itemKey.length > MAX.item) { err(where, `細目 "${itemKey}" の形がおかしいです`); return null; }
    if (!FBY[fieldId].byK[itemKey]) { err(where, `細目 "${itemKey}" は ${fieldId} にありません`); return null; }
  } else {
    err(where, '細目（2つ目）が空です。どの細目のポストか必ず入れてください');
    return null;
  }

  lim(where, '見出し(key)', a[2], MAX.key);

  // タグ（項目名のタグはアプリ側が自動で足すので、ここは0〜2個）
  const tags = a[3];
  if (!Array.isArray(tags)) err(where, 'タグが配列ではありません');
  else {
    if (tags.length > 2) err(where, `タグが ${tags.length} 個です（0〜2個にしてください。項目名のタグは自動で付きます）`);
    tags.forEach((t, i) => lim(where, `タグ[${i}]`, t, MAX.tag));
  }

  // 用語
  const terms = a[4];
  if (!Array.isArray(terms)) err(where, '用語が配列ではありません');
  else {
    if (terms.length > 3) err(where, `用語が ${terms.length} 個です（0〜3個）`);
    terms.forEach((t, i) => {
      if (!Array.isArray(t) || t.length < 2) { err(where, `用語[${i}] が [語, 読み, 意味] の形ではありません`); return; }
      lim(where, `用語[${i}]の語`, t[0], MAX.termW);
      if (t[1] != null && t[1] !== '' && S(t[1]) && t[1].length > MAX.termR) err(where, `用語[${i}]の読みが長すぎます`);
      lim(where, `用語[${i}]の意味`, t[2] == null ? t[1] : t[2], MAX.termM);
      if (S(t[0]) && !html.includes(t[0]) && !String(a.join(' ')).includes(t[0])) {
        warn(where, `用語「${t[0]}」が本文に出てきません（点線の下線が付きません）`);
      }
    });
  }

  if (type === 'tip') {
    if (!ACCTS[a[5]]) err(where, `tipの書き手 "${a[5]}" が s/b/n のどれでもありません`);
    lim(where, 'tipの本文', a[6], MAX.tipText, SOFT.tipText);
    const th = a[7];
    if (th != null && !Array.isArray(th)) err(where, 'tipの続きが配列ではありません');
    else if (Array.isArray(th)) {
      if (th.length > 4) err(where, `tipの続きが ${th.length} 件です（0〜4件）`);
      th.forEach((x, i) => lim(where, `tipの続き[${i}]`, x, MAX.tipThread, SOFT.tipThread));
    }
  } else if (type === 'quiz') {
    lim(where, '問題文', a[5], MAX.quizText, SOFT.quizText);
    const opts = a[6];
    if (!Array.isArray(opts) || opts.length !== 4) err(where, `選択肢が ${Array.isArray(opts) ? opts.length : '?'} 個です（4個にしてください）`);
    else {
      opts.forEach((o, i) => lim(where, `選択肢[${i}]`, o, MAX.quizOption, SOFT.quizOption));
      const uniq = new Set(opts.map((o) => String(o).trim()));
      if (uniq.size !== opts.length) err(where, '選択肢の中に同じものがあります');
    }
    const ans = a[7];
    if (!Number.isInteger(ans) || ans < 0 || ans > 3) err(where, `正解の番号 "${ans}" が 0〜3 ではありません`);
    lim(where, '解説', a[8], MAX.quizExplain, SOFT.quizExplain);
  } else if (type === 'card') {
    lim(where, '問い', a[5], MAX.cardText, SOFT.quizText);
    lim(where, '答え', a[6], MAX.cardBack, SOFT.cardBack);
    if (a[7] != null && a[7] !== '') lim(where, '補足', a[7], MAX.cardNote);
  } else if (type === 'myth') {
    lim(where, '導入', a[5], MAX.mythText);
    lim(where, 'よくある誤解', a[6], MAX.mythWrong);
    lim(where, '正しい理解', a[7], MAX.mythRight);
    if (a[8] != null && a[8] !== '') lim(where, '理由', a[8], MAX.mythWhy);
  } else if (type === 'dialog') {
    const ls = a[5];
    if (!Array.isArray(ls) || ls.length < 3 || ls.length > 6) {
      err(where, `会話が ${Array.isArray(ls) ? ls.length : '?'} 発言です（3〜6発言）`);
    } else {
      if (ls[0] && ls[0][0] !== 's') warn(where, '会話の1つ目は、スズメさん（s）の疑問から始めるのが基本です');
      ls.forEach((l, i) => {
        if (!Array.isArray(l) || l.length < 2) { err(where, `会話[${i}] が [話し手, 発言] の形ではありません`); return; }
        if (!SPEAKERS[l[0]]) err(where, `会話[${i}] の話し手 "${l[0]}" が s/o のどちらでもありません`);
        lim(where, `会話[${i}]の発言`, l[1], MAX.dialogLine, SOFT.dialogLine);
      });
    }
  }
  return { type, item: itemKey, key: S(a[2]) || '' };
}

/* ---------- 分野ごとに調べる ---------- */

const postsDir = join(root, 'web/posts');
const files = existsSync(postsDir) ? readdirSync(postsDir).filter((f) => f.endsWith('.json')).sort() : [];
const summary = [];
const built = [];

for (const file of files) {
  const fieldId = file.replace(/\.json$/, '');
  if (!FBY[fieldId]) { err(file, `分野id "${fieldId}" は学習データにありません`); continue; }

  let arr;
  try {
    arr = JSON.parse(readFileSync(join(postsDir, file), 'utf8'));
  } catch (e) {
    err(file, 'JSONとして読めません：' + e.message);
    continue;
  }
  if (!Array.isArray(arr)) { err(file, '配列ではありません'); continue; }

  const keys = new Set();
  const byType = { tip: 0, quiz: 0, card: 0, myth: 0, dialog: 0 };
  const perItem = {};
  arr.forEach((a, i) => {
    const r = checkPost(fieldId, i, a);
    if (!r) return;
    byType[r.type]++;
    perItem[r.item] = (perItem[r.item] || 0) + 1;
    if (r.key) {
      if (keys.has(r.key)) err(`${fieldId}[${i}]`, `見出し「${r.key}」が重なっています`);
      keys.add(r.key);
    }
  });

  const total = FBY[fieldId].count;
  const covered = Object.keys(perItem).length;
  const thin = Object.entries(perItem).filter(([, n]) => n < 3).length;
  summary.push({ fieldId, name: FBY[fieldId].name, posts: arr.length, byType, covered, total, thin });
  built.push(fieldId);
}

/* ---------- 結果を出す ---------- */

console.log('分野'.padEnd(10) + '名前'.padEnd(22) + 'ポスト'.padStart(6) + '  解説  4択 一問一答 誤解  対話' + '   細目(作成/全体)');
console.log('-'.repeat(92));
let tp = 0, tc = 0, ta = 0;
for (const s of summary) {
  tp += s.posts; tc += s.covered; ta += s.total;
  console.log(
    s.fieldId.padEnd(10) + String(s.name).padEnd(22) +
    String(s.posts).padStart(6) +
    String(s.byType.tip).padStart(6) + String(s.byType.quiz).padStart(5) +
    String(s.byType.card).padStart(9) + String(s.byType.myth).padStart(5) +
    String(s.byType.dialog).padStart(6) +
    ('   ' + s.covered + '/' + s.total).padStart(14) +
    (s.thin ? `  ※3件未満の細目 ${s.thin}` : '')
  );
}
console.log('-'.repeat(92));
console.log(`合計 ${tp} 件のポスト／細目 ${tc}/${ta}（分野 ${summary.length}/${FIELDS.length}）`);

if (warns.length) {
  console.log(`\n気になる点 ${warns.length} 件（止めません）：`);
  warns.slice(0, 40).forEach((w) => console.log('  ・' + w));
  if (warns.length > 40) console.log(`  …ほか ${warns.length - 40} 件`);
}

if (errors.length) {
  console.error(`\nだめな点 ${errors.length} 件：`);
  errors.slice(0, 60).forEach((e) => console.error('  × ' + e));
  if (errors.length > 60) console.error(`  …ほか ${errors.length - 60} 件`);
  console.error('\n直してから、もう一度実行してください。');
  process.exit(1);
}

if (checkOnly) {
  console.log('\n調べるだけで終わりました（--check）。');
  process.exit(0);
}

/* ---------- アプリに入れる形で書き出す ---------- */

const outDir = join(root, 'src/posts');
mkdirSync(outDir, { recursive: true });

for (const fieldId of built) {
  const raw = readFileSync(join(postsDir, fieldId + '.json'), 'utf8');
  const compact = JSON.stringify(JSON.parse(raw)); // 余白を落とす
  writeFileSync(
    join(outDir, fieldId + '.js'),
    '// このファイルは scripts/build-posts.mjs が作ります。直接書き換えないでください。\n' +
    'export default ' + JSON.stringify(compact) + ';\n'
  );
}

const lines = built.map((id) => `  ${id}: () => require('./${id}').default,`).join('\n');
writeFileSync(
  join(outDir, 'index.js'),
  '// このファイルは scripts/build-posts.mjs が作ります。直接書き換えないでください。\n' +
  '//\n' +
  '// 分野ごとに1ファイル。選んだ分野の分だけ読み込む（起動を軽くするため）。\n' +
  'const LOADERS = {\n' + lines + '\n};\n\n' +
  'export const FIELDS_WITH_POSTS = Object.keys(LOADERS);\n\n' +
  'export function loadPosts(fieldId) {\n' +
  '  const load = LOADERS[fieldId];\n' +
  '  return load ? load() : null;\n' +
  '}\n'
);

const bytes = built.reduce((a, id) => a + readFileSync(join(outDir, id + '.js')).length, 0);
console.log(`\nsrc/posts/ に ${built.length} ファイル（合計 ${(bytes / 1024 / 1024).toFixed(2)} MB）を書き出しました。`);
if (built.length < FIELDS.length) {
  const missing = FIELDS.map((f) => f.id).filter((id) => !built.includes(id));
  console.log(`まだポストがない分野：${missing.join(', ')}`);
}
