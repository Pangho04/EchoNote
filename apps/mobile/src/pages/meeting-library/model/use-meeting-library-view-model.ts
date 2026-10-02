import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  createSQLiteMeetingRepository,
  type MeetingListCursor,
  type MeetingListVMItem,
  toMeetingListItemVM,
} from '@/entities/meeting';
import { createSQLiteRecordingPersistence, deleteRecordingFile } from '@/entities/recording';
import { useSession } from '@/features/authenticate';
import { deleteMeetings as deleteMeetingsWithFiles } from '@/features/delete-meeting';
import { makeListMeetings } from '@/features/list-meetings';
import type { RecordingIdFactory, RecordingPermissionService } from '@/features/record-meeting';
import { startRecording } from '@/features/record-meeting';
import { UI_STRINGS } from '@/shared/config/ui-strings';

const PAGE_LIMIT = 20;

// ponytail: 기록 시작 연도를 조회하지 않고 1970년까지 모두 나열한다. 연도 수가 부담되면 MIN(created_at_ms)로 줄인다.
const YEAR_OPTIONS = Array.from(
  { length: new Date().getFullYear() - new Date(0).getFullYear() + 1 },
  (_, index) => new Date().getFullYear() - index,
);

// 열린 회의 시작 결과를 page가 consume할 수 있게 반환한다. navigate는 page 책임이다.
export type ConfirmRecordingResult =
  { kind: 'granted'; meetingId: string } | { kind: 'denied' } | { kind: 'blocked' };

export interface MeetingLibraryViewModel {
  items: MeetingListVMItem[];
  // 조회가 끝났는데 고른 연도에 회의가 없다. 조회 중이거나 실패했으면 false다.
  isEmpty: boolean;
  errorMessage: string | null;
  selectedYear: number;
  // 최신 연도부터 나열한다.
  yearOptions: readonly number[];
  // 목록과 cursor를 버리고 고른 연도의 첫 page부터 다시 읽는다.
  selectYear(year: number): void;
  refresh(): Promise<void>;
  // 다음 page가 없거나 이미 불러오는 중이면 아무것도 하지 않는다.
  loadMore(): Promise<void>;
  clearErrorMessage(): void;
  confirmRecordingTitle(title: string): Promise<ConfirmRecordingResult>;
  isEditing: boolean;
  selectedIds: ReadonlySet<string>;
  isDeleting: boolean;
  toggleEditing(): void;
  toggleSelection(meetingId: string): void;
  // 성공하면 편집을 끝내고 목록을 다시 읽는다. 실패는 false로 알린다.
  deleteMeetings(meetingIds: string[]): Promise<boolean>;
  signOut(): Promise<void>;
}

export function useMeetingLibraryViewModel(
  permissionService: RecordingPermissionService,
  createRecordingId: RecordingIdFactory,
): MeetingLibraryViewModel {
  const database = useSQLiteContext();
  const { signOut } = useSession();

  const [items, setItems] = useState<MeetingListVMItem[]>([]);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [selectedYear, setSelectedYear] = useState(() => new Date().getFullYear());
  // 조회 함수가 연도마다 새로 만들어지면 focus effect가 다시 돌므로 조회는 ref로 읽는다.
  const queryYear = useRef(selectedYear);
  const nextCursor = useRef<MeetingListCursor | null>(null);
  const isLoadingMore = useRef(false);
  // refresh가 시작되면 늘린다. 그 전에 출발한 loadMore 결과는 버린다.
  const listGeneration = useRef(0);

  const repository = useMemo(() => createSQLiteMeetingRepository(database), [database]);
  const listMeetings = useMemo(() => makeListMeetings(repository), [repository]);

  // 조회 실패는 errorMessage로 흡수한다. 최초 로드 시점은 화면(focus)이 정한다.
  // 이미 불러온 뒤쪽 page는 버리고 첫 page부터 다시 읽는다.
  const refresh = useCallback(async () => {
    const generation = ++listGeneration.current;

    try {
      const result = await listMeetings({ year: queryYear.current, limit: PAGE_LIMIT });

      if (generation !== listGeneration.current) return;

      nextCursor.current = result.nextCursor;
      setItems(result.meetings.map((meeting) => toMeetingListItemVM(meeting, result.timeZone)));
      setHasLoaded(true);
      setErrorMessage(null);
    } catch {
      // 사용자에게는 고정 문구만 보인다. 원인 문구는 화면에 노출하지 않는다.
      setErrorMessage(UI_STRINGS.meetingLibrary.loadFailed);
    }
  }, [listMeetings]);

  const loadMore = useCallback(async () => {
    const cursor = nextCursor.current;
    const generation = listGeneration.current;

    if (!cursor || isLoadingMore.current) return;

    isLoadingMore.current = true;

    try {
      const result = await listMeetings({
        year: queryYear.current,
        limit: PAGE_LIMIT,
        cursor,
      });

      if (generation !== listGeneration.current) return;

      nextCursor.current = result.nextCursor;
      setItems((current) => [
        ...current,
        ...result.meetings.map((meeting) => toMeetingListItemVM(meeting, result.timeZone)),
      ]);
    } catch {
      setErrorMessage(UI_STRINGS.meetingLibrary.loadFailed);
    } finally {
      isLoadingMore.current = false;
    }
  }, [listMeetings]);

  const selectYear = useCallback(
    (year: number) => {
      queryYear.current = year;
      setSelectedYear(year);
      setItems([]);
      setHasLoaded(false);
      void refresh();
    },
    [refresh],
  );

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
    isEmpty: hasLoaded && items.length === 0,
    errorMessage,
    selectedYear,
    yearOptions: YEAR_OPTIONS,
    selectYear,
    refresh,
    loadMore,
    clearErrorMessage,
    confirmRecordingTitle,
    isEditing,
    selectedIds,
    isDeleting,
    toggleEditing,
    toggleSelection,
    deleteMeetings,
    signOut,
  };
}
