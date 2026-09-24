import { useRef, useState } from 'react';
import { FlatList, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { MeetingListVMItem } from '@/entities/meeting';
import { MeetingListItem } from '@/entities/meeting';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles, useTheme } from '@/shared/ui/theme-provider';

type Props = {
  items: MeetingListVMItem[];
  onMeetingPress: (meetingId: string) => void;
};

export function MeetingList({ items, onMeetingPress }: Props) {
  const styles = useStyle();
  const { colors } = useTheme();
  const scrollMetrics = useRef({ offsetY: 0, layoutHeight: 0, contentHeight: 0 });
  const [hasMoreBelow, setHasMoreBelow] = useState(false);

  // 아래에 가려진 행이 있을 때만 fade를 보여 끝에 닿은 마지막 행을 가리지 않는다.
  const updateHasMoreBelow = (metrics: Partial<typeof scrollMetrics.current>) => {
    const next = { ...scrollMetrics.current, ...metrics };

    scrollMetrics.current = next;
    setHasMoreBelow(next.offsetY + next.layoutHeight < next.contentHeight - 1);
  };

  return (
    <View style={styles.container}>
      <AppText color="textSecondary" style={styles.sectionLabel} variant="caption">
        최근 기록
      </AppText>
      <View style={styles.listFrame}>
        <FlatList
          style={styles.list}
          data={items}
          renderItem={({ item }) => <MeetingListItem item={item} onPress={onMeetingPress} />}
          keyExtractor={(item) => item.id}
          onContentSizeChange={(_, contentHeight) => updateHasMoreBelow({ contentHeight })}
          onLayout={(event) =>
            updateHasMoreBelow({ layoutHeight: event.nativeEvent.layout.height })
          }
          // Android stretch overscroll은 콘텐츠를 목록 밖까지 늘려 고정된 fade 아래로 행이 비친다.
          overScrollMode="never"
          onScroll={(event) => updateHasMoreBelow({ offsetY: event.nativeEvent.contentOffset.y })}
          scrollEventThrottle={16}
          testID="meeting-list"
        />
        {hasMoreBelow ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={styles.listFade}
            testID="meeting-list-fade"
          >
            <Svg height="100%" width="100%">
              <Defs>
                <LinearGradient id="meetingListFade" x1="0" x2="0" y1="0" y2="1">
                  <Stop offset="0" stopColor={colors.surface} stopOpacity={0.38} />
                  <Stop offset="0.8" stopColor={colors.surface} stopOpacity={1} />
                </LinearGradient>
              </Defs>
              <Rect fill="url(#meetingListFade)" height="100%" width="100%" />
            </Svg>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const useStyle = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    sectionLabel: {
      marginTop: theme.spacing[6],
      marginHorizontal: 18,
      marginBottom: theme.spacing[2],
      fontWeight: theme.typography.fontWeight.bold,
    },
    listFrame: {
      flex: 1,
      position: 'relative',
    },
    list: {
      flex: 1,
      borderTopColor: theme.colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    listFade: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: StyleSheet.hairlineWidth,
      height: theme.spacing[8] * 2,
      pointerEvents: 'none',
    },
  }),
);
