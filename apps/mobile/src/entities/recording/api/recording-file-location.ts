import { File, Paths } from 'expo-file-system';

// iOS 앱 컨테이너 경로는 업데이트·재설치 때 바뀔 수 있다. DB에는 문서 폴더 기준 상대 경로만 두고
// 문서 폴더 URI는 읽을 때마다 현재 값을 쓴다.
function documentRootUri(): string {
  const { uri } = Paths.document;

  return uri.endsWith('/') ? uri : `${uri}/`;
}

export function toRecordingRelativePath(uri: string): string {
  const root = documentRootUri();

  if (!uri.startsWith(root)) {
    throw new RangeError(`녹음 파일이 문서 폴더 밖에 있습니다: ${uri}`);
  }

  return uri.slice(root.length);
}

export function toRecordingFileUri(relativePath: string): string {
  return documentRootUri() + relativePath;
}

export function recordingFileExists(uri: string): boolean {
  return new File(uri).exists;
}
