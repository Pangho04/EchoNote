import { useMemo, useState } from 'react';
import {
  Animated,
  Keyboard,
  type LayoutChangeEvent,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { useKeyboardAnimation } from 'react-native-keyboard-controller';

import { RecordingTitleEditor } from '@/features/record-meeting/ui/recording-title-editor';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

// 키보드 위로 남길 최소 간격.
const KEYBOARD_GAP = 24;

// interpolate 입력 범위의 상한. 어떤 기기 키보드도 넘지 않는 값이면 된다.
const MAX_KEYBOARD_HEIGHT = 1000;

export interface RecordingTitleDialogProps {
  onCancel(): void;
  onConfirm(title: string): Promise<void>;
  permissionMessage: string | null;
  canOpenSettings: boolean;
  onOpenSettings(): void;
}

export function RecordingTitleDialog({
  onCancel,
  onConfirm,
  permissionMessage,
  canOpenSettings,
  onOpenSettings,
}: RecordingTitleDialogProps) {
  const styles = useStyles();
  const { height: keyboardOffset } = useKeyboardAnimation();

  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [backdropHeight, setBackdropHeight] = useState(0);
  const [cardHeight, setCardHeight] = useState(0);

  // 카드를 중앙에 뒀을 때 카드 아래에 남는 여유. 키보드가 이보다 높을 때만 그 차이만큼 올린다.
  // 중앙 정렬을 유지한 채 가리는 만큼만 보정하므로, 키보드를 닫으면 다시 정중앙으로 돌아온다.
  const slack = Math.max(1, (backdropHeight - cardHeight) / 2 - KEYBOARD_GAP);

  // keyboardOffset은 0(닫힘) ~ -키보드높이(열림)로 움직인다.
  const translateY = useMemo(
    () =>
      keyboardOffset.interpolate({
        inputRange: [-MAX_KEYBOARD_HEIGHT, -slack, 0],
        outputRange: [slack - MAX_KEYBOARD_HEIGHT, 0, 0],
        extrapolate: 'clamp',
      }),
    [keyboardOffset, slack],
  );

  function handleBackdropLayout(event: LayoutChangeEvent) {
    setBackdropHeight(event.nativeEvent.layout.height);
  }

  function handleCardLayout(event: LayoutChangeEvent) {
    setCardHeight(event.nativeEvent.layout.height);
  }

  // 권한 차단(재요청 불가)일 때만 시작을 막는다. 단순 거부는 다시 시도할 수 있어야 한다.
  const confirmDisabled = canOpenSettings || busy;

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
      {/* ponytail: 카드가 키보드를 뺀 잔여 높이를 넘으면 잘린다. 내용이 늘면 카드 안을 ScrollView로 감싼다. */}
      <View
        onLayout={handleBackdropLayout}
        // 카드 바깥을 누르면 키보드를 닫는다. responder를 가져가지 않으므로 안쪽 터치는 그대로 동작한다.
        onStartShouldSetResponder={() => {
          Keyboard.dismiss();

          return false;
        }}
        style={styles.backdrop}
      >
        <Animated.View
          onLayout={handleCardLayout}
          // 카드 안 여백 터치가 backdrop까지 내려가지 않게 막는다.
          onStartShouldSetResponder={() => true}
          style={[styles.card, { transform: [{ translateY }] }]}
        >
          <AppText variant="title" color="textPrimary" accessibilityRole="header">
            새 회의 녹음
          </AppText>

          <View style={styles.field}>
            <RecordingTitleEditor
              autoFocus
              editable={!busy}
              onChangeText={setTitle}
              value={title}
            />
          </View>

          {permissionMessage ? (
            <AppText color="warning" variant="body">
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
                취소
              </AppText>
            </Pressable>

            {canOpenSettings ? (
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
        </Animated.View>
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
    field: {
      marginTop: theme.spacing[4],
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
