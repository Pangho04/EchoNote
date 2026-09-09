import { Stack } from 'expo-router';

import { DatabaseProvider } from '@/shared/platform/database';
import { ThemeProvider } from '@/shared/ui/theme-provider';
import { ToastProvider } from '@/shared/ui/toast';

export default function RootLayout() {
  return (
    <DatabaseProvider>
      <ThemeProvider>
        <ToastProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </ToastProvider>
      </ThemeProvider>
    </DatabaseProvider>
  );
}
