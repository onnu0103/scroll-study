import { useCallback, useEffect, useRef } from 'react';
import { Linking, PixelRatio, Share, StyleSheet, useColorScheme, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import WEB_HTML from './src/webHtml';
import { loadPosts } from './src/posts';

// アプリ本体（スクロール学習のHTML）は、アプリの中に入っている。
// この住所は、端末の中で動かすための名前で、実際には通信しない。
const BASE_URL = 'https://app.scrollstudy.local/';
const REMINDER_ID = 'ss-daily-reminder';

SplashScreen.preventAutoHideAsync().catch(() => {});

// アプリを開いているときに通知が来ても、バナーで見せる
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const REMINDER_MESSAGES = [
  '今日のポストが待っています。5分だけスクロールしませんか。',
  '少しでも読めば記録になります。今日の学習をどうぞ。',
  '苦手リストの復習が出ます。今日のぶんを読みましょう。',
];

// 毎日のリマインド通知を予約する（オフなら取り消す）
async function scheduleReminder({ on, hour, minute, ask }) {
  await Notifications.cancelScheduledNotificationAsync(REMINDER_ID).catch(() => {});
  if (!on) return { ok: true, on: false };

  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && ask && perm.canAskAgain) {
    perm = await Notifications.requestPermissionsAsync();
  }
  if (!perm.granted) return { ok: false, reason: 'denied' };

  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID,
    content: {
      title: 'スクロール学習',
      body: REMINDER_MESSAGES[new Date().getDate() % REMINDER_MESSAGES.length],
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute,
    },
  });
  return { ok: true, on: true, hour, minute };
}

const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

// 正解・不正解などで、iPhoneを振動させる
function haptic(kind) {
  const T = Haptics.NotificationFeedbackType;
  if (kind === 'error') return Haptics.notificationAsync(T.Error);
  if (kind === 'warning') return Haptics.notificationAsync(T.Warning);
  if (kind === 'select') return Haptics.selectionAsync();
  return Haptics.notificationAsync(T.Success);
}

export default function App() {
  const webRef = useRef(null);
  const dark = useColorScheme() === 'dark';
  const bg = dark ? '#000000' : '#ffffff';

  // iPhone側 → アプリ本体
  const sendToWeb = useCallback((msg) => {
    const js = `window.ssFromNative && window.ssFromNative(${JSON.stringify(msg)}); true;`;
    webRef.current?.injectJavaScript(js);
  }, []);

  // 分野ごとのポストを、アプリ本体に渡す（選んだ分野の分だけ読み込む）
  const sendPosts = useCallback((field) => {
    let json = null;
    try {
      json = loadPosts(field);
    } catch {
      json = null;
    }
    const js = json
      ? `window.ssPosts && window.ssPosts(${JSON.stringify(field)}, ${JSON.stringify(json)}); true;`
      : `window.ssPosts && window.ssPosts(${JSON.stringify(field)}, null); true;`;
    webRef.current?.injectJavaScript(js);
  }, []);

  // アプリ本体 → iPhone側
  const onMessage = useCallback(
    async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'haptic') {
        haptic(msg.kind).catch(() => {});
        return;
      }

      if (msg.type === 'posts') {
        if (typeof msg.field === 'string' && /^[a-z0-9_]{1,20}$/.test(msg.field)) sendPosts(msg.field);
        return;
      }

      if (msg.type === 'share') {
        const text = typeof msg.text === 'string' ? msg.text.slice(0, 4000) : '';
        if (!text) return;
        try {
          await Share.share({ message: text, title: 'スクロール学習' }, { subject: 'スクロール学習' });
        } catch {
          // 共有シートを閉じただけのときは、何もしない
        }
        return;
      }

      if (msg.type === 'reminder') {
        const hour = Number(msg.hour);
        const minute = Number(msg.minute);
        if (!isInt(hour, 0, 23) || !isInt(minute, 0, 59)) return;
        const ask = msg.ask === true;
        try {
          const res = await scheduleReminder({ on: msg.on === true, hour, minute, ask });
          sendToWeb({ type: 'reminder-result', silent: !ask, ...res });
        } catch {
          sendToWeb({ type: 'reminder-result', silent: !ask, ok: false, reason: 'error' });
        }
      }
    },
    [sendToWeb, sendPosts]
  );

  // アプリの外へのリンク（出典など）は、Safariで開く
  const onShouldStartLoadWithRequest = useCallback((req) => {
    const url = req.url || '';
    if (req.isTopFrame === false) return true;
    if (url.startsWith(BASE_URL) || url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) {
      return true;
    }
    Linking.openURL(url).catch(() => {});
    return false;
  }, []);

  // iPhoneの「文字の大きさ」設定を、アプリ本体に伝える
  const onLoadEnd = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {});
    let scale = 1;
    try {
      scale = PixelRatio.getFontScale() || 1;
    } catch {
      scale = 1;
    }
    sendToWeb({ type: 'font-scale', scale: Math.min(Math.max(scale, 0.8), 2) });
  }, [sendToWeb]);

  useEffect(() => {
    // 万一読み込みが遅くても、起動画面が出たままにならないように
    const t = setTimeout(() => SplashScreen.hideAsync().catch(() => {}), 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <WebView
        ref={webRef}
        source={{ html: WEB_HTML, baseUrl: BASE_URL }}
        originWhitelist={['*']}
        onMessage={onMessage}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onLoadEnd={onLoadEnd}
        onContentProcessDidTerminate={() => webRef.current?.reload()}
        style={[styles.web, { backgroundColor: bg }]}
        containerStyle={{ backgroundColor: bg }}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        keyboardDisplayRequiresUserAction={false}
        allowsBackForwardNavigationGestures={false}
        allowsLinkPreview={false}
        setSupportMultipleWindows={false}
        javaScriptCanOpenWindowsAutomatically={false}
        domStorageEnabled
        cacheEnabled
        bounces
        webviewDebuggingEnabled={__DEV__}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  web: { flex: 1 },
});
