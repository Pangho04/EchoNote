import { render, screen } from '@testing-library/react-native';

import { MeetingLibraryPage } from './meeting-library-page';

describe('MeetingLibraryPage', () => {
  it('회의 목록 제목을 접근 가능한 헤더로 표시한다', async () => {
    await render(<MeetingLibraryPage />);

    expect(screen.getByRole('header', { name: '회의' })).toBeOnTheScreen();
  });
});
