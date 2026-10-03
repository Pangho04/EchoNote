import { MAX_UPLOAD_BYTES } from '@echonote/contracts';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';

import {
  createSQLiteMeetingRepository,
  type MeetingListCursor,
  type MeetingListVMItem,
  nomalizeMeetingTitle,
  toMeetingListItemVM,
} from '@/entities/meeting';
import { createSQLiteRecordingPersistence, deleteRecordingFile } from '@/entities/recording';
import { useSession } from '@/features/authenticate';
import { deleteMeetings as deleteMeetingsWithFiles } from '@/features/delete-meeting';
import { makeListMeetings } from '@/features/list-meetings';
import type {
  ImportFailure,
  RecordingIdFactory,
  RecordingImportService,
  RecordingPermissionService,
} from '@/features/record-meeting';
import {
  importRecording,
  isAllowedRecordingMimeType,
  pendingImports,
  startRecording,
} from '@/features/record-meeting';
import {
  createFinalRecordingUri,
  createNativeRecordingFileService,
} from '@/features/record-meeting/api/recording-file-service.native';
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

// 시작했으면 page가 상세로 이동한다. 나머지는 팝업 여부만 정한다.
export type PickAndImportResult =
  | { kind: 'started'; meetingId: string }
  | { kind: 'canceled' }
  | { kind: 'tooLarge' }
  | { kind: 'failed' };

export type ImportFailureNotice = { meetingId: string; message: string };

function toImportFailureReason(failure: ImportFailure): string {
  switch (failure.kind) {
    case 'tooLarge':
      return UI_STRINGS.meetingLibrary.uploadTooLarge;
    case 'unsupported':
      return UI_STRINGS.meetingLibrary.uploadUnsupported;
    case 'unreadable':
      return UI_STRINGS.meetingLibrary.uploadUnreadable;
    case 'failed':
      return UI_STRINGS.meetingLibrary.uploadFailed;
  }
}

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
  // 파일 선택부터 가져오기 시작까지 true다. 이 동안 다시 호출해도 무시한다.
  isImporting: boolean;
  pickAndImport(): Promise<PickAndImportResult>;
  // 포커스 중일 때만 가장 먼저 실패한 가져오기 하나를 내놓는다.
  importFailure: ImportFailureNotice | null;
  dismissImportFailure(meetingId: string): void;
}

export function useMeetingLibraryViewModel(
  permissionService: RecordingPermissionService,
  createRecordingId: RecordingIdFactory,
  importService: RecordingImportService,
  isFocused: boolean,
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
  const [isImporting, setIsImporting] = useState(false);
  // pendingImports는 화면 밖 상태라 바뀔 때 다시 렌더해 읽는다.
  const [, setImportVersion] = useState(0);
  // 조회 함수가 연도마다 새로 만들어지면 focus effect가 다시 돌므로 조회는 ref로 읽는다.
  const queryYear = useRef(selectedYear);
  const nextCursor = useRef<MeetingListCursor | null>(null);
  const isLoadingMore = useRef(false);
  // 같은 프레임 연타는 state 반영 전이라 ref로 막는다.
  const isImportingRef = useRef(false);
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

  /**
   * @when 목록이 포커스를 가진 동안
   * @expect 가져오기가 끝날 때마다 목록을 다시 읽고 실패 알림을 다시 계산한다.
   * @clear 포커스를 잃으면 구독을 해제한다. 복귀 때는 화면의 focus refresh가 맡는다.
   */
  useEffect(() => {
    if (!isFocused) return;

    return pendingImports.subscribe(() => {
      setImportVersion((version) => version + 1);
      void refresh();
    });
  }, [isFocused, refresh]);

  // 렌더마다 다시 읽는다. 결과 객체는 매번 새로 만들어지므로 받는 쪽은 meetingId로 비교한다.
  const failure = isFocused ? pendingImports.failures()[0] : undefined;
  const importFailure: ImportFailureNotice | null =
    failure === undefined
      ? null
      : {
          meetingId: failure.meetingId,
          message: `${failure.title}\n${toImportFailureReason(failure.result)}`,
        };

  const dismissImportFailure = useCallback((meetingId: string) => {
    pendingImports.consume(meetingId);
    setImportVersion((version) => version + 1);
  }, []);

  const pickAndImport = useCallback(async (): Promise<PickAndImportResult> => {
    if (isImportingRef.current) return { kind: 'canceled' };

    isImportingRef.current = true;
    setIsImporting(true);

    try {
      const source = await importService.pickRecording();

      if (source === null) return { kind: 'canceled' };

      // size 0은 크기를 모르는 경우라 통과시키고 가져오기의 사본 검사가 막는다.
      if (source.size > MAX_UPLOAD_BYTES) return { kind: 'tooLarge' };

      const meetingId = createRecordingId();
      const createdAt = new Date().toISOString();
      const title = nomalizeMeetingTitle(
        '',
        createdAt,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
      );
      const deps = {
        persistence: createSQLiteRecordingPersistence(database),
        files: createNativeRecordingFileService(),
        createFinalUri: createFinalRecordingUri,
        isAllowedMimeType: isAllowedRecordingMimeType,
        importer: importService,
        isPickedSourceAppCopy: Platform.OS === 'ios',
      };

      pendingImports.start(meetingId, {
        title,
        createdAt,
        importRecording: () => importRecording(deps, { meetingId, title, createdAt, source }),
      });

      return { kind: 'started', meetingId };
    } catch {
      return { kind: 'failed' };
    } finally {
      isImportingRef.current = false;
      setIsImporting(false);
    }
  }, [createRecordingId, database, importService]);

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
    isImporting,
    pickAndImport,
    importFailure,
    dismissImportFailure,
  };
}
