import { useFocusEffect } from 'expo-router';
import { Mic, Plus, Upload } from 'lucide-react-native';
import { type ReactElement, useCallback, useEffect, useState } from 'react';
import { Animated, BackHandler, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg';

import { palette } from '@/shared/config/theme';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles, useTheme } from '@/shared/ui/theme-provider';

type Props = {
  disabled: boolean;
  onRecord(): void;
  onUpload(): void;
};

// 열림 상태를 page가 아닌 이 컴포넌트가 가져, 메뉴를 여닫을 때 목록 전체가 다시 그려지지 않는다.
export function CreateMeetingFab(props: Props): ReactElement {
  const { disabled, onRecord, onUpload } = props;
  const styles = useStyles();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [rotation] = useState(() => new Animated.Value(0));

  /**
   * @when 메뉴가 열린 화면에서 Android 뒤로 가기를 눌렀을 때
   * @expect 화면을 떠나지 않고 메뉴만 닫는다.
   * @clear 화면을 벗어나거나 메뉴가 닫히면 뒤로 가기 가로채기를 해제한다.
   */
  useFocusEffect(
    useCallback(() => {
      if (!open) return;

      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        setOpen(false);

        return true;
      });

      return () => subscription.remove();
    }, [open]),
  );

  /**
   * @when open이 바뀔 때마다
   * @expect 아이콘을 열림 -45deg, 닫힘 0deg로 150ms 애니메이션한다
   * @clear 다음 변경이 오면 진행 중인 애니메이션을 교체한다(Animated.timing이 자체 처리)
   */
  useEffect(() => {
    Animated.timing(rotation, {
      duration: 150,
      toValue: open ? 1 : 0,
      useNativeDriver: true,
    }).start();
  }, [open, rotation]);

  const rotate = rotation.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-45deg'] });

  return (
    <>
      {open && (
        <Pressable
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          onPress={() => setOpen(false)}
          style={StyleSheet.absoluteFill}
        />
      )}

      <View style={styles.position}>
        {open ? (
          <View style={styles.menu}>
            <Pressable
              accessibilityLabel={UI_STRINGS.meetingLibrary.menuRecord}
              accessibilityRole="button"
              onPress={() => {
                setOpen(false);
                onRecord();
              }}
              style={styles.item}
            >
              <Mic color={colors.accent} size={16} />
              <AppText style={styles.itemText} variant="body">
                {UI_STRINGS.meetingLibrary.menuRecord}
              </AppText>
            </Pressable>
            <Pressable
              accessibilityLabel={UI_STRINGS.meetingLibrary.menuUpload}
              accessibilityRole="button"
              onPress={() => {
                setOpen(false);
                onUpload();
              }}
              style={styles.item}
            >
              <Upload color={colors.accent} size={16} />
              <AppText style={styles.itemText} variant="body">
                {UI_STRINGS.meetingLibrary.menuUpload}
              </AppText>
            </Pressable>
          </View>
        ) : null}
        <Pressable
          accessibilityLabel={
            open
              ? UI_STRINGS.meetingLibrary.createMenuClose
              : UI_STRINGS.meetingLibrary.createMenuOpen
          }
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => setOpen((current) => !current)}
          style={({ pressed }) => [
            styles.button,
            disabled && styles.buttonDisabled,
            pressed && styles.buttonPressed,
          ]}
        >
          <Svg height={61} pointerEvents="none" style={styles.piece} width={58}>
            <Defs>
              <LinearGradient id="createMeetingFabBorder" x1="1" x2="0" y1="0" y2="1">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.4} />
                <Stop offset="1" stopColor="#000000" stopOpacity={0.3} />
              </LinearGradient>
            </Defs>
            {/* 두께 */}
            <Circle cx={29} cy={32} fill={colors.accent} r={29} />
            <Circle cx={29} cy={32} fill="#000000" fillOpacity={0.4} r={29} />
            {/* 테두리 */}
            <Circle cx={29} cy={29} fill={colors.accent} r={29} />
            <Circle cx={29} cy={29} fill="url(#createMeetingFabBorder)" r={29} />
            {/* 가운데 면 */}
            <Circle cx={29} cy={29} fill={colors.accent} r={25} />
          </Svg>
          <Animated.View style={{ transform: [{ rotate }] }}>
            <Plus color={palette.white} size={24} />
          </Animated.View>
        </Pressable>
      </View>
    </>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    position: {
      alignItems: 'flex-end',
      bottom: theme.spacing[6],
      position: 'absolute',
      right: 18,
    },
    button: {
      alignItems: 'center',
      borderRadius: 29,
      elevation: 6,
      height: 58,
      justifyContent: 'center',
      shadowColor: theme.colors.accent,
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.35,
      shadowRadius: 7,
      width: 58,
    },
    buttonDisabled: {
      opacity: 0.4,
    },
    buttonPressed: {
      transform: [{ scale: 0.94 }],
    },
    piece: {
      left: 0,
      position: 'absolute',
      top: 0,
    },
    menu: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      elevation: 8,
      // absolute로 FAB 밖에 띄우면 Android가 부모 경계 밖 터치를 받지 않아 흐름 배치로 쌓는다.
      marginBottom: theme.spacing[3],
      minWidth: 152,
      paddingVertical: theme.spacing[1],
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: 0.12,
      shadowRadius: 9,
    },
    item: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: theme.spacing[2],
      minHeight: 44,
      paddingHorizontal: theme.spacing[4],
    },
    itemText: {
      fontWeight: theme.typography.fontWeight.semibold,
    },
  }),
);
