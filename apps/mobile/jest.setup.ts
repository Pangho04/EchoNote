// native 모듈이라 test 환경에서는 라이브러리가 제공하는 mock으로 대체한다.
jest.mock('react-native-keyboard-controller', () =>
  jest.requireActual('react-native-keyboard-controller/jest'),
);
jest.mock('react-native-worklets', () =>
  jest.requireActual('react-native-worklets/lib/module/mock'),
);
jest.requireActual('react-native-gesture-handler/jestSetup');

import type * as SwiftUIModule from '@expo/ui/swift-ui';
import type * as ReactModule from 'react';
import type * as ReactNativeModule from 'react-native';

// 네이티브 SwiftUI 뷰를 그릴 수 없는 테스트 환경에서는 RN 요소로 대신한다.
// 상태는 DropdownMenu가 소유하므로 mock은 받은 props대로만 그린다. 호출 인자는 jest.fn으로 남겨 테스트가 읽는다.
jest.mock('@expo/ui/swift-ui', () => {
  const { Children, createElement, Fragment, isValidElement } =
    jest.requireActual<typeof ReactModule>('react');
  const { Pressable, Text } = jest.requireActual<typeof ReactNativeModule>('react-native');

  const passThrough = ({ children }: { children?: ReactModule.ReactNode }) =>
    createElement(Fragment, null, children);
  const PopoverContent = jest.fn(passThrough);

  // Content 슬롯은 isPresented일 때만 그려 열림·닫힘을 화면 조회로 확인할 수 있게 한다.
  const Popover = Object.assign(
    jest.fn(
      ({ isPresented, children }: { isPresented?: boolean; children?: ReactModule.ReactNode }) =>
        createElement(
          Fragment,
          null,
          Children.map(children, (child) =>
            isValidElement(child) && child.type === PopoverContent && !isPresented ? null : child,
          ),
        ),
    ),
    { Trigger: passThrough, Content: PopoverContent },
  );

  const Button = jest.fn(
    ({ onPress, children }: { onPress?: () => void; children?: ReactModule.ReactNode }) =>
      createElement(Pressable, { accessibilityRole: 'menuitem', onPress }, children),
  );

  return {
    Button,
    Host: passThrough,
    HStack: passThrough,
    Image: jest.fn(() => null),
    Popover,
    RNHostView: passThrough,
    ScrollView: jest.fn(passThrough),
    Spacer: () => null,
    Text: ({ children }: { children?: ReactModule.ReactNode }) =>
      createElement(Text, null, children),
    VStack: passThrough,
  } satisfies Partial<Record<keyof typeof SwiftUIModule, unknown>>;
});
