import { Redirect } from 'expo-router';

import { ROUTES } from '@/shared/config/routes';

// 없는 경로는 목록으로 보낸다. 로그아웃 상태에선 guard가 이 화면을 빼 로그인 화면이 열린다.
export default function NotFoundRoute() {
  return <Redirect href={ROUTES.meeting.list} />;
}
