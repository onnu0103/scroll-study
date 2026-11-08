# スクロール学習（iPhoneアプリ）

Claudeのアーティファクトで作った学習タイムラインを、App Storeで配信するためのiPhoneアプリです。
Expo（React Native）で作っていて、Macがなくても [Expo Launch](https://launch.expo.dev) からビルドと提出ができます。

- **アプリ名**：スクロール学習
- **サブタイトル**：SNSのようにスクロールで好きな分野を学習
- **バンドルID**：`com.onnu0103.scrollstudy`（変更不可）
- **配信**：日本のみ／無料／カテゴリ 教育・参考書

## しくみ

```
web/scroll-study.html   アーティファクトのHTML（そのままのコピー。直接書き換えない）
web/posts/<分野>.json   事前に作ったポスト（分野ごとに1ファイル・全15分野）
web/bridge.js           window.claude の代わりと、iPhoneの機能との橋渡し
        │
        │  scripts/build-posts.mjs  ポストを調べて src/posts/ を作る
        │  scripts/build-web.mjs    書き換え（PATCHES）＋ Firebase と bridge.js を入れる
        ▼
src/webHtml.js（1つの文字列）        src/posts/*.js（分野ごとに1つの文字列）
        │                                    │
        └──── App.js の WebView で表示 ───────┘  選んだ分野の分だけ渡す
```

### ポストはAIを呼ばない

アーティファクトは、ポストを出すたびにClaudeに文章を書かせていました。
**このアプリはAIを一切呼びません。**ポストは全部あらかじめ作ってアプリの中に入っています。

- 通信しないので、**機内モードでも読めます**
- API料金やサーバーの費用は **0円**
- `web/bridge.js` の `window.ssSample()` が、アーティファクト自身の検証処理
  （`makeExtractor` / `normalize`）にポストを流し込むので、**アプリ本体の検査がそのまま効きます**

そのかわり、次の3つはアーティファクトから変えてあります（すべて `PATCHES` で処理）。

| もとの機能 | このアプリでは |
| --- | --- |
| 自由に入力した項目のポストをClaudeが書く | 自由入力をやめ、**15分野から選ぶ**形にした |
| 先生がAIで返信する | **メモ**（自分だけに見える覚え書き）に変えた |
| ていねい／はやい（AIのモデル選択） | 外した |

### iPhoneならではの機能

- **毎日のリマインド通知**（「学ぶ項目」画面で時刻を選ぶ。端末の中だけで鳴る）
- **正解・不正解の振動**（4択と一問一答）
- **共有シート**（ポストをメモ・メール・メッセージなどに渡す）
- **文字の大きさ**（はじめはiPhoneの設定に合わせ、小・標準・大・特大から選べる）
- **暗い画面に追従**（iPhoneの外観モードに合わせる）
- 出典のリンクは**Safariで開く**

## ファイル

| ファイル | 中身 |
| --- | --- |
| `web/scroll-study.html` | アーティファクトのHTML（そのままのコピー） |
| `web/posts/<分野>.json` | 事前に作ったポスト。詰めた形（配列）で入っている |
| `web/bridge.js` | Firebase・ポストの供給・iPhoneの機能・設定欄・規約の本文 |
| `scripts/build-posts.mjs` | ポストを調べて `src/posts/` を作る（**検証ツール**） |
| `scripts/build-web.mjs` | 書き換えと組み立てをして `src/webHtml.js` を作る |
| `src/webHtml.js`, `src/posts/*` | 自動で作られるファイル（**直接書き換えない**） |
| `app-meta.json` | 運営者名・問い合わせ先・サポートURL |
| `firebase-config.json` | Firebase の設定値（Firebaseの画面の `firebaseConfig`） |
| `firebase/firestore.rules` | Firestore のセキュリティルール |
| `docs/index.html` | サポート・よくある質問・利用規約・プライバシーポリシーの公開ページ |
| `App.js` | WebView・通知・振動・共有・文字の大きさ |
| `app.json` | アプリ名・アイコン・バンドルIDなど |

## 作り直すとき（ビルド）

```bash
npm install
npm run build:posts    # ポストを調べて src/posts/ を作る
npm run build:web      # src/webHtml.js を作る
```

`build:posts` は、次を機械的に調べます。1つでもだめならエラーで止まります。

- 細目（`item`）が、その分野に実際にあるか
- 4択の選択肢が4つあり、正解の番号が範囲内で、選択肢が重なっていないか
- 文字数が、アプリ本体が受け取れる上限を超えていないか（超えると黙って切られる）
- 見出し（`key`）が、同じ分野の中で重なっていないか

`build:web` は、書き換えの目印が**ちょうど1か所**に見つからなければエラーで止まります。
アーティファクトを更新して目印が変わったときは、`scripts/build-web.mjs` の `PATCHES` を直してください。

### 確かめかた

```bash
npx expo-doctor                  # 設定の健康診断
npx expo export --platform ios   # ビルドが通るか
```

## はじめの設定（Firebase）

1. Firebaseでプロジェクトを作り、**Authentication の「匿名」を有効にし**、Firestore Database を作る（東京・本番環境モード）。
2. プロジェクトの設定 →「マイアプリ」でウェブアプリを登録し、`firebaseConfig` の中身を `firebase-config.json` に書く。
3. `firebase/firestore.rules` の中身を、Firebaseの「Firestore Database」→「ルール」に貼って**公開**する。
4. `npm run build:web` で `src/webHtml.js` を作り直す。

`firebase-config.json` が空のままでも、アプリは「この端末のみ」のモードで動きます（同期しないだけ）。

## 公開のしかた（Macなし・iPhoneだけ）

### 1. サポートページを公開する（GitHub Pages）

1. このリポジトリの「Settings」→「Pages」を開く。
2. 「Build and deployment」の Source を **Deploy from a branch**、Branch を **main** と **/docs** にして「Save」。
3. 数分後、プライベートブラウズで次のURLが開けることを確かめる。

| App Store Connect の項目 | 入れるURL |
| --- | --- |
| サポートURL | https://onnu0103.github.io/scroll-study/ |
| プライバシーポリシーURL | https://onnu0103.github.io/scroll-study/#privacy |

### 2. ビルドして TestFlight で確かめる

1. [launch.expo.dev](https://launch.expo.dev) にこのリポジトリのURL（`https://github.com/onnu0103/scroll-study`）を入れ、「App Store」を選ぶ。
2. Expoのプロジェクトは **Create new**。slug は `app.json` と同じ `scroll-study` にする。
3. Apple のアカウントでサインインし、アプリは **Create new**。バンドルIDは `com.onnu0103.scrollstudy`。
4. 「Launch to testers」はチェックしたまま「Launch」。
5. TestFlight（外部テストに `idomu_9696@icloud.com` を招待）からインストールして、次を確かめる。
   - 起動・アイコン・起動画面
   - 分野を選ぶ → ポストが流れる → 4択に答える（**振動する**）→ いいね・ブックマーク
   - 「学ぶ項目」画面の「保存先」が**同期している**表示になっている（なっていなければ、匿名ログインの有効化とルールの公開を確認）
   - 「毎日のリマインド」をオンにすると許可を聞かれ、その時刻に通知が届く
   - 共有ボタンでiPhoneの共有シートが開く
   - 出典のリンクがSafariで開く
   - **機内モードでもポストが読める**
   - 「アカウントとデータを削除する」が最後まで進み、はじめの画面に戻る

### 3. 審査に提出する

掲載情報（概要・キーワード・年齢区分・Appのプライバシーの回答・審査メモ）は、別途まとめた下書きのとおりに入力します。
注意点：

- Expo Launch が自動で作る「英語（アメリカ）」の掲載ページは**削除する**（残すと英語の概要・キーワード・サポートURLが必須になり、提出できません）
- 「Appのプライバシー」は入力後、**右上の「公開」を押す**
- スクリーンショットは 1320×2868（大型）と 1206×2622（中型）、PNG・透過なし

## アーティファクトを更新したとき

1. 新しいHTMLを `web/scroll-study.html` に上書きする。
2. `npm run build:posts && npm run build:web` を実行する。
   書き換えの目印が見つからないときはエラーで止まるので、`scripts/build-web.mjs` の `PATCHES` を直す。
3. 利用規約やプライバシーポリシーの文章が変わったときは、`docs/index.html` も同じ内容に直す。
4. App Storeに出す版を上げるときは、`app.json` の `version` を上げる。
5. コミットして、Expo Launch でビルドし直す。
