import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createSQLiteMeetingRepository,
  type MeetingListVMItem,
  toMeetingListItemVM,
} from '@/entities/meeting';
import { makeListMeetings } from '@/features/list-meetings';
import type { RecordingIdFactory, RecordingPermissionService } from '@/features/record-meeting';
import { startRecording } from '@/features/record-meeting';

const FIRST_PAGE_LIMIT = 20;

// 열린 회의 시작 결과를 page가 consume할 수 있게 반환한다. navigate는 page 책임이다.
export type ConfirmRecordingResult =
  { kind: 'granted'; meetingId: string } | { kind: 'denied' } | { kind: 'blocked' };

export interface MeetingLibraryViewModel {
  items: MeetingListVMItem[];
  errorMessage: string | null;
  isTitleDialogOpen: boolean;
  blockedMessage: string | null;
  openRecordingTitleDialog(): void;
  cancelRecordingTitleDialog(): void;
  confirmRecordingTitle(title: string): Promise<ConfirmRecordingResult>;
}

export function useMeetingLibraryViewModel(
  permissionService: RecordingPermissionService,
  createRecordingId: RecordingIdFactory,
): MeetingLibraryViewModel {
  const database = useSQLiteContext();

  const [items, setItems] = useState<MeetingListVMItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTitleDialogOpen, setIsTitleDialogOpen] = useState(false);
  const [blockedMessage, setBlockedMessage] = useState<string | null>(null);

  const repository = useMemo(() => createSQLiteMeetingRepository(database), [database]);
  const listMeetings = useMemo(() => makeListMeetings(repository), [repository]);

  const refresh = useCallback(async () => {
    const currentYear = new Date().getFullYear();
    const result = await listMeetings({
      year: currentYear,
      limit: FIRST_PAGE_LIMIT,
    });

    setItems(result.meetings.map((meeting) => toMeetingListItemVM(meeting, result.timeZone)));
  }, [listMeetings]);

  /**
   * @when 회의 목록 화면이 실제 DB 연결 아래 처음 나타날 때
   * @expect 현재 연도의 첫 page를 SQLite에서 읽어 목록에 표시한다.
   * @clear -
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : '회의 목록을 불러오지 못했습니다.');
    });
  }, [refresh]);

  const openRecordingTitleDialog = useCallback(() => {
    setBlockedMessage(null);
    setIsTitleDialogOpen(true);
  }, []);

  const cancelRecordingTitleDialog = useCallback(() => {
    setIsTitleDialogOpen(false);
    setBlockedMessage(null);
  }, []);

  const confirmRecordingTitle = useCallback(
    async (title: string): Promise<ConfirmRecordingResult> => {
      setIsTitleDialogOpen(false);

      const result = await startRecording(permissionService, title, createRecordingId);

      if (result.kind === 'blocked') {
        setBlockedMessage('설정에서 마이크 권한을 허용해 주세요.');
      }

      return result;
    },
    [permissionService, createRecordingId],
  );

  return {
    items,
    errorMessage,
    isTitleDialogOpen,
    blockedMessage,
    openRecordingTitleDialog,
    cancelRecordingTitleDialog,
    confirmRecordingTitle,
  };
}
