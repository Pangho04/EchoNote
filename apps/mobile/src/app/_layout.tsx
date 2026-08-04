import { Stack } from 'expo-router';

import { ThemeProvider } from '@/shared/ui/theme-provider';

export default function RootLayout() {
  return (
    <ThemeProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
