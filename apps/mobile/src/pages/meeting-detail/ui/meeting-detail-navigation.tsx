import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface MeetingDetailNavigationProps {
  onBack: () => void;
}

export function MeetingDetailNavigation({ onBack }: MeetingDetailNavigationProps): ReactElement {
  const styles = useStyles();

  return (
    <View style={styles.container}>
      <Pressable
        accessibilityLabel={UI_STRINGS.meetingDetail.backLabel}
        accessibilityRole="button"
        hitSlop={5}
        onPress={onBack}
        style={styles.action}
      >
        <AppText color="accent" variant="body">
          {UI_STRINGS.meetingDetail.back}
        </AppText>
      </Pressable>

      <AppText accessibilityRole="header" variant="title">
        {UI_STRINGS.meetingDetail.heading}
      </AppText>

      {/** 목업의 더보기 버튼 자리를 비워 두는 고정 여백 */}
      <View style={styles.spacer} />
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    // 세로·좌우 여백은 목업 CSS `.navigation`(10/18/9) 값이며 회의 목록 헤더와 같다.
    container: {
      alignItems: 'flex-end',
      backgroundColor: theme.colors.surface,
      borderBottomColor: theme.colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      justifyContent: 'space-between',
      minHeight: 64,
      paddingBottom: 9,
      paddingHorizontal: 18,
      paddingTop: 10,
    },
    action: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
      minWidth: 44,
    },
    spacer: {
      height: 44,
      width: 44,
    },
  }),
);
