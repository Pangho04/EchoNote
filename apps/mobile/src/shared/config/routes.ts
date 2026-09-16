// 앱 전체의 route 경로를 만드는 단일 지점이다. 화면·widget은 경로 문자열을
// 직접 조립하지 않고 이 함수를 호출한다.

const ROOT = '/';

export const ROUTES = {
  root: ROOT,
  meeting: {
    list: ROOT,
    detail: (meetingId: string) => `/meetings/${meetingId}` as const,
  },
  recording: {
    session: (meetingId: string) => `/recording?meetingId=${meetingId}` as const,
  },
} as const;
