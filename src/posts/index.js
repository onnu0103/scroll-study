// このファイルは scripts/build-posts.mjs が作ります。直接書き換えないでください。
//
// 分野ごとに1ファイル。選んだ分野の分だけ読み込む（起動を軽くするため）。
const LOADERS = {
  fp2: () => require('./fp2').default,
  takken: () => require('./takken').default,
};

export const FIELDS_WITH_POSTS = Object.keys(LOADERS);

export function loadPosts(fieldId) {
  const load = LOADERS[fieldId];
  return load ? load() : null;
}
