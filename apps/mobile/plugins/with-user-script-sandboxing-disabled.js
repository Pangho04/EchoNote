// eslint-disable-next-line @typescript-eslint/no-require-imports -- 이 패키지는 "type": "module"이 아니라 .js 파일이 CommonJS로 로드된다.
const { withXcodeProject } = require('expo/config-plugins');

// React Native·CocoaPods 빌드 스크립트는 입출력으로 선언하지 않은 파일(ip.txt, resources-to-copy-*.txt)에 쓴다.
// Xcode 스크립트 샌드박스가 켜져 있으면 이 쓰기가 `Operation not permitted`로 막혀 실기기 빌드가 실패한다.
module.exports = function withUserScriptSandboxingDisabled(config) {
  return withXcodeProject(config, (config) => {
    const configurations = config.modResults.pbxXCBuildConfigurationSection();

    for (const configuration of Object.values(configurations)) {
      if (typeof configuration === 'object' && configuration.buildSettings) {
        configuration.buildSettings.ENABLE_USER_SCRIPT_SANDBOXING = 'NO';
      }
    }

    return config;
  });
};
