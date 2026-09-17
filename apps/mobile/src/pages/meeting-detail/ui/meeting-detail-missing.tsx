import { type ReactElement, useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { useDialog } from '@/shared/ui/dialog';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface MeetingDetailMissingProps {
  message: string;
  onLeave: () => void;
}

// 문구는 팝업이 담당한다. 본문에는 아무것도 그리지 않는다.
export function MeetingDetailMissing({
  message,
  onLeave,
}: MeetingDetailMissingProps): ReactElement {
  const styles = useStyles();
  const { openDialog } = useDialog();

  // 같은 mount 안에서 effect가 다시 실행돼도 팝업을 한 번만 띄우는 가드다.
  const opened = useRef(false);

  /**
   * @when 회의를 열 수 없다고 판정된 화면이 처음 표시될 때
   * @expect 이유를 팝업으로 알리고 닫히면 목록으로 되돌린다.
   * @clear -
   */
  useEffect(() => {
    if (opened.current) return;

    opened.current = true;

    openDialog({
      title: UI_STRINGS.meetingDetail.openFailedTitle,
      message,
      actions: [{ label: UI_STRINGS.common.confirm, emphasis: 'primary', onPress: onLeave }],
      onDismiss: onLeave,
    });
  }, [message, onLeave, openDialog]);

  return <View style={styles.container} />;
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      backgroundColor: theme.colors.surface,
      flex: 1,
    },
  }),
);
