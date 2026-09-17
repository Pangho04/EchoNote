import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';

import {
  createSQLiteMeetingRepository,
  type MeetingListVMItem,
  toMeetingListItemVM,
} from '@/entities/meeting';
import { makeListMeetings } from '@/features/list-meetings';
import type { RecordingIdFactory, RecordingPermissionService } from '@/features/record-meeting';
import { startRecording } from '@/features/record-meeting';
import { UI_STRINGS } from '@/shared/config/ui-strings';

const FIRST_PAGE_LIMIT = 20;

// 열린 회의 시작 결과를 page가 consume할 수 있게 반환한다. navigate는 page 책임이다.
export type ConfirmRecordingResult =
  { kind: 'granted'; meetingId: string } | { kind: 'denied' } | { kind: 'blocked' };

export interface MeetingLibraryViewModel {
  items: MeetingListVMItem[];
  errorMessage: string | null;
  refresh(): Promise<void>;
  confirmRecordingTitle(title: string): Promise<ConfirmRecordingResult>;
}

export function useMeetingLibraryViewModel(
  permissionService: RecordingPermissionService,
  createRecordingId: RecordingIdFactory,
): MeetingLibraryViewModel {
  const database = useSQLiteContext();

  const [items, setItems] = useState<MeetingListVMItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const repository = useMemo(() => createSQLiteMeetingRepository(database), [database]);
  const listMeetings = useMemo(() => makeListMeetings(repository), [repository]);

  // 조회 실패는 errorMessage로 흡수한다. 최초 로드 시점은 화면(focus)이 정한다.
  const refresh = useCallback(async () => {
    const currentYear = new Date().getFullYear();

    try {
      const result = await listMeetings({
        year: currentYear,
        limit: FIRST_PAGE_LIMIT,
      });

      setItems(result.meetings.map((meeting) => toMeetingListItemVM(meeting, result.timeZone)));
      setErrorMessage(null);
    } catch (error: unknown) {
      setErrorMessage(
        error instanceof Error ? error.message : UI_STRINGS.meetingLibrary.loadFailed,
      );
    }
  }, [listMeetings]);

  // 권한 요청과 ID 생성만 맡는다. 결과 표시와 navigate는 호출부가 정한다.
  const confirmRecordingTitle = useCallback(
    (title: string): Promise<ConfirmRecordingResult> =>
      startRecording(permissionService, title, createRecordingId),
    [permissionService, createRecordingId],
  );

  return {
    items,
    errorMessage,
    refresh,
    confirmRecordingTitle,
  };
}
