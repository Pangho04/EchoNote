import { type ReactElement, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

import type { DatabaseFailureKind } from './database-failure';

export interface DatabaseRecoveryScreenProps {
  kind: DatabaseFailureKind;
  onReset(): Promise<void>;
  onRetry(): void;
}

// DB를 열지 못하면 어떤 화면도 그릴 수 없다. Provider 자리에서 이 화면만 대신 보여준다.
export function DatabaseRecoveryScreen({
  kind,
  onReset,
  onRetry,
}: DatabaseRecoveryScreenProps): ReactElement {
  const styles = useStyles();
  const [busy, setBusy] = useState(false);

  const { title, message } = toCopy(kind);

  // 앱보다 새 버전이 쓴 데이터는 지우면 되돌릴 수 없다. 초기화를 제안하지 않는다.
  const canReset = kind === 'corrupted';

  async function handleReset() {
    setBusy(true);

    try {
      await onReset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <AppText accessibilityRole="header" style={styles.title} variant="title">
        {title}
      </AppText>

      <AppText color="textSecondary" style={styles.message} variant="body">
        {message}
      </AppText>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={canReset ? handleReset : onRetry}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <AppText color="accent" variant="body">
          {canReset ? UI_STRINGS.database.reset : UI_STRINGS.common.retry}
        </AppText>
      </Pressable>
    </View>
  );
}

function toCopy(kind: DatabaseFailureKind): { title: string; message: string } {
  switch (kind) {
    case 'corrupted':
      return {
        title: UI_STRINGS.database.corruptedTitle,
        message: UI_STRINGS.database.corrupted,
      };

    case 'unsupported-version':
      return {
        title: UI_STRINGS.database.unsupportedVersionTitle,
        message: UI_STRINGS.database.unsupportedVersion,
      };

    case 'unknown':
      return {
        title: UI_STRINGS.database.unknownTitle,
        message: UI_STRINGS.database.unknown,
      };
  }
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      alignItems: 'center',
      backgroundColor: theme.colors.surface,
      flex: 1,
      gap: theme.spacing[3],
      justifyContent: 'center',
      paddingHorizontal: theme.spacing[6],
    },
    title: {
      fontWeight: theme.typography.fontWeight.semibold,
      textAlign: 'center',
    },
    message: {
      textAlign: 'center',
    },
    action: {
      marginTop: theme.spacing[3],
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing[4],
    },
    pressed: {
      backgroundColor: theme.colors.surfacePressed,
      borderRadius: theme.radii.control,
    },
  }),
);
