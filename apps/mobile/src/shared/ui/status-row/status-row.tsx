import type { ReactElement } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles, useTheme } from '@/shared/ui/theme-provider';

export interface StatusRowProps {
  label: string;
}

// 진행 중인 작업 이름과 회전 표시. 표시는 장식이라 스크린리더에서 숨긴다.
export function StatusRow({ label }: StatusRowProps): ReactElement {
  const styles = useStyles();
  const theme = useTheme();

  return (
    <View style={styles.row}>
      <AppText style={styles.label} variant="body">
        {label}
      </AppText>

      <ActivityIndicator
        accessibilityElementsHidden
        color={theme.colors.accent}
        importantForAccessibility="no-hide-descendants"
        size="small"
      />
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    row: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: theme.spacing[2],
    },
    label: {
      fontSize: 15,
      fontWeight: theme.typography.fontWeight.semibold,
    },
  }),
);
