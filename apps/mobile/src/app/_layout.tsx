import { Stack } from 'expo-router';

import { DatabaseProvider } from '@/shared/platform/database';
import { ThemeProvider } from '@/shared/ui/theme-provider';

export default function RootLayout() {
  return (
    <DatabaseProvider>
      <ThemeProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </ThemeProvider>
    </DatabaseProvider>
  );
}
