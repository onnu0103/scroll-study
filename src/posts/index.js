// このファイルは scripts/build-posts.mjs が作ります。直接書き換えないでください。
//
// 分野ごとに1ファイル。選んだ分野の分だけ読み込む（起動を軽くするため）。
const LOADERS = {
  behecon: () => require('./behecon').default,
  boki: () => require('./boki').default,
  econ: () => require('./econ').default,
  eiken: () => require('./eiken').default,
  fe: () => require('./fe').default,
  fp2: () => require('./fp2').default,
  ipass: () => require('./ipass').default,
  kanken: () => require('./kanken').default,
  law: () => require('./law').default,
  phil: () => require('./phil').default,
  psy: () => require('./psy').default,
  python: () => require('./python').default,
  stats: () => require('./stats').default,
  takken: () => require('./takken').default,
  toeic: () => require('./toeic').default,
};

export const FIELDS_WITH_POSTS = Object.keys(LOADERS);

export function loadPosts(fieldId) {
  const load = LOADERS[fieldId];
  return load ? load() : null;
}
