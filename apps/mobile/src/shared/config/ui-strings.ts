// 화면에 그대로 나가는 문구를 도메인별로 모은다.
// throw new Error(...)에 쓰는 개발자용 진단 문구는 여기에 넣지 않는다.

export const UI_STRINGS = {
  common: {
    confirm: '확인',
    cancel: '취소',
    retry: '다시 시도',
  },
  meetingLibrary: {
    heading: '회의',
    loadFailed: '회의 목록을 불러오지 못했습니다.',
    permissionDenied: '마이크 권한을 허용해야 녹음을 시작할 수 있습니다.',
    permissionBlocked: '설정에서 마이크 권한을 허용해 주세요.',
    newRecording: '새 회의 녹음',
    startRecording: '녹음 시작',
    openSettings: '설정 열기',
  },
  meetingDetail: {
    heading: '회의 기록',
    back: '‹ 회의',
    backLabel: '회의 목록으로 이동',
    openFailedTitle: '회의를 열 수 없습니다',
    notFound: '회의를 찾을 수 없습니다.',
    loadFailed: '회의를 불러오지 못했습니다.',
  },
  recording: {
    titlePlaceholder: '기본 이름으로 저장',
    pause: '일시정지',
    resume: '재개',
    stop: '녹음 종료',
    saveFailed: '저장하지 못했습니다.',
    saved: '녹음을 저장했습니다.',
  },
} as const;
