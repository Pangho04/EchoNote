import { Directory, File, Paths } from 'expo-file-system';

import { saveFileAsync, type SaveFileResult } from '../../../../modules/document-saver';

const TEXT_MIME_TYPE = 'text/plain';
const RECORDING_MIME_TYPE = 'audio/mp4';

export async function saveTextFile(fileName: string, text: string): Promise<SaveFileResult> {
  return saveFromExportDirectory(async (directory) => {
    const file = new File(directory, fileName);

    file.create();
    file.write(text);

    return file;
  }, TEXT_MIME_TYPE);
}

export async function saveRecordingCopy(
  recordingUri: string,
  fileName: string,
): Promise<SaveFileResult> {
  return saveFromExportDirectory(async (directory) => {
    const file = new File(directory, fileName);

    // 원본은 읽기만 한다. 큰 녹음에서도 화면이 멈추지 않게 비동기 copy를 쓴다.
    await new File(recordingUri).copy(file);

    return file;
  }, RECORDING_MIME_TYPE);
}

// 저장 화면에 보일 이름으로 임시 사본을 만들고, 저장 화면이 닫히면 결과와 관계없이 지운다.
async function saveFromExportDirectory(
  writeExportFile: (directory: Directory) => Promise<File>,
  mimeType: string,
): Promise<SaveFileResult> {
  const directory = new Directory(Paths.cache, 'exports');

  // 저장 중 앱이 종료돼 남은 사본을 치운다.
  if (directory.exists) directory.delete();

  directory.create();

  try {
    const file = await writeExportFile(directory);

    return await saveFileAsync(file.uri, mimeType);
  } finally {
    if (directory.exists) directory.delete();
  }
}
