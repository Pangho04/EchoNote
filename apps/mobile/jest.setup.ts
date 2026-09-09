// native 모듈이라 test 환경에서는 라이브러리가 제공하는 mock으로 대체한다.
jest.mock('react-native-keyboard-controller', () =>
  jest.requireActual('react-native-keyboard-controller/jest'),
);
