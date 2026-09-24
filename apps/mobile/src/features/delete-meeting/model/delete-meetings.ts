export type DeleteMeetingsDependencies = {
  deleteMeetingsWithRecordings(meetingIds: string[]): Promise<string[]>;
  deleteRecordingFile(uri: string): void;
};

// DB를 먼저 지운다. 파일을 먼저 지우면 DB 실패 때 녹음 없는 회의가 목록에 남는다.
export async function deleteMeetings(
  dependencies: DeleteMeetingsDependencies,
  meetingIds: string[],
): Promise<void> {
  const uris = await dependencies.deleteMeetingsWithRecordings(meetingIds);

  for (const uri of uris) {
    try {
      dependencies.deleteRecordingFile(uri);
    } catch {
      // ponytail: 지우지 못한 파일은 남는다. 참조하는 행이 없어 화면에는 드러나지 않으며, 용량이 문제 되면 문서 폴더 정리 작업을 둔다.
    }
  }
}
