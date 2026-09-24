import { type ReactElement, type ReactNode, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import Swipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import type { MeetingListVMItem } from '@/entities/meeting';
import { MeetingListItem } from '@/entities/meeting';
import { palette } from '@/shared/config/theme';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles, useTheme } from '@/shared/ui/theme-provider';

type Props = {
  items: MeetingListVMItem[];
  onMeetingPress: (meetingId: string) => void;
  // 값이 있으면 선택 모드다. 행을 누르면 onMeetingPress 대신 선택을 토글한다.
  selectedIds?: ReadonlySet<string>;
  onToggleSelection?: (meetingId: string) => void;
  // 없으면 스와이프 삭제를 끈다.
  onMeetingDelete?: (meetingId: string) => void;
  // 섹션 라벨과 목록 사이에 그린다.
  toolbar?: ReactNode;
  onEndReached?: () => void;
};

export function MeetingList({
  items,
  onMeetingPress,
  selectedIds,
  onToggleSelection,
  onMeetingDelete,
  toolbar,
  onEndReached,
}: Props) {
  const styles = useStyle();
  const { colors } = useTheme();
  const scrollMetrics = useRef({ offsetY: 0, layoutHeight: 0, contentHeight: 0 });
  const openRow = useRef<SwipeableMethods | null>(null);
  const [hasMoreBelow, setHasMoreBelow] = useState(false);

  // 아래에 가려진 행이 있을 때만 fade를 보여 끝에 닿은 마지막 행을 가리지 않는다.
  const updateHasMoreBelow = (metrics: Partial<typeof scrollMetrics.current>) => {
    const next = { ...scrollMetrics.current, ...metrics };

    scrollMetrics.current = next;
    setHasMoreBelow(next.offsetY + next.layoutHeight < next.contentHeight - 1);
  };

  function renderItem(item: MeetingListVMItem): ReactElement {
    if (selectedIds) {
      return (
        <MeetingListItem
          item={item}
          onPress={(meetingId) => onToggleSelection?.(meetingId)}
          selected={selectedIds.has(item.id)}
        />
      );
    }

    if (!onMeetingDelete) return <MeetingListItem item={item} onPress={onMeetingPress} />;

    return (
      <SwipeableMeetingRow
        item={item}
        onMeetingDelete={onMeetingDelete}
        onMeetingPress={onMeetingPress}
        onWillOpen={(row) => {
          // 한 번에 한 행만 열어 둔다.
          if (openRow.current !== row) openRow.current?.close();

          openRow.current = row;
        }}
      />
    );
  }

  return (
    <View style={styles.container}>
      <AppText color="textSecondary" style={styles.sectionLabel} variant="caption">
        {UI_STRINGS.meetingLibrary.recentSection}
      </AppText>

      {toolbar}

      <View style={styles.listFrame}>
        <FlatList
          style={styles.list}
          data={items}
          // 선택이 바뀌면 행을 다시 그린다.
          extraData={selectedIds}
          renderItem={({ item }) => renderItem(item)}
          keyExtractor={(item) => item.id}
          onEndReached={onEndReached}
          onEndReachedThreshold={0.5}
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

type SwipeableMeetingRowProps = {
  item: MeetingListVMItem;
  onMeetingPress: (meetingId: string) => void;
  onMeetingDelete: (meetingId: string) => void;
  onWillOpen: (row: SwipeableMethods | null) => void;
};

function SwipeableMeetingRow({
  item,
  onMeetingPress,
  onMeetingDelete,
  onWillOpen,
}: SwipeableMeetingRowProps) {
  const styles = useStyle();
  const methods = useRef<SwipeableMethods | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Swipeable
      ref={methods}
      friction={2}
      overshootRight={false}
      rightThreshold={40}
      onSwipeableWillOpen={() => onWillOpen(methods.current)}
      onSwipeableOpen={() => setIsOpen(true)}
      onSwipeableClose={() => setIsOpen(false)}
      renderRightActions={(_progress, _translation, swipeable) => (
        // 닫힌 행 뒤에도 렌더되므로 열렸을 때만 접근성 트리에 둔다. 닫힌 행은 행의 삭제 동작이 맡는다.
        <Pressable
          accessibilityElementsHidden={!isOpen}
          accessibilityRole="button"
          importantForAccessibility={isOpen ? 'auto' : 'no-hide-descendants'}
          onPress={() => {
            swipeable.close();
            onMeetingDelete(item.id);
          }}
          style={styles.deleteAction}
        >
          <AppText style={styles.deleteActionLabel} variant="body">
            {UI_STRINGS.meetingLibrary.delete}
          </AppText>
        </Pressable>
      )}
    >
      <MeetingListItem item={item} onDelete={onMeetingDelete} onPress={onMeetingPress} />
    </Swipeable>
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
    deleteAction: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 80,
      backgroundColor: theme.colors.recording,
    },
    deleteActionLabel: {
      color: palette.white,
      fontWeight: theme.typography.fontWeight.semibold,
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
