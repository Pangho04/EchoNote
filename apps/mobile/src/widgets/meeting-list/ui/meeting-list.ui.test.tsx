import { fireEvent, render, screen } from '@testing-library/react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { MeetingStatus, toMeetingListItemVM } from '@/entities/meeting';
import { ThemeProvider } from '@/shared/ui/theme-provider';

import { MeetingList } from './meeting-list';

const LIST_HEIGHT = 300;

async function renderList() {
  await render(
    <ThemeProvider mode="light">
      <MeetingList items={[]} onMeetingPress={jest.fn()} />
    </ThemeProvider>,
  );

  const list = screen.getByTestId('meeting-list');

  await fireEvent(list, 'layout', { nativeEvent: { layout: { height: LIST_HEIGHT } } });

  return list;
}

function queryFade() {
  return screen.queryByTestId('meeting-list-fade', { includeHiddenElements: true });
}

describe('MeetingList', () => {
  it('목록이 화면보다 짧으면 fade를 보이지 않는다', async () => {
    const list = await renderList();

    await fireEvent(list, 'contentSizeChange', 0, LIST_HEIGHT);

    expect(queryFade()).toBeNull();
  });

  it('아래에 가려진 행이 있으면 fade를 보이고 끝까지 내리면 숨긴다', async () => {
    const list = await renderList();

    await fireEvent(list, 'contentSizeChange', 0, LIST_HEIGHT * 2);

    expect(queryFade()).not.toBeNull();

    await fireEvent.scroll(list, { nativeEvent: { contentOffset: { y: LIST_HEIGHT } } });

    expect(queryFade()).toBeNull();
  });

  describe('삭제와 선택', () => {
    const item = toMeetingListItemVM(
      {
        id: 'm1',
        title: '제품 회의',
        status: MeetingStatus.LocalOnly,
        createdAt: '2026-08-04T01:00:00.000Z',
        updatedAt: '2026-08-04T01:00:00.000Z',
        durationMs: null,
      },
      'Asia/Seoul',
    );

    it('스크린 리더의 삭제 동작으로 그 회의 삭제를 요청한다', async () => {
      const onMeetingDelete = jest.fn();

      await render(
        <GestureHandlerRootView>
          <ThemeProvider mode="light">
            <MeetingList
              items={[item]}
              onMeetingDelete={onMeetingDelete}
              onMeetingPress={jest.fn()}
            />
          </ThemeProvider>
        </GestureHandlerRootView>,
      );

      // 닫힌 행 뒤의 스와이프 삭제 버튼은 스크린 리더에 노출하지 않는다.
      expect(screen.queryByRole('button', { name: '삭제' })).toBeNull();

      // 스와이프 제스처는 jest에서 재현하지 않는다. 실기기 E2E가 덮는다.
      await fireEvent(screen.getByRole('button', { name: /제품 회의/ }), 'accessibilityAction', {
        nativeEvent: { actionName: 'delete' },
      });

      expect(onMeetingDelete).toHaveBeenCalledWith('m1');
    });

    it('선택 모드에서 행을 누르면 이동하지 않고 선택을 토글한다', async () => {
      const onMeetingPress = jest.fn();
      const onToggleSelection = jest.fn();

      await render(
        <ThemeProvider mode="light">
          <MeetingList
            items={[item]}
            onMeetingPress={onMeetingPress}
            onToggleSelection={onToggleSelection}
            selectedIds={new Set(['m1'])}
          />
        </ThemeProvider>,
      );

      expect(screen.getByRole('checkbox')).toBeChecked();

      await fireEvent.press(screen.getByRole('checkbox'));

      expect(onToggleSelection).toHaveBeenCalledWith('m1');
      expect(onMeetingPress).not.toHaveBeenCalled();
    });

    it('선택 모드에서 onToggleSelection이 undefined면 행이 checked 상태 유지하고 비활성화된다', async () => {
      await render(
        <ThemeProvider mode="light">
          <MeetingList items={[item]} onMeetingPress={jest.fn()} selectedIds={new Set(['m1'])} />
        </ThemeProvider>,
      );

      const checkbox = screen.getByRole('checkbox');

      expect(checkbox).toBeChecked();
      expect(checkbox).toBeDisabled();
    });
  });
});
