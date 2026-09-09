import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface MeetingDetailHeaderProps {
  dateLabel: string;
  title: string;
  metaLabel: string;
}

export function MeetingDetailHeader({
  dateLabel,
  title,
  metaLabel,
}: MeetingDetailHeaderProps): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <AppText color="recording" style={styles.kicker} variant="caption">
        {dateLabel}
      </AppText>

      <AppText accessibilityRole="header" style={styles.title} variant="title">
        {title}
      </AppText>

      <AppText color="textSecondary" style={styles.meta} variant="caption">
        {metaLabel}
      </AppText>
    </View>
  );
}

// title의 29/32와 meta의 marginTop 10은 목업이 지정한 값이며 대응하는 theme 토큰이 없다.
const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surface,
      paddingBottom: theme.spacing[5],
      paddingHorizontal: theme.spacing[5],
      paddingTop: theme.spacing[6],
    },
    kicker: {
      fontWeight: theme.typography.fontWeight.bold,
      marginBottom: theme.spacing[2],
    },
    title: {
      fontSize: 29,
      fontWeight: theme.typography.fontWeight.semibold,
      lineHeight: 32,
    },
    meta: {
      marginTop: 10,
    },
  }),
);
