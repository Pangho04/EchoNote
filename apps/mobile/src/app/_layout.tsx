import { Stack } from 'expo-router';
import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import {
  createSupabaseSession,
  secureStoreAdapter,
  SessionProvider,
  useAuthGuard,
  useSessionExpiryDialog,
} from '@/features/authenticate';
import { createGatewayClient, GatewayClientProvider } from '@/shared/api/gateway-client';
import { createMobileSupabaseClient } from '@/shared/api/supabase-client';
import { GATEWAY_URL } from '@/shared/config/env';
import { DatabaseProvider } from '@/shared/platform/database';
import { DialogProvider } from '@/shared/ui/dialog';
import { createThemedStyles, ThemeProvider } from '@/shared/ui/theme-provider';
import { ToastProvider } from '@/shared/ui/toast';

// 앱 전체에서 client 하나만 만든다. 여럿이면 같은 저장소 키로 refresh가 겹친다.
const session = createSupabaseSession(
  createMobileSupabaseClient(secureStoreAdapter).auth,
  secureStoreAdapter,
);
const gateway = createGatewayClient(GATEWAY_URL, () => session.getAccessToken());

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={styles.root}>
      <KeyboardProvider>
        {/* DB를 열지 못하면 DatabaseProvider가 복구 화면을 대신 그리므로 테마가 그보다 바깥에 있어야 한다. */}
        <ThemeProvider>
          <DatabaseProvider>
            <ToastProvider>
              <DialogProvider>
                <SessionProvider session={session}>
                  <GatewayClientProvider client={gateway}>
                    <RootNavigator />
                  </GatewayClientProvider>
                </SessionProvider>
              </DialogProvider>
            </ToastProvider>
          </DatabaseProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

// 로그인 여부에 따라 열 수 있는 화면을 고른다. guard에서 빠진 화면으로 가는 이동·링크는 라이브러리가 무시한다.
export function RootNavigator(): ReactElement {
  const guard = useAuthGuard();
  const themedStyles = useStyles();

  useSessionExpiryDialog();

  switch (guard.kind) {
    case 'restoring':
      return <View style={themedStyles.restoring} />;

    case 'ready':
      return (
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={guard.appOpen}>
            <Stack.Screen name="index" />
            <Stack.Screen name="meetings/[meetingId]" />
            <Stack.Screen name="+not-found" />
          </Stack.Protected>
          <Stack.Protected guard={guard.recordingOpen}>
            <Stack.Screen name="recording" />
          </Stack.Protected>
          <Stack.Protected guard={guard.signInOpen}>
            <Stack.Screen name="sign-in" />
          </Stack.Protected>
        </Stack>
      );
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    restoring: {
      backgroundColor: theme.colors.background,
      flex: 1,
    },
  }),
);
