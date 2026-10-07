import type { SaveFileResult } from '../../../../modules/document-saver';

// 웹(Electron)은 저장 화면을 아직 구현하지 않았다. 호출부가 실패 팝업을 띄운다.
export async function saveTextFile(_fileName: string, _text: string): Promise<SaveFileResult> {
  throw new Error('웹에서는 회의 파일 저장을 지원하지 않습니다.');
}

export async function saveRecordingCopy(
  _recordingUri: string,
  _fileName: string,
): Promise<SaveFileResult> {
  throw new Error('웹에서는 회의 파일 저장을 지원하지 않습니다.');
}
