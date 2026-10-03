// 앱 전체의 route 경로를 만드는 단일 지점이다. 화면·widget은 경로 문자열을
// 직접 조립하지 않고 이 함수를 호출한다.

const ROOT = '/';

export const ROUTES = {
  root: ROOT,
  meeting: {
    list: ROOT,
    detail: (meetingId: string) => `/meetings/${meetingId}` as const,
    // 녹음 저장 직후 상세. 상세가 텍스트 변환을 한 번 자동 요청한다.
    afterRecording: (meetingId: string) => `/meetings/${meetingId}?autoRequest=1` as const,
  },
  recording: {
    session: (meetingId: string) => `/recording?meetingId=${meetingId}` as const,
  },
} as const;
