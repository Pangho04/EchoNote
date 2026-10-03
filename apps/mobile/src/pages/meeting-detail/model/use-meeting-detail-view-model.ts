import { useCallback, useEffect, useState } from 'react';

import { type Meeting, MeetingNotFoundError } from '@/entities/meeting';
import type { Recording } from '@/entities/recording';
import type { MeetingDetailResult } from '@/features/get-meeting-detail';
import type { PendingImport } from '@/features/record-meeting';
import { UI_STRINGS } from '@/shared/config/ui-strings';

export type MeetingDetailViewModel =
  | { kind: 'loading' }
  // 업로드로 만든 회의를 가져오는 중이다. 아직 DB에 없어 가져오기 입력값으로 그린다.
  | { kind: 'importing'; title: string; dateLabel: string }
  // 실패 안내는 목록이 띄운다. 상세는 문구 없이 목록으로 돌아간다.
  | { kind: 'import-failed' }
  | { kind: 'ready'; title: string; dateLabel: string; durationLabel: string }
  | { kind: 'not-found'; message: string }
  | { kind: 'recording-missing'; message: string }
  | { kind: 'error'; message: string };

export interface UseMeetingDetailViewModelInput {
  meetingId: string;
  timeZone: string;
  loadMeetingDetail: (meetingId: string) => Promise<MeetingDetailResult>;
  getPendingImport: (meetingId: string) => PendingImport | undefined;
  consumePendingImport: (meetingId: string) => void;
  loadMeeting: (meetingId: string) => Promise<Meeting | null>;
  renameMeeting: (meetingId: string, title: string) => Promise<void>;
}

// recording은 viewModel이 ready일 때만 있다. 재생·텍스트 변환 훅이 표시값이 아닌 Domain을 받는다.
export interface MeetingDetailState {
  viewModel: MeetingDetailViewModel;
  recording: Recording | null;
}

export interface MeetingDetailOutput extends MeetingDetailState {
  // 실패하면 화면에 보일 문구를 message에 담아 throw한다.
  rename(title: string): Promise<void>;
}

interface LoadedDetail {
  key: string;
  state: MeetingDetailState;
}

function formatDateLabel(createdAt: string, timeZone: string): string {
  const date = new Date(createdAt);
  const dayLabel = new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
  const timeLabel = new Intl.DateTimeFormat('ko-KR', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);

  return `${dayLabel} · ${timeLabel}`;
}

// 상세는 초까지 보여준다. 분 단위인 목록의 formatMeetingDurationLabel과 계약이 다르다.
function formatDurationLabel(durationMs: number): string {
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new RangeError(`녹음 길이가 올바르지 않습니다: ${durationMs}`);
  }

  const totalSeconds = Math.floor(durationMs / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}시간`);

  if (minutes > 0) parts.push(`${minutes}분`);

  if (seconds > 0) parts.push(`${seconds}초`);

  return parts.length > 0 ? parts.join(' ') : '0초';
}

function toReadyViewModel(
  meeting: Meeting,
  recording: Recording,
  timeZone: string,
): MeetingDetailViewModel {
  return {
    kind: 'ready',
    title: meeting.title,
    dateLabel: formatDateLabel(meeting.createdAt, timeZone),
    durationLabel: formatDurationLabel(recording.durationMs),
  };
}

function toDetailState(result: MeetingDetailResult, timeZone: string): MeetingDetailState {
  switch (result.kind) {
    case 'ready':
      return {
        viewModel: toReadyViewModel(result.meeting, result.recording, timeZone),
        recording: result.recording,
      };

    case 'not-found':
      return {
        viewModel: { kind: 'not-found', message: UI_STRINGS.meetingDetail.notFound },
        recording: null,
      };

    case 'recording-missing':
      return {
        viewModel: {
          kind: 'recording-missing',
          message: UI_STRINGS.meetingDetail.recordingMissing,
        },
        recording: null,
      };

    case 'error':
      return {
        viewModel: { kind: 'error', message: UI_STRINGS.meetingDetail.loadFailed },
        recording: null,
      };
  }
}

const LOADING: MeetingDetailState = { viewModel: { kind: 'loading' }, recording: null };
const IMPORT_FAILED: MeetingDetailState = { viewModel: { kind: 'import-failed' }, recording: null };

// 조회 대상이 같은지 판단하는 키다. 둘 중 하나만 바뀌어도 다시 읽어야 한다.
function toRequestKey(meetingId: string, timeZone: string): string {
  return `${meetingId}|${timeZone}`;
}

export function useMeetingDetailViewModel(
  input: UseMeetingDetailViewModelInput,
): MeetingDetailOutput {
  const {
    meetingId,
    timeZone,
    loadMeetingDetail,
    getPendingImport,
    consumePendingImport,
    loadMeeting,
    renameMeeting,
  } = input;
  const requestKey = toRequestKey(meetingId, timeZone);

  const [loaded, setLoaded] = useState<LoadedDetail | null>(null);
  // 회의마다 진입 때 한 번만 잡는다. 목록이 실패 항목을 consume해도 이 화면은 import-failed를 유지한다.
  const [pendingSnapshot, setPendingSnapshot] = useState(() => ({
    meetingId,
    pending: getPendingImport(meetingId),
  }));

  if (pendingSnapshot.meetingId !== meetingId) {
    setPendingSnapshot({ meetingId, pending: getPendingImport(meetingId) });
  }

  const pending = pendingSnapshot.meetingId === meetingId ? pendingSnapshot.pending : undefined;

  /**
   * @when 상세 화면에 들어오거나 다른 회의로 바뀔 때
   * @expect 그 meetingId를 DB에서 다시 읽어 표시용 ViewModel로 바꾼다.
   * @clear 화면을 벗어나거나 요청이 밀리면 늦게 도착한 결과를 버린다.
   */
  useEffect(() => {
    let active = true;

    const key = toRequestKey(meetingId, timeZone);

    async function runLoad() {
      if (pending !== undefined && (await pending.result).kind !== 'saved') {
        if (active) setLoaded({ key, state: IMPORT_FAILED });

        return;
      }

      try {
        const result = await loadMeetingDetail(meetingId);

        if (active) setLoaded({ key, state: toDetailState(result, timeZone) });
      } catch {
        if (active)
          setLoaded({
            key,
            state: {
              viewModel: { kind: 'error', message: UI_STRINGS.meetingDetail.loadFailed },
              recording: null,
            },
          });
      }

      // 화면이 결과를 반영한 뒤에 비운다. 떠난 뒤 끝났으면 다시 열 때 이 결과를 쓴다.
      if (active && pending !== undefined) consumePendingImport(meetingId);
    }

    void runLoad();

    return () => {
      active = false;
    };
  }, [consumePendingImport, loadMeetingDetail, meetingId, pending, timeZone]);

  // 회의 행만 다시 읽어 제목만 바꾼다. recording 참조가 바뀌면 진행 중인 텍스트 변환 업로드가 끊긴다.
  const rename = useCallback(
    async (title: string) => {
      let meeting: Meeting | null;

      try {
        await renameMeeting(meetingId, title);
        meeting = await loadMeeting(meetingId);
      } catch (error) {
        throw new Error(
          error instanceof MeetingNotFoundError
            ? UI_STRINGS.meetingDetail.renameNotFound
            : UI_STRINGS.meetingDetail.renameFailed,
          { cause: error },
        );
      }

      if (meeting === null) throw new Error(UI_STRINGS.meetingDetail.renameNotFound);

      const renamedTitle = meeting.title;

      setLoaded((current) => {
        if (current === null || current.state.viewModel.kind !== 'ready') return current;

        return {
          key: current.key,
          state: {
            ...current.state,
            viewModel: { ...current.state.viewModel, title: renamedTitle },
          },
        };
      });
    },
    [loadMeeting, meetingId, renameMeeting],
  );

  // 조회 대상이 바뀌면 이전 회의 결과를 그대로 두지 않고 다시 loading을 보여준다.
  // loadMeetingDetail만 교체되는 경우(database context 변경)는 깜빡임을 피해 이전 결과를 유지한다.
  if (loaded?.key === requestKey) return { ...loaded.state, rename };

  if (pending !== undefined) {
    return {
      viewModel: {
        kind: 'importing',
        title: pending.title,
        dateLabel: formatDateLabel(pending.createdAt, timeZone),
      },
      recording: null,
      rename,
    };
  }

  return { ...LOADING, rename };
}
