import { Stack } from 'expo-router';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import {
  createSupabaseSession,
  secureStoreAdapter,
  SessionProvider,
} from '@/features/authenticate';
import { createMobileSupabaseClient } from '@/shared/api/supabase-client';
import { DatabaseProvider } from '@/shared/platform/database';
import { DialogProvider } from '@/shared/ui/dialog';
import { ThemeProvider } from '@/shared/ui/theme-provider';
import { ToastProvider } from '@/shared/ui/toast';

// 앱 전체에서 client 하나만 만든다. 여럿이면 같은 저장소 키로 refresh가 겹친다.
const session = createSupabaseSession(createMobileSupabaseClient(secureStoreAdapter).auth);

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
                  <Stack screenOptions={{ headerShown: false }} />
                </SessionProvider>
              </DialogProvider>
            </ToastProvider>
          </DatabaseProvider>
        </ThemeProvider>
      </KeyboardProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
