import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import { type ReactElement, useEffect } from 'react';
import { BackHandler, Pressable, Text, View } from 'react-native';

import { RootNavigator } from '@/app/_layout';
import { redirectSystemPath } from '@/app/+native-intent';
import NotFoundRoute from '@/app/+not-found';
import { isRecordingScreenHeld, SessionProvider, type SessionState } from '@/features/authenticate';
import { useRecordingExit } from '@/pages/recording/model/use-recording-exit';
import { ROUTES } from '@/shared/config/routes';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { DialogProvider, useDialog } from '@/shared/ui/dialog';
import { ThemeProvider } from '@/shared/ui/theme-provider';

jest.mock('@/shared/config/env', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'publishable-test-key',
  GATEWAY_URL: 'http://127.0.0.1:4317',
}));
// app.json의 sitemap 끔 설정을 그대로 넣는다. 없으면 renderRouter가 guard 밖에 _sitemap을 붙인다.
jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  const constants = actual.default ?? actual;
  const expoConfig = {
    ...constants.expoConfig,
    scheme: 'echonote',
    extra: { router: { sitemap: false } },
  };

  return { __esModule: true, ...actual, default: { ...constants, expoConfig } };
});
jest.mock('@/shared/api/supabase-client', () => ({
  AUTH_STORAGE_KEY: 'echonote-auth',
  createMobileSupabaseClient: () => ({ auth: {} }),
}));

const SIGNED_IN: SessionState = { kind: 'signedIn', userId: 'user-1' };
const EXPIRED: SessionState = { kind: 'signedOut', cause: 'expired' };

const fake = {
  emit: (_state: SessionState) => {},
  resolveRestore: (_state: SessionState) => {},
  canDiscard: false,
  isSaving: false,
  discard: jest.fn(async () => {}),
  openDialogAction: jest.fn(),
  mounts: 0,
  unmounts: 0,
  detailMounts: 0,
  detailUnmounts: 0,
  backHandlers: [] as Parameters<typeof BackHandler.addEventListener>[1][],
};

const session = {
  subscribe: (listener: (state: SessionState) => void) => {
    fake.emit = listener;

    return () => {};
  },
  restore: () =>
    new Promise<SessionState>((resolve) => {
      fake.resolveRestore = resolve;
    }),
  signIn: async () => {},
  signOut: async () => {},
  startAutoRefresh: () => {},
  stopAutoRefresh: () => {},
};

// 실제 useRecordingExit에 녹음 상태만 가짜로 넣는다. 버튼은 [취소]와 저장 완료 신호다.
function FakeRecordingRoute(): ReactElement {
  const { cancel, finish } = useRecordingExit({
    canDiscard: fake.canDiscard,
    isSaving: fake.isSaving,
    discard: fake.discard,
  });

  /**
   * @when 녹음 화면이 마운트되면
   * @expect 마운트·언마운트 횟수를 센다
   * @clear 언마운트 횟수를 올린다
   */
  useEffect(() => {
    fake.mounts += 1;

    return () => {
      fake.unmounts += 1;
    };
  }, []);

  return (
    <View>
      <Text>RECORDING</Text>
      <Pressable onPress={cancel}>
        <Text>CANCEL</Text>
      </Pressable>
      <Pressable onPress={() => finish('m-1')}>
        <Text>SAVED</Text>
      </Pressable>
    </View>
  );
}

// 목록 쌓임 뒤에도 상세가 언마운트되지 않는지 보려고 마운트·언마운트를 센다.
function FakeDetailRoute(): ReactElement {
  /**
   * @when 상세 화면이 마운트되면
   * @expect 마운트·언마운트 횟수를 센다
   * @clear 언마운트 횟수를 올린다
   */
  useEffect(() => {
    fake.detailMounts += 1;

    return () => {
      fake.detailUnmounts += 1;
    };
  }, []);

  return <Text>DETAIL</Text>;
}

// 만료 팝업이 열려 있던 팝업을 대체하는지 보려고 목록에서 팝업을 미리 띄운다.
function FakeListRoute(): ReactElement {
  const { openDialog } = useDialog();

  return (
    <Pressable
      onPress={() =>
        openDialog({
          message: 'OPEN-DIALOG',
          actions: [{ label: 'OPEN-ACTION', onPress: fake.openDialogAction }],
        })
      }
    >
      <Text>LIST</Text>
    </Pressable>
  );
}

function TestLayout(): ReactElement {
  return (
    <ThemeProvider mode="light">
      <DialogProvider>
        <SessionProvider session={session as never}>
          <RootNavigator />
        </SessionProvider>
      </DialogProvider>
    </ThemeProvider>
  );
}

const routes = {
  _layout: TestLayout,
  index: FakeListRoute,
  'meetings/[meetingId]': FakeDetailRoute,
  '+not-found': NotFoundRoute,
  recording: FakeRecordingRoute,
  'sign-in': () => <Text>SIGN-IN</Text>,
};

async function start(initialUrl: string, restored: SessionState | null) {
  const view = renderRouter(routes, { initialUrl });

  await view;

  if (restored) await act(async () => fake.resolveRestore(restored));

  // renderRouter 반환값은 Promise에 메서드를 붙인 것이라 await하면 메서드가 사라진다.
  return { getRouterState: () => view.getRouterState() };
}

async function emit(state: SessionState): Promise<void> {
  await act(async () => fake.emit(state));
}

async function press(text: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByText(text));
  });
}

async function navigate(href: Parameters<typeof router.navigate>[0]): Promise<void> {
  await act(async () => router.navigate(href));
}

// 앱 실행 중 들어온 링크처럼 +native-intent를 거친 경로로 이동한다.
async function openLink(url: string): Promise<void> {
  const href = redirectSystemPath({ path: url, initial: false });

  expect(href).not.toBeNull();
  await navigate(href!.replace(/^echonote:\/\/\/?/, '/') as never);
}

async function pressHardwareBack(): Promise<boolean> {
  let handled = false;

  await act(async () => {
    handled = fake.backHandlers.some(
      (handler) => handler({ type: 'hardwareBackPress', timeStamp: Date.now() }) === true,
    );
  });

  return handled;
}

function stackNames(view: Awaited<ReturnType<typeof start>>): string[] {
  const root = view.getRouterState()?.routes[0]?.state;

  return (root?.routes ?? []).map((route) => route.name);
}

beforeEach(() => {
  Object.assign(fake, {
    canDiscard: false,
    isSaving: false,
    discard: jest.fn(async () => {}),
    openDialogAction: jest.fn(),
    mounts: 0,
    unmounts: 0,
    detailMounts: 0,
    detailUnmounts: 0,
    backHandlers: [],
  });
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    fake.backHandlers.unshift(handler);

    return {
      remove: () => {
        fake.backHandlers = fake.backHandlers.filter((item) => item !== handler);
      },
    };
  });
});

describe('RootNavigator', () => {
  it('T1 restoring 중엔 배경만 그린다', async () => {
    await start('/meetings/x', null);

    expect(screen.queryByText('DETAIL')).toBeNull();
    expect(screen.queryByText('SIGN-IN')).toBeNull();
  });

  it.each(['/', '/meetings/x', '/recording', '/sign-in'])(
    'T2 signedOut으로 %s에서 시작하면 로그인 화면이다',
    async (initialUrl) => {
      await start(initialUrl, { kind: 'signedOut', cause: 'restore' });

      expect(screen.getByText('SIGN-IN')).toBeTruthy();
    },
  );

  it('T2 로그인하면 목록, 만료되면 로그인 화면과 만료 팝업이 열린 팝업을 대체한다', async () => {
    await start('/', { kind: 'signedOut', cause: 'restore' });
    await emit(SIGNED_IN);

    expect(screen.getByText('LIST')).toBeTruthy();

    await press('LIST');
    await emit(EXPIRED);

    expect(screen.getByText('SIGN-IN')).toBeTruthy();
    expect(screen.getByText(UI_STRINGS.auth.sessionExpiredMessage)).toBeTruthy();
    expect(screen.queryByText('OPEN-DIALOG')).toBeNull();

    await press(UI_STRINGS.common.confirm);

    expect(fake.openDialogAction).not.toHaveBeenCalled();
  });

  it('T2 signedIn 상세에서 만료되면 로그인 화면이다', async () => {
    await start('/meetings/x', SIGNED_IN);

    expect(screen.getByText('DETAIL')).toBeTruthy();

    await emit(EXPIRED);

    expect(screen.getByText('SIGN-IN')).toBeTruthy();
  });

  it('T2 signedIn에서 /recording을 열면 녹음 화면과 유지 표시가 켜진다', async () => {
    await start('/', SIGNED_IN);
    await navigate(ROUTES.recording.session('m-1'));

    expect(screen.getByText('RECORDING')).toBeTruthy();
    expect(isRecordingScreenHeld()).toBe(true);
  });

  it.each([
    ['signedOut', { kind: 'signedOut', cause: 'restore' } as SessionState, 'SIGN-IN', ['sign-in']],
    ['signedIn', SIGNED_IN, 'LIST', ['index']],
  ])(
    'T2 %s 첫 화면에서 없는 경로·/_sitemap 링크를 열어도 그 화면 하나만 남는다',
    async (_name, state, current, stack) => {
      const view = await start('/', state);

      await openLink('echonote://missing');

      expect(screen.getByText(current)).toBeTruthy();
      expect(stackNames(view)).toEqual(stack);

      await openLink('echonote:///_sitemap');

      expect(screen.getByText(current)).toBeTruthy();
      expect(stackNames(view)).toEqual(stack);
    },
  );

  it.each([
    ['링크를 열면', () => openLink('echonote://missing')],
    ['앱 안에서 이동하면', () => navigate('/missing' as never)],
  ])(
    'T2 상세에서 없는 경로 %s 목록 화면이 되고 상세 위에 목록이 쌓인다. 상세는 언마운트되지 않는다',
    async (_name, go) => {
      const view = await start('/meetings/x', SIGNED_IN);

      await go();

      expect(screen.getByText('LIST')).toBeTruthy();
      expect(stackNames(view)).toEqual(['meetings/[meetingId]', 'index']);
      expect(fake.detailUnmounts).toBe(0);
    },
  );

  it('T3 녹음 화면에서 만료되면 목록만 빠지고 녹음 화면은 유지된다. 다시 로그인하면 저장 완료 시 목록 위 상세다', async () => {
    const view = await start('/', SIGNED_IN);

    await navigate(ROUTES.recording.session('m-1'));
    await emit(EXPIRED);

    expect(stackNames(view)).toEqual(['recording']);
    expect(fake.unmounts).toBe(0);
    expect(screen.getByText(UI_STRINGS.auth.sessionExpiredRecordingMessage)).toBeTruthy();

    await press(UI_STRINGS.common.confirm);
    await emit(SIGNED_IN);

    expect(stackNames(view)).toEqual(['recording']);
    expect(isRecordingScreenHeld()).toBe(true);

    await press('SAVED');

    const detail = view.getRouterState()?.routes[0]?.state?.routes.at(-1);

    expect(stackNames(view)).toEqual(['index', 'meetings/[meetingId]']);
    expect(detail?.params).toEqual({ meetingId: 'm-1', autoRequest: '1' });
    expect(isRecordingScreenHeld()).toBe(false);
  });

  it('T3 만료 뒤 다시 로그인한 녹음 화면(아래 목록 없음)에서 뒤로가기는 [취소]와 같다', async () => {
    const view = await start('/', SIGNED_IN);

    await navigate(ROUTES.recording.session('m-1'));
    await emit(EXPIRED);
    await press(UI_STRINGS.common.confirm);
    await emit(SIGNED_IN);

    expect(await pressHardwareBack()).toBe(true);
    expect(stackNames(view)).toEqual(['index']);
    expect(isRecordingScreenHeld()).toBe(false);
  });

  it('T3 signedIn 녹음에서 저장 완료하면 녹음 화면이 자동 요청 상세로 바뀌고 유지 표시가 꺼진다', async () => {
    const view = await start('/', SIGNED_IN);

    await navigate(ROUTES.recording.session('m-1'));
    await press('SAVED');

    const detail = view.getRouterState()?.routes[0]?.state?.routes.at(-1);

    expect(stackNames(view)).toEqual(['index', 'meetings/[meetingId]']);
    expect(detail?.params).toEqual({ meetingId: 'm-1', autoRequest: '1' });
    expect(screen.getByText('DETAIL')).toBeTruthy();
    expect(isRecordingScreenHeld()).toBe(false);
  });

  it('T3 저장 완료와 만료 알림이 같은 act 안에서 연달아 오면 로그인 화면이고 index는 스택에 없다', async () => {
    const view = await start('/', SIGNED_IN);

    await navigate(ROUTES.recording.session('m-1'));

    await act(async () => {
      fireEvent.press(screen.getByText('SAVED'));
      fake.emit(EXPIRED);
    });

    expect(screen.getByText('SIGN-IN')).toBeTruthy();
    expect(stackNames(view)).not.toContain('index');
  });

  it('T3 [취소]: 버릴 녹음 없으면 목록, 있으면 폐기 팝업 뒤 목록, 폐기 실패면 화면 유지', async () => {
    const view = await start('/', SIGNED_IN);

    await navigate(ROUTES.recording.session('m-1'));
    await press('CANCEL');

    expect(stackNames(view)).toEqual(['index']);

    fake.canDiscard = true;
    await navigate(ROUTES.recording.session('m-2'));
    await press('CANCEL');
    await press(UI_STRINGS.recording.discard);

    expect(fake.discard).toHaveBeenCalledTimes(1);
    expect(stackNames(view)).toEqual(['index']);

    fake.discard = jest.fn(async () => {
      throw new Error('disk');
    });
    await navigate(ROUTES.recording.session('m-3'));
    await press('CANCEL');
    await press(UI_STRINGS.recording.discard);

    expect(screen.getByText(UI_STRINGS.recording.discardFailed)).toBeTruthy();
    expect(screen.getByText('RECORDING')).toBeTruthy();
  });

  // 실제 BackHandler처럼 나중에 등록한 handler부터 부르고 true에서 멈춘다. 내비게이션 컨테이너의 기본 뒤로가기가 먼저 처리한다.
  it('T3 아래 목록이 있는 녹음에서 뒤로가기는 기본 뒤로가기로 넘기고 폐기 팝업이 뜬다', async () => {
    fake.canDiscard = true;
    await start('/', SIGNED_IN);
    await navigate(ROUTES.recording.session('m-1'));
    await pressHardwareBack();

    expect(screen.getByText(UI_STRINGS.recording.discardTitle)).toBeTruthy();
  });

  it('T3 폐기 진행 중 만료되면 폐기가 끝난 뒤 로그인 화면이다', async () => {
    let finishDiscard = () => {};

    fake.canDiscard = true;
    fake.discard = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishDiscard = resolve;
        }),
    );
    await start('/', SIGNED_IN);
    await navigate(ROUTES.recording.session('m-1'));
    await press('CANCEL');
    await press(UI_STRINGS.recording.discard);
    await emit(EXPIRED);
    await press(UI_STRINGS.common.confirm);

    expect(screen.getByText('RECORDING')).toBeTruthy();

    await act(async () => finishDiscard());

    expect(screen.getByText('SIGN-IN')).toBeTruthy();
  });

  it('T4 signedIn에서 /sign-in은 현재 화면을 유지한다', async () => {
    await start('/meetings/x', SIGNED_IN);
    await navigate('/sign-in' as never);

    expect(screen.getByText('DETAIL')).toBeTruthy();
  });

  it('T5 signedOut·유지 중 다른 화면 이동은 무시되고 쌓이지 않는다. 저장 완료하면 로그인 화면이다', async () => {
    const view = await start('/', SIGNED_IN);

    await navigate(ROUTES.recording.session('m-1'));
    await emit(EXPIRED);
    await press(UI_STRINGS.common.confirm);

    for (const href of ['/', '/meetings/x', ROUTES.recording.session('m-2'), '/sign-in']) {
      await navigate(href as never);
    }

    expect(stackNames(view)).toEqual(['recording']);
    expect(fake.mounts).toBe(1);

    await press('SAVED');

    expect(screen.getByText('SIGN-IN')).toBeTruthy();
  });

  it.each([
    ['버릴 녹음 없음', false, false],
    ['폐기 확인', true, false],
    ['뒤로가기', true, true],
  ])('T5 signedOut·유지 중 %s → 로그인 화면', async (_name, canDiscard, useBack) => {
    fake.canDiscard = canDiscard;
    await start('/', SIGNED_IN);
    await navigate(ROUTES.recording.session('m-1'));
    await emit(EXPIRED);
    await press(UI_STRINGS.common.confirm);

    if (useBack) expect(await pressHardwareBack()).toBe(true);
    else await press('CANCEL');

    if (canDiscard) await press(UI_STRINGS.recording.discard);

    expect(screen.getByText('SIGN-IN')).toBeTruthy();
  });

  it('T5 signedOut·유지 중 저장 중 [취소]는 무동작', async () => {
    fake.isSaving = true;
    await start('/', SIGNED_IN);
    await navigate(ROUTES.recording.session('m-1'));
    await emit(EXPIRED);
    await press(UI_STRINGS.common.confirm);
    await press('CANCEL');

    expect(screen.queryByText(UI_STRINGS.recording.discardTitle)).toBeNull();
    expect(screen.getByText('RECORDING')).toBeTruthy();
  });

  it('T5 signedOut·유지 중 폐기 실패는 discardFailed 팝업과 화면 유지', async () => {
    fake.canDiscard = true;
    fake.discard = jest.fn(async () => {
      throw new Error('disk');
    });
    await start('/', SIGNED_IN);
    await navigate(ROUTES.recording.session('m-1'));
    await emit(EXPIRED);
    await press(UI_STRINGS.common.confirm);
    await press('CANCEL');
    await press(UI_STRINGS.recording.discard);

    expect(screen.getByText(UI_STRINGS.recording.discardFailed)).toBeTruthy();
    expect(screen.getByText('RECORDING')).toBeTruthy();
  });

  it.each([
    ['/meetings/x', SIGNED_IN, 'DETAIL'],
    ['/meetings/x', { kind: 'signedOut', cause: 'restore' } as SessionState, 'SIGN-IN'],
    ['/missing', SIGNED_IN, 'LIST'],
    ['/missing', { kind: 'signedOut', cause: 'restore' } as SessionState, 'SIGN-IN'],
    ['/_sitemap', SIGNED_IN, 'LIST'],
    ['/_sitemap', { kind: 'signedOut', cause: 'restore' } as SessionState, 'SIGN-IN'],
  ])(
    'T6 restoring 중 받은 %s는 상태 확정 뒤 적용·차단된다',
    async (initialUrl, state, expected) => {
      await start(initialUrl, null);
      await act(async () => fake.resolveRestore(state));

      expect(screen.getByText(expected)).toBeTruthy();
    },
  );
});
