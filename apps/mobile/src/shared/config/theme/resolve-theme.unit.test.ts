import { describe, expect, it } from 'vitest';

import { resolveTheme } from './resolve-theme';

describe('resolveTheme', () => {
  it('시스템 색상 모드가 dark이면 다크 테마를 반환한다', () => {
    const theme = resolveTheme('dark');

    expect(theme.mode).toBe('dark');
    expect(theme.colors.background).toBe('#000000');
    expect(theme.colors.textPrimary).toBe('#F5F5F7');
  });

  it('시스템 색상 모드가 light이면 라이트 테마를 반환한다', () => {
    const theme = resolveTheme('light');

    expect(theme.mode).toBe('light');
    expect(theme.colors.background).toBe('#F2F2F7');
    expect(theme.colors.textPrimary).toBe('#161617');
  });

  it('시스템 색상 모드를 확인할 수 없으면 라이트 테마를 사용한다', () => {
    expect(resolveTheme(null).mode).toBe('light');
  });
});
