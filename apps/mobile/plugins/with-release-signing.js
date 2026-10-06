// eslint-disable-next-line @typescript-eslint/no-require-imports -- 이 패키지는 "type": "module"이 아니라 .js 파일이 CommonJS로 로드된다.
const { withAppBuildGradle } = require('expo/config-plugins');

// 값은 저장소 밖 ~/.gradle/gradle.properties에만 두고, 생성되는 build.gradle에는 속성 이름만 남긴다.
const RELEASE_SIGNING_CONFIG = `
        release {
            ['ECHONOTE_RELEASE_STORE_FILE', 'ECHONOTE_RELEASE_STORE_PASSWORD', 'ECHONOTE_RELEASE_KEY_ALIAS', 'ECHONOTE_RELEASE_KEY_PASSWORD'].each { key ->
                if (!findProperty(key)) throw new GradleException("~/.gradle/gradle.properties에 \${key}가 없어 release 서명을 할 수 없습니다.")
            }
            storeFile file(findProperty('ECHONOTE_RELEASE_STORE_FILE'))
            storePassword findProperty('ECHONOTE_RELEASE_STORE_PASSWORD')
            keyAlias findProperty('ECHONOTE_RELEASE_KEY_ALIAS')
            keyPassword findProperty('ECHONOTE_RELEASE_KEY_PASSWORD')
        }`;

// Expo 템플릿은 release도 debug 키로 서명한다. 템플릿이 바뀌어 치환이 빗나가면 debug 서명으로 조용히 빌드되므로 prebuild를 멈춘다.
module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (config) => {
    const contents = config.modResults.contents;

    if (contents.includes('signingConfigs.release')) return config;

    const releaseSigned = contents.replace(
      /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
      '$1signingConfig signingConfigs.release',
    );
    if (releaseSigned === contents) {
      throw new Error(
        'with-release-signing: buildTypes.release의 debug 서명 설정을 찾지 못했습니다.',
      );
    }

    const withConfig = releaseSigned.replace(
      /signingConfigs\s*\{/,
      (anchor) => anchor + RELEASE_SIGNING_CONFIG,
    );
    if (withConfig === releaseSigned) {
      throw new Error('with-release-signing: signingConfigs 블록을 찾지 못했습니다.');
    }

    config.modResults.contents = withConfig;

    return config;
  });
};
