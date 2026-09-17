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
  isTitleDialogOpen: boolean;
  permissionMessage: string | null;
  isPermissionBlocked: boolean;
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
  const [permissionMessage, setPermissionMessage] = useState<string | null>(null);
  const [isPermissionBlocked, setIsPermissionBlocked] = useState(false);

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

  const clearPermissionNotice = useCallback(() => {
    setPermissionMessage(null);
    setIsPermissionBlocked(false);
  }, []);

  const openRecordingTitleDialog = useCallback(() => {
    clearPermissionNotice();
    setIsTitleDialogOpen(true);
  }, [clearPermissionNotice]);

  const cancelRecordingTitleDialog = useCallback(() => {
    setIsTitleDialogOpen(false);
    clearPermissionNotice();
  }, [clearPermissionNotice]);

  // 권한을 얻은 경우에만 dialog를 닫는다. 거부·차단은 dialog 안에서 안내해야 사용자가 볼 수 있다.
  const confirmRecordingTitle = useCallback(
    async (title: string): Promise<ConfirmRecordingResult> => {
      const result = await startRecording(permissionService, title, createRecordingId);

      if (result.kind === 'granted') {
        setIsTitleDialogOpen(false);
        clearPermissionNotice();

        return result;
      }

      if (result.kind === 'blocked') {
        setPermissionMessage(UI_STRINGS.meetingLibrary.permissionBlocked);
        setIsPermissionBlocked(true);

        return result;
      }

      setPermissionMessage(UI_STRINGS.meetingLibrary.permissionDenied);
      setIsPermissionBlocked(false);

      return result;
    },
    [clearPermissionNotice, permissionService, createRecordingId],
  );

  return {
    items,
    errorMessage,
    refresh,
    isTitleDialogOpen,
    permissionMessage,
    isPermissionBlocked,
    openRecordingTitleDialog,
    cancelRecordingTitleDialog,
    confirmRecordingTitle,
  };
}
