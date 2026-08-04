module.exports = {
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  preset: 'jest-expo',
  testMatch: ['<rootDir>/src/**/*.ui.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!(.pnpm|(jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|expo-router|react-navigation|@react-navigation/.*|react-native-safe-area-context|react-native-screens|react-native-svg))',
  ],
};
