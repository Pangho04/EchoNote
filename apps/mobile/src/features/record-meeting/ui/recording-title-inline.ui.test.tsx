import { fireEvent, render } from '@testing-library/react-native';

import { ThemeProvider } from '@/shared/ui/theme-provider';

import { RecordingTitleInline } from './recording-title-inline';

describe('RecordingTitleInline', () => {
  it('접근성 라벨로 입력을 찾을 수 있고 입력하면 onChangeText로 전달한다', async () => {
    const onChangeText = jest.fn();
    const { getByLabelText } = await render(
      <ThemeProvider mode="light">
        <RecordingTitleInline editable onChangeText={onChangeText} value="" />
      </ThemeProvider>,
    );

    await fireEvent.changeText(getByLabelText('녹음 제목'), '주간 회의');

    expect(onChangeText).toHaveBeenCalledWith('주간 회의');
  });
});
