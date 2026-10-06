import { isRecordingScreenHeld } from '@/features/authenticate';
import { ROUTES } from '@/shared/config/routes';

// src/app 라우트 파일과 같게 유지한다. 빠진 경로의 링크는 앱 실행 중 목록으로 바뀐다.
const APP_PATHS = [/^\/$/, /^\/meetings\/[^/]+$/, /^\/recording$/, /^\/sign-in$/];

export function redirectSystemPath({
  path,
  initial,
}: {
  path: string;
  initial: boolean;
}): string | null {
  // 앱을 여는 링크는 개발 빌드 URL이 섞여 들어오므로 손대지 않는다.
  if (initial) return path;

  // 녹음 중에 들어온 링크는 녹음 화면 위에 다른 화면을 쌓아 녹음 저장 흐름을 가리므로 무시한다.
  if (isRecordingScreenHeld()) return null;

  // 없는 경로는 +not-found가 목록 위에 목록을 또 쌓으므로 목록 경로로 바꾼다.
  return isUnknownAppPath(path) ? ROUTES.meeting.list : path;
}

function isUnknownAppPath(path: string): boolean {
  const hasScheme = /^[a-z][\w+.-]*:/i.test(path);

  if (hasScheme && !/^echonote(?:-dev)?:/i.test(path)) return false;

  if (/^echonote(?:-dev)?:\/\/expo-development-client(?:[/?#]|$)/i.test(path)) return false;

  const pathname = path
    .replace(/^echonote(?:-dev)?:(?:\/\/)?/i, '')
    .replace(/[?#].*$/, '')
    .replace(/^\/*/, '/')
    .replace(/(.)\/+$/, '$1');

  return !APP_PATHS.some((pattern) => pattern.test(pathname));
}
