import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles, useTheme } from '@/shared/ui/theme-provider';

const OPTION_HEIGHT = 44;
// 다음 항목을 반만 보여 아래로 더 스크롤할 수 있음을 알린다.
const VISIBLE_OPTION_COUNT = 3.5;

type FilterProps = {
  selectedYear: number;
  isOpen: boolean;
  disabled: boolean;
  onToggle: () => void;
};

// 화면 루트는 터치가 시작되면 메뉴를 닫는다. 필터와 메뉴 안의 터치는 루트까지 올려 보내지 않는다.
export function MeetingYearFilter({ selectedYear, isOpen, disabled, onToggle }: FilterProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const selectedYearLabel = `${selectedYear}${UI_STRINGS.meetingLibrary.yearSuffix}`;

  return (
    <View onTouchStart={(event) => event.stopPropagation()}>
      <Pressable
        accessibilityLabel={`${UI_STRINGS.meetingLibrary.yearFilterLabel} ${selectedYearLabel}`}
        accessibilityRole="button"
        accessibilityState={{ disabled, expanded: isOpen }}
        disabled={disabled}
        onPress={onToggle}
        style={styles.yearFilter}
      >
        <AppText color={disabled ? 'textTertiary' : 'accent'} style={styles.label} variant="body">
          {selectedYearLabel}
        </AppText>
        <Svg height={6} width={10}>
          <Path
            d="M1 1l4 4 4-4"
            fill="none"
            stroke={disabled ? colors.textTertiary : colors.accent}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
          />
        </Svg>
      </Pressable>
    </View>
  );
}

type MenuProps = {
  selectedYear: number;
  years: readonly number[];
  onSelectYear: (year: number) => void;
};

// 필터 버튼 안이 아니라 목록 위 겹침 영역에 그린다. Android는 부모 영역 밖으로 나온 뷰를 터치·접근성 대상에서 뺀다.
export function MeetingYearMenu({ selectedYear, years, onSelectYear }: MenuProps) {
  const styles = useStyles();

  return (
    <ScrollView
      accessibilityRole="menu"
      onTouchStart={(event) => event.stopPropagation()}
      style={styles.yearMenu}
      testID="meeting-year-menu"
    >
      {years.map((year) => (
        <Pressable
          accessibilityRole="menuitem"
          accessibilityState={{ selected: year === selectedYear }}
          key={year}
          onPress={() => onSelectYear(year)}
          style={styles.yearOption}
        >
          <AppText variant="body">{`${year}${UI_STRINGS.meetingLibrary.yearSuffix}`}</AppText>
        </Pressable>
      ))}
    </ScrollView>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    yearFilter: {
      flexDirection: 'row',
      gap: theme.spacing[1],
      minHeight: 44,
      minWidth: 64,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing[2],
    },
    label: {
      fontWeight: theme.typography.fontWeight.bold,
    },
    yearMenu: {
      minWidth: 96,
      maxHeight: OPTION_HEIGHT * VISIBLE_OPTION_COUNT,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.control,
      backgroundColor: theme.colors.surface,
      // Android는 zIndex만으로 아래 목록 위에 그려지지 않는다.
      elevation: 4,
    },
    yearOption: {
      minHeight: OPTION_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: theme.spacing[3],
    },
  }),
);
