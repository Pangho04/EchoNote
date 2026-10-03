import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { RenameMeetingEditor } from '@/features/rename-meeting';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface MeetingDetailHeaderProps {
  dateLabel: string;
  title: string;
  metaLabel: string;
  // 없으면 연필을 비활성한다(녹음 파일을 가져오는 중).
  rename?: (title: string) => Promise<void>;
}

async function renameUnavailable(): Promise<void> {}

export function MeetingDetailHeader({
  dateLabel,
  title,
  metaLabel,
  rename,
}: MeetingDetailHeaderProps): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <AppText color="recording" style={styles.kicker} variant="caption">
        {dateLabel}
      </AppText>

      <RenameMeetingEditor
        disabled={rename === undefined}
        onSave={rename ?? renameUnavailable}
        title={title}
      />

      <AppText color="textSecondary" style={styles.meta} variant="caption">
        {metaLabel}
      </AppText>
    </View>
  );
}

// meta의 marginTop 10은 목업이 지정한 값이며 대응하는 theme 토큰이 없다.
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
    meta: {
      marginTop: 10,
    },
  }),
);
