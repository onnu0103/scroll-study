This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

This project is on **SDK 58** (React Native 0.88, React 19.3.0). SDK 58 requires **Node.js 22.13 or newer**.

## Commands

```bash
npm install                      # install dependencies
npm run build:posts              # check web/posts/*.json and generate src/posts/
npm run build:web                # generate src/webHtml.js (run AFTER build:posts)
npx expo export --platform ios   # verify the app bundles
npx expo-doctor                  # diagnose dependency and config issues
npx expo install --fix           # fix incompatible package versions
```

Use `npx expo install <package>` instead of `npm install <package>` — it resolves SDK-compatible versions.

Run `npm run build:posts && npm run build:web && npx expo export --platform ios` before declaring any task done.

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Prefer recommended Expo modules over third-party libraries. Docs: https://docs.expo.dev/versions/latest/index.md

## This project (スクロール学習 / ScrollStudy)

### Architecture

```
web/scroll-study.html   Claude artifact, kept VERBATIM — never hand-edit
web/posts/<field>.json  pre-generated posts, one file per study field (15 fields)
web/bridge.js           replaces window.claude.use(), adds the iPhone features
        │
        │  scripts/build-posts.mjs  → validates posts, writes src/posts/
        │  scripts/build-web.mjs    → applies PATCHES, inlines Firebase + bridge.js
        ▼
src/webHtml.js   (one string)        src/posts/*.js  (one string per field)
        │                                    │
        └──── App.js: WebView ───────────────┘  posts injected on demand
```

- **Never hand-edit `src/webHtml.js` or `src/posts/*`.** They are generated. Edit `web/bridge.js`, the `PATCHES` list in `scripts/build-web.mjs`, or `web/posts/*.json`, then rebuild.
- `scripts/build-web.mjs` fails loudly if a patch marker is not found exactly once. When the artifact is updated, fix `PATCHES` rather than editing the HTML.
- `scripts/build-posts.mjs` is the verification harness for the post data. It checks that every post's `item` key exists in the artifact's `fields-data`, that quiz options are well-formed, and that no field exceeds the length limits in the artifact's `normalize()` (where text would be silently truncated).

### No AI at runtime

The artifact calls `window.claude.use('sample')` to have Claude write posts. **The app never calls an AI service.** Posts are pre-generated and bundled. `web/bridge.js` provides `window.ssSample(plan, n, seenBefore)`, which returns a function with the same shape as the artifact's `sample()` and streams pre-generated posts through the artifact's own `makeExtractor()` / `normalize()`. This means bundled posts get the same validation as AI-generated ones did.

Consequences, all handled by `PATCHES`:
- Free-text study topics are removed (no posts could exist for them).
- "先生に返信" (AI reply) became "メモ" — a private note saved on the post.
- The ていねい/はやい model-tier switch is removed.
- Every user-visible mention of Claude / claude.ai is rewritten.

### Data and privacy

- `web/bridge.js` re-implements `window.claude.use('db' | 'user')` on Firebase compat (anonymous auth + Firestore), so the artifact's online code path runs unchanged.
- The artifact writes to `data/users/{uid}/{docId}` only. `firebase/firestore.rules` allows that path for its owner and denies everything else. Keep the rules in sync with the paths the artifact uses.
- Because Firebase is used, the app **must** keep the in-app "アカウントとデータを削除する" button (App Store Review Guideline 5.1.1(v)). It lives in `web/bridge.js` (`window.ssDeleteHtml`), on the 学ぶ項目 screen.
- `docs/index.html` is the public support / FAQ / terms / privacy page, served by GitHub Pages (`main` branch, `/docs`) and registered as the Support URL and Privacy Policy URL in App Store Connect. **Its terms and privacy text must stay identical to the in-app text** (`TERMS_HTML` / `PRIVACY_HTML` in `web/bridge.js`).
- `app-meta.json` holds the operator name, support email and support URL. `build-web.mjs` substitutes them into `bridge.js` and refuses to build if any is empty.

### iOS specifics

- iOS only (`supportsTablet: false`). Local notifications only (`enableRemoteNotifications: false`), no push entitlement.
- Native features, all bridged through `onMessage` / `injectJavaScript` in `App.js`: daily reminder notification, haptics on quiz answers, the iOS share sheet, and text size following the system Dynamic Type setting.
- Links outside `BASE_URL` open in Safari via `onShouldStartLoadWithRequest` + `Linking.openURL`. `setSupportMultipleWindows={false}` is required for `target="_blank"` source links to reach that handler.
- The app loads no external resources: the artifact has no `<link>`, no external `<script src>` and no web fonts, so it works in airplane mode. Keep it that way — it is the main defence for Guideline 4.2.
- The accent colour is `#4f46e5` (light) / `#818cf8` (dark), applied by `PATCHES`. The artifact's original `#1d9bf0` is deliberately not used.

### Shipping

The owner builds and submits from an iPhone via Expo Launch (no Mac, no terminal), so **the repo must stay buildable as-is from GitHub** — commit the generated `src/webHtml.js` and `src/posts/*`.
