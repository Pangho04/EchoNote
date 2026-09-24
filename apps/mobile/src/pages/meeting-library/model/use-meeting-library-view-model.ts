import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';

import {
  createSQLiteMeetingRepository,
  type MeetingListVMItem,
  toMeetingListItemVM,
} from '@/entities/meeting';
import { createSQLiteRecordingPersistence, deleteRecordingFile } from '@/entities/recording';
import { deleteMeetings as deleteMeetingsWithFiles } from '@/features/delete-meeting';
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
  clearErrorMessage(): void;
  confirmRecordingTitle(title: string): Promise<ConfirmRecordingResult>;
  isEditing: boolean;
  selectedIds: ReadonlySet<string>;
  isDeleting: boolean;
  toggleEditing(): void;
  toggleSelection(meetingId: string): void;
  // 성공하면 편집을 끝내고 목록을 다시 읽는다. 실패는 false로 알린다.
  deleteMeetings(meetingIds: string[]): Promise<boolean>;
}

export function useMeetingLibraryViewModel(
  permissionService: RecordingPermissionService,
  createRecordingId: RecordingIdFactory,
): MeetingLibraryViewModel {
  const database = useSQLiteContext();

  const [items, setItems] = useState<MeetingListVMItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

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
    } catch {
      // 사용자에게는 고정 문구만 보인다. 원인 문구는 화면에 노출하지 않는다.
      setErrorMessage(UI_STRINGS.meetingLibrary.loadFailed);
    }
  }, [listMeetings]);

  const clearErrorMessage = useCallback(() => {
    setErrorMessage(null);
  }, []);

  // 권한 요청과 ID 생성만 맡는다. 결과 표시와 navigate는 호출부가 정한다.
  const confirmRecordingTitle = useCallback(
    (title: string): Promise<ConfirmRecordingResult> =>
      startRecording(permissionService, title, createRecordingId),
    [permissionService, createRecordingId],
  );

  // 편집을 시작하거나 끝낼 때 이전 선택을 남기지 않는다.
  const toggleEditing = useCallback(() => {
    setIsEditing((editing) => !editing);
    setSelectedIds(new Set());
  }, []);

  const toggleSelection = useCallback((meetingId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (!next.delete(meetingId)) next.add(meetingId);

      return next;
    });
  }, []);

  const deleteMeetings = useCallback(
    async (meetingIds: string[]) => {
      const persistence = createSQLiteRecordingPersistence(database);

      setIsDeleting(true);

      try {
        await deleteMeetingsWithFiles(
          {
            deleteMeetingsWithRecordings: persistence.deleteMeetingsWithRecordings,
            deleteRecordingFile,
          },
          meetingIds,
        );
      } catch {
        return false;
      } finally {
        setIsDeleting(false);
      }

      setIsEditing(false);
      setSelectedIds(new Set());
      await refresh();

      return true;
    },
    [database, refresh],
  );

  return {
    items,
    errorMessage,
    refresh,
    clearErrorMessage,
    confirmRecordingTitle,
    isEditing,
    selectedIds,
    isDeleting,
    toggleEditing,
    toggleSelection,
    deleteMeetings,
  };
}
