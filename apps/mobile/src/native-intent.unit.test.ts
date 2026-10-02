import { beforeEach, describe, expect, it, vi } from 'vitest';

import { redirectSystemPath } from './app/+native-intent';

const held = vi.hoisted(() => ({ value: false }));

vi.mock('@/features/authenticate', () => ({ isRecordingScreenHeld: () => held.value }));

describe('redirectSystemPath', () => {
  beforeEach(() => {
    held.value = false;
  });

  it('녹음 화면 유지 중 앱 실행 중에 들어온 링크는 무시한다', () => {
    held.value = true;

    expect(redirectSystemPath({ path: '/meetings/m-1', initial: false })).toBeNull();
    expect(redirectSystemPath({ path: 'echonote://missing', initial: false })).toBeNull();
  });

  it('유지 중이 아니거나 앱을 여는 링크면 경로를 그대로 돌려준다', () => {
    expect(redirectSystemPath({ path: '/meetings/m-1', initial: false })).toBe('/meetings/m-1');

    held.value = true;

    expect(redirectSystemPath({ path: '/meetings/m-1', initial: true })).toBe('/meetings/m-1');
  });

  it.each([
    '/',
    '/meetings/m-1',
    '/recording?meetingId=m-1',
    '/sign-in',
    'echonote://meetings/m-1',
    'echonote:///sign-in/',
    'exp+echonote://expo-development-client/?url=x',
    'echonote://expo-development-client/?url=x',
  ])('앱 실행 중 들어온 아는 경로 %s는 그대로 돌려준다', (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBe(path);
  });

  it.each([
    '/missing',
    '/_sitemap',
    '/meetings/m-1/extra',
    'echonote://no-such-path',
    'echonote:///missing?x=1',
    'echonote:missing',
    'ECHONOTE://missing',
    'echonote:///_sitemap',
  ])('앱 실행 중 들어온 없는 경로 %s는 목록 경로로 바꾼다', (path) => {
    expect(redirectSystemPath({ path, initial: false })).toBe('/');
  });

  it('앱을 여는 없는 경로는 그대로 둔다', () => {
    expect(redirectSystemPath({ path: '/missing', initial: true })).toBe('/missing');
  });
});
