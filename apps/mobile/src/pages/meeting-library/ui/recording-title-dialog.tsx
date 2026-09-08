import { useState } from 'react';
import { Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface RecordingTitleDialogProps {
  onCancel(): void;
  onConfirm(title: string): Promise<void>;
  blockedMessage: string | null;
  onOpenSettings(): void;
}

export function RecordingTitleDialog({
  onCancel,
  onConfirm,
  blockedMessage,
  onOpenSettings,
}: RecordingTitleDialogProps) {
  const styles = useStyles();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);

  const confirmDisabled = blockedMessage !== null || busy;

  async function handleConfirm() {
    setBusy(true);

    try {
      await onConfirm(title);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <AppText variant="title" color="textPrimary" accessibilityRole="header">
            새 회의 녹음
          </AppText>

          <TextInput
            autoFocus
            editable={!busy}
            onChangeText={setTitle}
            placeholder="기본 이름으로 저장"
            style={styles.input}
            value={title}
          />

          {blockedMessage ? (
            <AppText color="warning" variant="body">
              {blockedMessage}
            </AppText>
          ) : null}

          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              onPress={onCancel}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            >
              <AppText color="textPrimary" variant="body">
                취소
              </AppText>
            </Pressable>

            {blockedMessage ? (
              <Pressable
                accessibilityRole="button"
                onPress={onOpenSettings}
                style={({ pressed }) => [styles.button, pressed && styles.pressed]}
              >
                <AppText color="accent" variant="body">
                  설정 열기
                </AppText>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: confirmDisabled }}
                disabled={confirmDisabled}
                onPress={handleConfirm}
                style={({ pressed }) => [
                  styles.button,
                  confirmDisabled && styles.disabled,
                  pressed && styles.pressed,
                ]}
              >
                <AppText color="accent" variant="body">
                  녹음 시작
                </AppText>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    backdrop: {
      backgroundColor: 'rgba(0,0,0,0.4)',
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing[4],
    },
    card: {
      backgroundColor: theme.colors.surface,
      borderRadius: theme.radii.item,
      padding: theme.spacing[5],
    },
    input: {
      borderColor: theme.colors.border,
      borderRadius: theme.radii.item,
      borderWidth: StyleSheet.hairlineWidth,
      marginTop: theme.spacing[4],
      padding: theme.spacing[3],
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      marginTop: theme.spacing[4],
    },
    button: {
      marginLeft: theme.spacing[3],
      padding: theme.spacing[2],
    },
    disabled: {
      opacity: 0.5,
    },
    pressed: {
      opacity: 0.7,
    },
  }),
);
