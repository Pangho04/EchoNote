export interface RecordingDraft {
  meetingId: string;
  titleInput: string;
}

// 저장 전 meetingId·제목을 화면 전환을 넘어 이어주는 process-memory 저장소다.
// URL·SQLite·Zustand에는 두지 않는다. 동시에 하나만 보유한다.
let currentDraft: RecordingDraft | null = null;

export function setRecordingDraft(draft: RecordingDraft): void {
  currentDraft = draft;
}

export function getRecordingDraft(meetingId: string): RecordingDraft | null {
  return currentDraft?.meetingId === meetingId ? currentDraft : null;
}

export function clearRecordingDraft(meetingId: string): void {
  if (currentDraft?.meetingId === meetingId) {
    currentDraft = null;
  }
}

export function updateRecordingDraftTitle(meetingId: string, titleInput: string): void {
  if (currentDraft?.meetingId === meetingId) {
    currentDraft = { ...currentDraft, titleInput };
  }
}
