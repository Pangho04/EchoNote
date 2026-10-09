import { type ReactElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

// 액션이 셋 이상이면 가로로 나눌 수 없어 세로로 쌓는다. iOS 시스템 팝업과 같은 기준이다.
const HORIZONTAL_ACTION_LIMIT = 2;

export type DialogActionEmphasis = 'default' | 'primary' | 'destructive';

export interface DialogAction {
  label: string;
  onPress?: () => void;
  emphasis?: DialogActionEmphasis;
}

export interface DialogViewProps {
  title?: string;
  message?: string;
  content?: ReactNode;
  actions: DialogAction[];
  onActionPress: (action: DialogAction) => void;
}

export function DialogView({
  title,
  message,
  content,
  actions,
  onActionPress,
}: DialogViewProps): ReactElement {
  const styles = useStyles();
  const isStacked = actions.length > HORIZONTAL_ACTION_LIMIT;

  return (
    <View style={styles.card}>
      <View style={styles.body}>
        {title ? (
          <AppText accessibilityRole="header" style={styles.title} variant="title">
            {title}
          </AppText>
        ) : null}

        {message ? (
          <AppText color="textSecondary" style={styles.message} variant="body">
            {message}
          </AppText>
        ) : null}

        {content}
      </View>

      {actions.length > 0 ? (
        <View style={[styles.actions, isStacked ? styles.actionsStacked : styles.actionsRow]}>
          {actions.map((action, index) => (
            <Pressable
              accessibilityRole="button"
              key={action.label}
              onPress={() => onActionPress(action)}
              style={({ pressed }) => [
                styles.action,
                // 첫 액션 앞에는 이미 본문과의 구분선이 있다.
                index > 0 && (isStacked ? styles.actionDividerTop : styles.actionDividerLeft),
                pressed && styles.pressed,
              ]}
            >
              <AppText
                color={toActionColor(action.emphasis)}
                style={styles.actionLabel}
                variant="body"
              >
                {action.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function toActionColor(emphasis: DialogActionEmphasis = 'default') {
  if (emphasis === 'destructive') return 'recording' as const;

  if (emphasis === 'primary') return 'accent' as const;

  return 'textPrimary' as const;
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.sheet,
      overflow: 'hidden',
      width: '100%',
    },
    body: {
      gap: theme.spacing[2],
      padding: theme.spacing[5],
    },
    title: {
      fontWeight: theme.typography.fontWeight.semibold,
      textAlign: 'center',
    },
    message: {
      textAlign: 'center',
    },
    actions: {
      borderTopColor: theme.colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    actionsRow: {
      flexDirection: 'row',
    },
    actionsStacked: {
      flexDirection: 'column',
    },
    action: {
      alignItems: 'center',
      flexGrow: 1,
      flexShrink: 1,
      justifyContent: 'center',
      minHeight: 44,
      paddingHorizontal: theme.spacing[3],
    },
    actionDividerLeft: {
      borderLeftColor: theme.colors.border,
      borderLeftWidth: StyleSheet.hairlineWidth,
    },
    actionDividerTop: {
      borderTopColor: theme.colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    actionLabel: {
      textAlign: 'center',
    },
    pressed: {
      backgroundColor: theme.colors.surfacePressed,
    },
  }),
);
