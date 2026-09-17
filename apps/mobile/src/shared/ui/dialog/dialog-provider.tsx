import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';
import { Animated, Keyboard, type LayoutChangeEvent, Modal, StyleSheet, View } from 'react-native';
import { useKeyboardAnimation } from 'react-native-keyboard-controller';

import { createThemedStyles } from '@/shared/ui/theme-provider';

import { type DialogAction, DialogView } from './dialog-view';

// 키보드 위로 남길 최소 간격.
const KEYBOARD_GAP = 24;

// interpolate 입력 범위의 상한. 어떤 기기 키보드도 넘지 않는 값이면 된다.
const MAX_KEYBOARD_HEIGHT = 1000;

export interface DialogOptions {
  title?: string;
  message?: string;
  // 폼처럼 자체 상태가 필요한 팝업은 컴포넌트를 그대로 넘긴다.
  content?: ReactNode;
  actions?: DialogAction[];
  // 바깥 탭·Android 뒤로가기로 닫을 수 있는지. 닫히면 onDismiss가 온다.
  dismissible?: boolean;
  onDismiss?: () => void;
  avoidKeyboard?: boolean;
}

type DialogContextValue = {
  openDialog: (options: DialogOptions) => void;
  closeDialog: () => void;
};

const DialogContext = createContext<DialogContextValue | null>(null);

export function DialogProvider({ children }: PropsWithChildren): ReactElement {
  const styles = useStyles();
  const [dialog, setDialog] = useState<DialogOptions | null>(null);

  const { height: keyboardOffset } = useKeyboardAnimation();

  const [backdropHeight, setBackdropHeight] = useState(0);
  const [cardHeight, setCardHeight] = useState(0);

  const openDialog = useCallback((options: DialogOptions) => {
    setDialog(options);
  }, []);

  const closeDialog = useCallback(() => {
    setDialog(null);
  }, []);

  // 카드를 중앙에 뒀을 때 카드 아래에 남는 여유. 키보드가 이보다 높을 때만 그 차이만큼 올린다.
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

  const value = useMemo(() => ({ openDialog, closeDialog }), [closeDialog, openDialog]);

  function handleDismiss() {
    if (dialog?.dismissible === false) return;

    closeDialog();
    dialog?.onDismiss?.();
  }

  function handleActionPress(action: DialogAction) {
    closeDialog();
    action.onPress?.();
  }

  function handleBackdropLayout(event: LayoutChangeEvent) {
    setBackdropHeight(event.nativeEvent.layout.height);
  }

  function handleCardLayout(event: LayoutChangeEvent) {
    setCardHeight(event.nativeEvent.layout.height);
  }

  return (
    <DialogContext.Provider value={value}>
      {children}

      {dialog ? (
        <Modal animationType="fade" onRequestClose={handleDismiss} transparent visible>
          <View
            onLayout={handleBackdropLayout}
            // 카드 바깥을 누르면 키보드를 닫고 dismiss를 시도한다.
            // responder를 가져가지 않으므로 안쪽 터치는 그대로 동작한다.
            onStartShouldSetResponder={() => {
              Keyboard.dismiss();
              handleDismiss();

              return false;
            }}
            style={styles.backdrop}
          >
            <Animated.View
              onLayout={handleCardLayout}
              // 카드 안 여백 터치가 backdrop까지 내려가지 않게 막는다.
              onStartShouldSetResponder={() => true}
              style={dialog.avoidKeyboard ? { transform: [{ translateY }] } : undefined}
            >
              <DialogView
                actions={dialog.actions ?? []}
                content={dialog.content}
                message={dialog.message}
                onActionPress={handleActionPress}
                title={dialog.title}
              />
            </Animated.View>
          </View>
        </Modal>
      ) : null}
    </DialogContext.Provider>
  );
}

export function useDialog(): DialogContextValue {
  const value = useContext(DialogContext);

  if (!value) {
    throw new Error('useDialog는 DialogProvider 내부에서 사용해야 합니다.');
  }

  return value;
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    backdrop: {
      backgroundColor: 'rgba(0,0,0,0.4)',
      flex: 1,
      justifyContent: 'center',
      paddingHorizontal: theme.spacing[6],
    },
  }),
);
