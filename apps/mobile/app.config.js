// 개발 앱과 release 앱은 ID가 달라 한 기기에 함께 설치된다. 값이 없으면 개발 앱으로 빌드한다.
const IS_RELEASE = process.env.APP_VARIANT === 'release';

module.exports = {
  expo: {
    name: IS_RELEASE ? 'EchoNote' : 'EchoNote:Dev',
    slug: 'echonote',
    version: '0.1.0',
    icon: './assets/icon.png',
    orientation: 'portrait',
    scheme: IS_RELEASE ? 'echonote' : 'echonote-dev',
    userInterfaceStyle: 'automatic',
    ios: {
      bundleIdentifier: IS_RELEASE ? 'dev.pangho.echonote' : 'dev.pangho.echonote.dev',
      supportsTablet: false,
    },
    android: {
      package: IS_RELEASE ? 'dev.pangho.echonote' : 'dev.pangho.echonote.dev',
    },
    plugins: [
      ['expo-router', { sitemap: false }],
      [
        'expo-audio',
        {
          enableBackgroundRecording: true,
          microphonePermission: 'EchoNote가 회의를 녹음하려면 마이크 접근 권한이 필요합니다.',
          recordAudioAndroid: true,
        },
      ],
      'expo-sqlite',
      ['expo-build-properties', { ios: { enableSceneSupport: true } }],
      './plugins/with-user-script-sandboxing-disabled',
      'expo-secure-store',
      // release 앱이 개발 서버 연결 링크(exp+echonote)를 가로채지 않게 개발 앱에만 등록한다.
      ['expo-dev-client', { addGeneratedScheme: !IS_RELEASE }],
    ],
    experiments: { typedRoutes: true },
  },
};
