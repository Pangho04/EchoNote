import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  createSQLiteMeetingRepository,
  type MeetingListVMItem,
  toMeetingListItemVM,
} from '@/entities/meeting';
import { makeCreateMeeting } from '@/features/create-meeting';
import { makeListMeetings } from '@/features/list-meetings';

const FIRST_PAGE_LIMIT = 20;

export function useMeetingLibraryViewModel() {
  const database = useSQLiteContext();

  const [items, setItems] = useState<MeetingListVMItem[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const repository = useMemo(() => createSQLiteMeetingRepository(database), [database]);

  const createMeeting = useMemo(() => makeCreateMeeting({ repository }), [repository]);
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
    // refresh는 SQLite 조회를 await한 뒤 state를 갱신한다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh().catch((error: unknown) => {
      setErrorMessage(error instanceof Error ? error.message : '회의 목록을 불러오지 못했습니다.');
    });
  }, [refresh]);

  const create = useCallback(async () => {
    setErrorMessage(null);

    try {
      await createMeeting('');
      // React 배열에 임시 행을 추가하지 않고 DB를 다시 읽는다.
      await refresh();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '회의를 만들지 못했습니다.');
    }
  }, [createMeeting, refresh]);

  return { create, errorMessage, items };
}
