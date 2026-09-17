import { Stack } from 'expo-router';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { DatabaseProvider } from '@/shared/platform/database';
import { DialogProvider } from '@/shared/ui/dialog';
import { ThemeProvider } from '@/shared/ui/theme-provider';
import { ToastProvider } from '@/shared/ui/toast';

export default function RootLayout() {
  return (
    <KeyboardProvider>
      {/* DB를 열지 못하면 DatabaseProvider가 복구 화면을 대신 그리므로 테마가 그보다 바깥에 있어야 한다. */}
      <ThemeProvider>
        <DatabaseProvider>
          <ToastProvider>
            <DialogProvider>
              <Stack screenOptions={{ headerShown: false }} />
            </DialogProvider>
          </ToastProvider>
        </DatabaseProvider>
      </ThemeProvider>
    </KeyboardProvider>
  );
}
