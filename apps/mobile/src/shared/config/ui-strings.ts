// 화면에 그대로 나가는 문구를 도메인별로 모은다.
// throw new Error(...)에 쓰는 개발자용 진단 문구는 여기에 넣지 않는다.

export const UI_STRINGS = {
  common: {
    confirm: '확인',
    cancel: '취소',
    retry: '다시 시도',
  },
  database: {
    corruptedTitle: '저장된 회의를 열 수 없습니다',
    corrupted:
      '저장 공간이 손상되어 회의 목록을 읽지 못했습니다. 초기화하면 앱을 다시 쓸 수 있지만 회의 목록은 사라집니다.',
    reset: '초기화하고 계속',
    unsupportedVersionTitle: '앱을 업데이트해 주세요',
    unsupportedVersion:
      '더 새로운 버전에서 만든 데이터입니다. 이 버전에서는 열 수 없으며 초기화하면 기록이 사라집니다.',
    unknownTitle: '앱을 시작하지 못했습니다',
    unknown: '저장 공간을 여는 중 문제가 생겼습니다.',
  },
  meetingLibrary: {
    heading: '회의',
    loadFailedTitle: '회의 목록을 열 수 없습니다',
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
    recordingMissing: '녹음 파일을 찾을 수 없습니다.',
  },
  playback: {
    seekBackward: '-10',
    seekBackwardLabel: '10초 뒤로',
    seekForward: '+10',
    seekForwardLabel: '10초 앞으로',
    playLabel: '재생',
    pauseLabel: '정지',
    unknownTime: '--:--',
    failed: '재생할 수 없습니다.',
    controlFailed: '재생 조작에 실패했습니다.',
  },
  recording: {
    titleLabel: '녹음 제목',
    titlePlaceholder: '기본 이름으로 저장',
    pause: '일시정지',
    resume: '재개',
    stop: '녹음 종료',
    saveFailed: '저장하지 못했습니다.',
    saved: '녹음을 저장했습니다.',
  },
} as const;
