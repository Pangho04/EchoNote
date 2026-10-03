import type { ReactElement } from 'react';
import { FlatList, Pressable, type StyleProp, StyleSheet, type ViewStyle } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

import type { TranscriptSegment } from '../model/transcription';

export interface TranscriptListProps {
  segments: TranscriptSegment[];
  onPressSegment(startMs: number): void;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

// 접근성 라벨은 m:ss, 화면 표시는 분을 두 자리로 채운 mm:ss다. 1시간 이상은 h:mm:ss.
function formatStartLabel(ms: number): string {
  const totalSeconds = Math.floor(ms / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');

  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`;

  return `${minutes}:${seconds}`;
}

export function TranscriptList({
  segments,
  onPressSegment,
  contentContainerStyle,
}: TranscriptListProps): ReactElement {
  const styles = useStyles();

  return (
    <FlatList
      contentContainerStyle={contentContainerStyle}
      data={segments}
      keyExtractor={(segment, index) => `${index}-${segment.startMs}`}
      renderItem={({ item }) => {
        const startLabel = formatStartLabel(item.startMs);

        return (
          <Pressable
            accessibilityLabel={`${startLabel}${UI_STRINGS.transcription.playFromSuffix}`}
            accessibilityRole="button"
            onPress={() => onPressSegment(item.startMs)}
            style={styles.row}
          >
            <AppText color="textTertiary" style={styles.timestamp} variant="caption">
              {startLabel.padStart(5, '0')}
            </AppText>

            <AppText style={styles.text} variant="reading">
              {item.text}
            </AppText>
          </Pressable>
        );
      }}
    />
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      gap: theme.spacing[3],
      marginBottom: theme.spacing[5],
    },
    timestamp: {
      fontSize: 10,
      fontVariant: ['tabular-nums'],
      paddingTop: 2,
      width: 48,
    },
    text: {
      flex: 1,
    },
  }),
);
