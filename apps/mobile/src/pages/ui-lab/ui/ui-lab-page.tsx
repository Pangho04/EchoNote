import { StatusBar } from 'expo-status-bar';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { createThemedStyles, useTheme } from '@/shared/ui/theme-provider';

export function UiLabPage() {
  const theme = useTheme();
  const styles = useStyles();

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

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
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
  }),
);
