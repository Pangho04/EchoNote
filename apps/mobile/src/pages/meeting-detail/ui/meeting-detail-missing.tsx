import { type ReactElement, useEffect, useRef } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface MeetingDetailMissingProps {
  message: string;
  onLeave: () => void;
}

// 문구는 native Alert이 담당한다. 본문에는 아무것도 그리지 않는다.
// ponytail: react-native-web의 Alert은 no-op이라 웹에서는 안내가 사라진다. Electron 지원 시 화면 내 fallback이 필요하다.
export function MeetingDetailMissing({
  message,
  onLeave,
}: MeetingDetailMissingProps): ReactElement {
  const styles = useStyles();
  // 같은 mount 안에서 effect가 다시 실행돼도 Alert을 한 번만 띄우는 가드다.
  const alerted = useRef(false);

  /**
   * @when 회의를 열 수 없다고 판정된 화면이 처음 표시될 때
   * @expect 이유를 native Alert으로 알리고 닫히면 목록으로 되돌린다.
   * @clear -
   */
  useEffect(() => {
    if (alerted.current) return;

    alerted.current = true;

    Alert.alert('회의를 열 수 없습니다', message, [{ text: '확인', onPress: onLeave }], {
      cancelable: true,
      onDismiss: onLeave,
    });
  }, [message, onLeave]);

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
