import type { ReactElement } from 'react';
import { Pressable, StyleSheet, View, type ViewStyle } from 'react-native';

import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface NavigationHeaderAction {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
}

export interface NavigationHeaderProps {
  title: string;
  titleVariant?: 'title' | 'display';
  // 있으면 왼쪽에 두고 제목을 가운데로 옮긴다. 없으면 제목이 왼쪽에 온다.
  action?: NavigationHeaderAction;
  trailingAction?: NavigationHeaderAction;
}

export function NavigationHeader({
  title,
  titleVariant = 'title',
  action,
  trailingAction,
}: NavigationHeaderProps): ReactElement {
  const styles = useStyles();

  function renderAction(
    { label, accessibilityLabel, onPress, disabled }: NavigationHeaderAction,
    edgeStyle: ViewStyle,
  ) {
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        disabled={disabled}
        hitSlop={5}
        onPress={onPress}
        style={({ pressed }) => [styles.action, edgeStyle, pressed && styles.actionPressed]}
      >
        <AppText color={disabled ? 'textSecondary' : 'accent'} variant="body">
          {label}
        </AppText>
      </Pressable>
    );
  }

  return (
    <View style={[styles.container, (action || trailingAction) && styles.withAction]}>
      {action && renderAction(action, styles.leadingAction)}

      <AppText accessibilityRole="header" variant={titleVariant}>
        {title}
      </AppText>

      {trailingAction && renderAction(trailingAction, styles.trailingAction)}

      {/** 제목이 가운데에 오도록 action과 같은 폭을 비워 둔다. */}
      {action && !trailingAction && <View style={styles.spacer} />}
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    // 세로·좌우 여백은 목업 CSS `.navigation`(10/18/9) 값이다.
    container: {
      alignItems: 'flex-end',
      backgroundColor: theme.colors.surface,
      borderBottomColor: theme.colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: 'row',
      minHeight: 64,
      paddingBottom: 9,
      paddingHorizontal: 18,
      paddingTop: 10,
    },
    withAction: {
      justifyContent: 'space-between',
    },
    action: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
      minWidth: 44,
      paddingHorizontal: theme.spacing[2],
    },
    // 눌림 배경만 화면 가장자리 쪽으로 넓히고 글자는 container 여백 위치에 둔다.
    leadingAction: {
      marginLeft: -theme.spacing[2],
    },
    trailingAction: {
      marginRight: -theme.spacing[2],
    },
    actionPressed: {
      backgroundColor: theme.colors.surfacePressed,
      borderRadius: theme.radii.control,
    },
    spacer: {
      height: 44,
      width: 44,
    },
  }),
);
