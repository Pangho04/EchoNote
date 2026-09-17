import { type ReactElement, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { RecordingTitleEditor } from '@/features/record-meeting/ui/recording-title-editor';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

import type { ConfirmRecordingResult } from '../model/use-meeting-library-view-model';

export interface RecordingTitleFormProps {
  confirmRecordingTitle(title: string): Promise<ConfirmRecordingResult>;
  onGranted(meetingId: string): void;
  onCancel(): void;
  onOpenSettings(): void;
}

// 권한 안내는 이 폼이 소유한다. 팝업이 열린 뒤 바뀌는 값이라 바깥에서 내려주면 낡는다.
export function RecordingTitleForm({
  confirmRecordingTitle,
  onGranted,
  onCancel,
  onOpenSettings,
}: RecordingTitleFormProps): ReactElement {
  const styles = useStyles();

  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [isPermissionBlocked, setIsPermissionBlocked] = useState(false);

  // 권한 차단(재요청 불가)일 때만 시작을 막는다. 단순 거부는 다시 시도할 수 있어야 한다.
  const confirmDisabled = isPermissionBlocked || busy;

  async function handleConfirm() {
    setBusy(true);

    try {
      const result = await confirmRecordingTitle(title);

      if (result.kind === 'granted') {
        onGranted(result.meetingId);

        return;
      }

      if (result.kind === 'blocked') {
        setPermissionMessage(UI_STRINGS.meetingLibrary.permissionBlocked);
        setIsPermissionBlocked(true);

        return;
      }

      setPermissionMessage(UI_STRINGS.meetingLibrary.permissionDenied);
      setIsPermissionBlocked(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <RecordingTitleEditor autoFocus editable={!busy} onChangeText={setTitle} value={title} />

      {permissionMessage ? (
        <AppText color="warning" style={styles.permissionMessage} variant="body">
          {permissionMessage}
        </AppText>
      ) : null}

      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <AppText color="textPrimary" variant="body">
            {UI_STRINGS.common.cancel}
          </AppText>
        </Pressable>

        {isPermissionBlocked ? (
          <Pressable
            accessibilityRole="button"
            onPress={onOpenSettings}
            style={({ pressed }) => [styles.button, pressed && styles.pressed]}
          >
            <AppText color="accent" variant="body">
              {UI_STRINGS.meetingLibrary.openSettings}
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
              {UI_STRINGS.meetingLibrary.startRecording}
            </AppText>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    permissionMessage: {
      marginTop: theme.spacing[3],
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
      opacity: 0.4,
    },
    pressed: {
      opacity: 0.7,
    },
  }),
);
