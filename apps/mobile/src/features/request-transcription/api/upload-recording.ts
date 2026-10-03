import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

export type UploadRecordingInput = {
  fileUri: string;
  uploadUrl: string;
  grant: string;
  signal: AbortSignal;
  onProgress: (percent: number) => void;
};

// recording-rejected는 Worker가 파일 내용을 거부한 422다. 같은 녹음으로 다시 보내도 같은 결과다.
export type UploadRecordingResult =
  { kind: 'uploaded' } | { kind: 'recording-rejected' } | { kind: 'failed' } | { kind: 'aborted' };

export type UploadRecording = (input: UploadRecordingInput) => Promise<UploadRecordingResult>;

function toResult(status: number): UploadRecordingResult {
  if (status === 200 || status === 201) return { kind: 'uploaded' };

  if (status === 422) return { kind: 'recording-rejected' };

  return { kind: 'failed' };
}

async function sendFile(input: UploadRecordingInput): Promise<UploadRecordingResult> {
  const task = new File(input.fileUri).createUploadTask(input.uploadUrl, {
    httpMethod: 'PUT',
    // 기본값 background는 앱이 멈춘 뒤에도 전송을 이어 가 abort 규칙과 어긋난다.
    sessionType: 'foreground',
    headers: {
      Authorization: `Bearer ${input.grant}`,
      'Content-Type': 'application/octet-stream',
    },
    onProgress: ({ bytesSent, totalBytes }) => {
      if (totalBytes > 0)
        input.onProgress(Math.min(100, Math.floor((bytesSent / totalBytes) * 100)));
    },
    signal: input.signal,
  });

  try {
    // non-2xx도 resolve한다. 전송 실패와 abort만 reject다.
    return toResult((await task.uploadAsync()).status);
  } finally {
    task.release();
  }
}

// 화면이 꺼지면 앱이 background로 가 업로드가 끊기므로 업로드 동안만 꺼짐을 막는다.
// 다른 회의 업로드가 동시에 돌 수 있어 업로드마다 새 태그를 쓴다. 켜기·끄기 실패는 업로드를 막지 않는다.
export async function uploadRecording(input: UploadRecordingInput): Promise<UploadRecordingResult> {
  const keepAwakeTag = Crypto.randomUUID();

  await activateKeepAwakeAsync(keepAwakeTag).catch(() => undefined);

  let result: UploadRecordingResult;

  try {
    result = await sendFile(input);
  } catch {
    result = input.signal.aborted ? { kind: 'aborted' } : { kind: 'failed' };
  }

  await deactivateKeepAwake(keepAwakeTag).catch(() => undefined);

  return result;
}
