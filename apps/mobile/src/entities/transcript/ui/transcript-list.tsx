import type { ReactElement } from 'react';
import { FlatList, Pressable, type StyleProp, StyleSheet, type ViewStyle } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { formatStartLabel } from '@/shared/lib/format-start-label';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

import { findActiveSegmentIndex, type TranscriptSegment } from '../model/transcription';

export interface TranscriptListProps {
  segments: TranscriptSegment[];
  positionMs: number;
  onPressSegment(startMs: number): void;
  contentContainerStyle?: StyleProp<ViewStyle>;
}

export function TranscriptList({
  segments,
  positionMs,
  onPressSegment,
  contentContainerStyle,
}: TranscriptListProps): ReactElement {
  const styles = useStyles();
  const activeIndex = findActiveSegmentIndex(segments, positionMs);

  return (
    <FlatList
      contentContainerStyle={contentContainerStyle}
      data={segments}
      extraData={activeIndex}
      keyExtractor={(segment, index) => `${index}-${segment.startMs}`}
      renderItem={({ item, index }) => {
        const startLabel = formatStartLabel(item.startMs);

        return (
          <Pressable
            accessibilityLabel={`${startLabel}${UI_STRINGS.transcription.playFromSuffix}`}
            accessibilityRole="button"
            onPress={() => onPressSegment(item.startMs)}
            style={styles.row}
          >
            {/* 접근성 라벨은 m:ss, 화면 표시는 분을 두 자리로 채운 mm:ss다. */}
            <AppText color="textTertiary" style={styles.timestamp} variant="caption">
              {startLabel.padStart(5, '0')}
            </AppText>

            {/* 재생 중인 문장만 진하게 그려 나머지 문장도 눌러서 이동할 수 있음을 드러낸다. */}
            <AppText
              color={index === activeIndex ? 'textPrimary' : 'textTertiary'}
              style={styles.text}
              variant="reading"
            >
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
