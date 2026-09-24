import { fireEvent, render, screen } from '@testing-library/react-native';

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
});
