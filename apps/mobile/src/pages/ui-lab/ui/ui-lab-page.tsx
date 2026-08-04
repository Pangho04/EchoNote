import { useMemo } from 'react';

import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { StatusBar } from 'expo-status-bar';

import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/shared/ui/theme-provider';

import type { AppTheme } from '@/shared/config/theme';

export function UiLabPage() {
  const theme = useTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>ECHONOTE</Text>
        <Text style={styles.title}>UI Lab</Text>
        <View style={styles.divider} />
        <View accessibilityLabel="학습 컴포넌트 미리보기 영역" style={styles.preview} />
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    content: {
      flexGrow: 1,
      paddingHorizontal: theme.spacing[5],
      paddingVertical: theme.spacing[6],
    },
    divider: {
      backgroundColor: theme.colors.border,
      height: StyleSheet.hairlineWidth,
      marginTop: theme.spacing[5],
    },
    eyebrow: {
      color: theme.colors.recording,
      fontSize: theme.typography.fontSize.caption,
      fontWeight: theme.typography.fontWeight.bold,
    },
    preview: {
      flex: 1,
      minHeight: 320,
      paddingTop: theme.spacing[6],
    },
    safeArea: {
      backgroundColor: theme.colors.background,
      flex: 1,
    },
    title: {
      color: theme.colors.textPrimary,
      fontSize: theme.typography.fontSize.largeTitle,
      fontWeight: theme.typography.fontWeight.bold,
      lineHeight: theme.typography.lineHeight.largeTitle,
      marginTop: theme.spacing[2],
    },
  });
}
