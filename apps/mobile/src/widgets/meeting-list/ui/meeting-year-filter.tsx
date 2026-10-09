import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { DropdownMenu } from '@/shared/ui/dropdown-menu';
import { createThemedStyles, useTheme } from '@/shared/ui/theme-provider';

type Props = {
  selectedYear: number;
  years: readonly number[];
  disabled: boolean;
  onSelectYear: (year: number) => void;
};

export function MeetingYearFilter({ selectedYear, years, disabled, onSelectYear }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const selectedYearLabel = `${selectedYear}${UI_STRINGS.meetingLibrary.yearSuffix}`;

  return (
    <DropdownMenu
      accessibilityLabel={`${UI_STRINGS.meetingLibrary.yearFilterLabel} ${selectedYearLabel}`}
      disabled={disabled}
      onSelect={(id) => onSelectYear(Number(id))}
      options={years.map((year) => ({
        id: String(year),
        label: `${year}${UI_STRINGS.meetingLibrary.yearSuffix}`,
        selected: year === selectedYear,
      }))}
    >
      {({ pressed }) => (
        <View style={[styles.yearFilter, pressed && styles.yearFilterPressed]}>
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
        </View>
      )}
    </DropdownMenu>
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
    yearFilterPressed: {
      backgroundColor: theme.colors.surfacePressed,
      borderRadius: theme.radii.control,
    },
    label: {
      fontWeight: theme.typography.fontWeight.bold,
    },
  }),
);
