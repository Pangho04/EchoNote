import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { ThemeProvider } from '@/shared/ui/theme-provider';

import { RenameMeetingEditor } from './rename-meeting-editor';

async function renderEditor(onSave: jest.Mock, props: { title?: string; disabled?: boolean } = {}) {
  return render(
    <ThemeProvider mode="light">
      <RenameMeetingEditor
        disabled={props.disabled ?? false}
        onSave={onSave}
        title={props.title ?? '제품 로드맵 정기 회의'}
      />
    </ThemeProvider>,
  );
}

describe('RenameMeetingEditor', () => {
  it('T-R1: 연필을 탭하면 현재 제목을 초안으로 하는 편집기가 열리고, 취소하면 DB를 바꾸지 않고 보기로 돌아간다', async () => {
    const onSave = jest.fn();
    const { getByLabelText, queryByLabelText } = await renderEditor(onSave);

    expect(getByLabelText('회의 제목 수정')).toBeTruthy();

    await fireEvent.press(getByLabelText('회의 제목 수정'));

    const input = getByLabelText('회의 제목 변경');

    expect(input.props.value).toBe('제품 로드맵 정기 회의');
    expect(queryByLabelText('회의 제목 수정')).toBeNull();

    await fireEvent.press(getByLabelText('취소'));

    expect(queryByLabelText('회의 제목 변경')).toBeNull();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('T-R2: 정규화 결과가 빈 값이거나 현재 제목과 같으면 저장이 disabled다', async () => {
    const onSave = jest.fn();
    const { getByLabelText } = await renderEditor(onSave);

    await fireEvent.press(getByLabelText('회의 제목 수정'));

    const input = getByLabelText('회의 제목 변경');
    const saveButton = getByLabelText('저장');

    await fireEvent.changeText(input, '   ');
    expect(saveButton.props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(input, '제품 로드맵 정기 회의');
    expect(saveButton.props.accessibilityState.disabled).toBe(true);

    await fireEvent.changeText(input, '새 제목');
    expect(saveButton.props.accessibilityState.disabled).toBe(false);
  });

  it('T-R3: 저장이 성공하면 saving을 거쳐 보기로 돌아간다', async () => {
    let resolveSave: () => void = () => {};
    const onSave = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const { getByLabelText, queryByLabelText } = await renderEditor(onSave);

    await fireEvent.press(getByLabelText('회의 제목 수정'));
    await fireEvent.changeText(getByLabelText('회의 제목 변경'), '새 제목');
    await fireEvent.press(getByLabelText('저장'));

    expect(onSave).toHaveBeenCalledWith('새 제목');
    expect(getByLabelText('저장').props.accessibilityState.busy).toBe(true);
    expect(getByLabelText('회의 제목 변경').props.editable).toBe(false);
    expect(getByLabelText('취소').props.accessibilityState.disabled).toBe(true);

    resolveSave();
    await waitFor(() => expect(queryByLabelText('회의 제목 변경')).toBeNull());
    expect(getByLabelText('회의 제목 수정')).toBeTruthy();
  });

  it('T-R4: 저장이 실패하면 오류 상태로 바뀌고 편집값을 유지하며, 취소하면 기존 제목으로 돌아간다', async () => {
    const onSave = jest.fn(() => Promise.reject(new Error('제목을 저장하지 못했습니다.')));
    const { getByLabelText, getByText, queryByLabelText } = await renderEditor(onSave);

    await fireEvent.press(getByLabelText('회의 제목 수정'));
    await fireEvent.changeText(getByLabelText('회의 제목 변경'), '새 제목');
    await fireEvent.press(getByLabelText('저장'));

    await waitFor(() => expect(getByText('제목을 저장하지 못했습니다.')).toBeTruthy());
    expect(getByLabelText('회의 제목 변경').props.value).toBe('새 제목');

    await fireEvent.press(getByLabelText('취소'));

    expect(queryByLabelText('회의 제목 변경')).toBeNull();
    expect(getByLabelText('회의 제목 수정')).toBeTruthy();
  });

  it('T-R5: saving 중에는 입력·취소·저장이 모두 disabled다', async () => {
    const onSave = jest.fn(() => new Promise<void>(() => {}));
    const { getByLabelText } = await renderEditor(onSave);

    await fireEvent.press(getByLabelText('회의 제목 수정'));
    await fireEvent.changeText(getByLabelText('회의 제목 변경'), '새 제목');
    await fireEvent.press(getByLabelText('저장'));

    expect(getByLabelText('회의 제목 변경').props.editable).toBe(false);
    expect(getByLabelText('취소').props.accessibilityState.disabled).toBe(true);
    expect(getByLabelText('저장').props.accessibilityState.disabled).toBe(true);
    expect(getByLabelText('저장').props.accessibilityState.busy).toBe(true);
  });

  it('연필 button은 disabled prop이 true면 접근성 disabled 상태로 눌러도 열리지 않는다', async () => {
    const onSave = jest.fn();
    const { getByLabelText, queryByLabelText } = await renderEditor(onSave, { disabled: true });

    expect(getByLabelText('회의 제목 수정').props.accessibilityState.disabled).toBe(true);

    await fireEvent.press(getByLabelText('회의 제목 수정'));

    expect(queryByLabelText('회의 제목 변경')).toBeNull();
  });
});
