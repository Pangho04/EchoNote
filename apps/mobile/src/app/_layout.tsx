import { Stack } from 'expo-router';
import { KeyboardProvider } from 'react-native-keyboard-controller';

import { DatabaseProvider } from '@/shared/platform/database';
import { ThemeProvider } from '@/shared/ui/theme-provider';
import { ToastProvider } from '@/shared/ui/toast';

export default function RootLayout() {
  return (
    <KeyboardProvider>
      <DatabaseProvider>
        <ThemeProvider>
          <ToastProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </ToastProvider>
        </ThemeProvider>
      </DatabaseProvider>
    </KeyboardProvider>
  );
}
