import { act, fireEvent, render } from '@testing-library/react-native';
import type React from 'react';
import { BackHandler } from 'react-native';

import { ThemeProvider } from '@/shared/ui/theme-provider';

import { CreateMeetingFab } from './create-meeting-fab';

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof React>('react');

  return {
    useFocusEffect: (callback: () => void | (() => void)) => useEffect(callback, [callback]),
  };
});

const onRecord = jest.fn();
const onUpload = jest.fn();

async function renderFab(disabled = false) {
  return render(
    <ThemeProvider mode="light">
      <CreateMeetingFab disabled={disabled} onRecord={onRecord} onUpload={onUpload} />
    </ThemeProvider>,
  );
}

async function renderOpenFab() {
  const view = await renderFab();

  await fireEvent.press(view.getByLabelText('메뉴 열기'));

  return view;
}

describe('CreateMeetingFab', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('닫힘 상태는 「메뉴 열기」 라벨만 보이고 메뉴 항목은 없다', async () => {
    const { getByLabelText, queryByText } = await renderFab();

    expect(getByLabelText('메뉴 열기')).toBeOnTheScreen();
    expect(queryByText('녹음하기')).toBeNull();
    expect(queryByText('업로드')).toBeNull();
  });

  it('탭하면 「메뉴 닫기」 라벨과 메뉴 항목을 보여 주고, 다시 탭하면 닫는다', async () => {
    const { getByLabelText, getByText, queryByText } = await renderOpenFab();

    expect(getByText('녹음하기')).toBeOnTheScreen();
    expect(getByText('업로드')).toBeOnTheScreen();

    await fireEvent.press(getByLabelText('메뉴 닫기'));

    expect(queryByText('녹음하기')).toBeNull();
  });

  it('녹음하기를 탭하면 메뉴를 닫고 onRecord를 부른다', async () => {
    const { getByText, queryByText } = await renderOpenFab();

    await fireEvent.press(getByText('녹음하기'));

    expect(onRecord).toHaveBeenCalledTimes(1);
    expect(queryByText('녹음하기')).toBeNull();
  });

  it('업로드를 탭하면 메뉴를 닫고 onUpload를 부른다', async () => {
    const { getByText, queryByText } = await renderOpenFab();

    await fireEvent.press(getByText('업로드'));

    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(queryByText('업로드')).toBeNull();
  });

  it('열린 동안 Android 뒤로 가기는 메뉴만 닫고 이벤트를 소비한다', async () => {
    const addListener = jest.spyOn(BackHandler, 'addEventListener');
    const { queryByText } = await renderOpenFab();
    const handler = addListener.mock.calls.at(-1)?.[1];

    await act(async () => {
      expect(handler?.({ type: 'hardwareBackPress', timeStamp: 0 })).toBe(true);
    });

    expect(queryByText('녹음하기')).toBeNull();
    addListener.mockRestore();
  });

  it('disabled면 탭해도 열리지 않고 accessibilityState에 disabled를 전달한다', async () => {
    const { getByLabelText, queryByText } = await renderFab(true);

    const fab = getByLabelText('메뉴 열기');
    await fireEvent.press(fab);

    expect(queryByText('녹음하기')).toBeNull();
    expect(fab.props.accessibilityState).toEqual({ disabled: true });
  });
});
