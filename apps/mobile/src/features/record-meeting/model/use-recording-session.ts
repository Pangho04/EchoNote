import { useCallback, useEffect, useRef, useState } from 'react';

import { nomalizeMeetingTitle } from '@/entities/meeting/model/nomalize-meeting-title';
import type { Recording } from '@/entities/recording/model/recording';

import type { RecordingService } from '../api/recording-service-contract';
import { clearRecordingDraft, updateRecordingDraftTitle } from './recording-draft';
import {
  type RecordingSessionEvent,
  recordingSessionReducer,
  type RecordingSessionState,
  RecordingState,
  RecordingStatus,
} from './recording-session-reducer';
import { RecordingAlreadySavedError, type SaveRecordingInput } from './save-recording';

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

export interface RecordingSessionDependencies {
  now(): string;
  getCurrentTimeZone(): string;
  saveRecording(input: SaveRecordingInput): Promise<Recording>;
  getSavedByMeetingId(meetingId: string): Promise<Recording | null>;
  // 파일이 이미 없으면 아무것도 하지 않는다.
  deleteTempRecording(uri: string): Promise<void>;
}

export interface UseRecordingSessionInput {
  meetingId: string;
  draftTitle: string;
  recordingService: RecordingService;
  dependencies: RecordingSessionDependencies;
}

export interface RecordingSessionViewModel {
  session: RecordingSessionState;
  elapsedMs: number;
  elapsedLabel: string;
  errorMessage: string | null;
  savedRecording: Recording | null;
  saveStatus: SaveStatus;
  titleInput: string;
  canPause: boolean;
  canResume: boolean;
  canStop: boolean;
  // record·pause native 호출을 기다리는 중. 버튼은 막되 비활성처럼 흐리게 보이지 않게 한다.
  isTransitioning: boolean;
  // 녹음 중·일시정지이거나 저장에 실패해 임시 파일이 남은 상태. 이때만 버리기를 확인한다.
  canDiscard: boolean;
  // 정지·저장이 진행 중이라 화면을 벗어나면 원본을 잃는 상태.
  isSaving: boolean;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  retrySave: () => void;
  changeTitle: (title: string) => void;
  discard: () => Promise<void>;
}

function formatElapsedLabel(elapsedMs: number): string {
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}시간 ${minutes}분 ${seconds}초`;
  if (minutes > 0) return `${minutes}분 ${seconds}초`;

  return `${seconds}초`;
}

function normalizeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useRecordingSession(input: UseRecordingSessionInput): RecordingSessionViewModel {
  const { meetingId, recordingService, dependencies, draftTitle } = input;

  const [session, setSession] = useState<RecordingSessionState>(() => ({
    state: RecordingState.PREPARE,
    status: RecordingStatus.PROCESSING,
  }));
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [savedRecording, setSavedRecording] = useState<Recording | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  const [titleInput, setTitleInput] = useState<string>(() =>
    draftTitle !== ''
      ? draftTitle
      : nomalizeMeetingTitle('', dependencies.now(), dependencies.getCurrentTimeZone()),
  );

  const titleInputRef = useRef(titleInput);
  // 일시정지·재개를 반복해도 경과가 이어지도록 이전 녹음 구간의 합을 보관한다.
  const accumulatedMsRef = useRef(0);
  const savedCandidateRef = useRef<{ tempUri: string; durationMs: number } | null>(null);

  const dispatch = useCallback((event: RecordingSessionEvent) => {
    setSession((current) => recordingSessionReducer(current, event));
  }, []);

  const finishSave = useCallback(
    async (recorded: Recording) => {
      setSavedRecording(recorded);
      setSaveStatus('saved');
      setErrorMessage(null);
      clearRecordingDraft(meetingId);
    },
    [meetingId],
  );

  const saveCurrentCandidate = useCallback(
    async (candidate: { tempUri: string; durationMs: number }) => {
      const createdAt = dependencies.now();
      const timeZone = dependencies.getCurrentTimeZone();
      const title = nomalizeMeetingTitle(titleInputRef.current, createdAt, timeZone);
      const inputValue: SaveRecordingInput = {
        meeting: { meetingId, title, createdAt },
        candidate,
      };

      setSaveStatus('saving');
      setErrorMessage(null);

      try {
        const recorded = await dependencies.saveRecording(inputValue);

        await finishSave(recorded);
      } catch (error) {
        if (error instanceof RecordingAlreadySavedError) {
          const existing = await dependencies.getSavedByMeetingId(meetingId);

          if (existing) {
            await finishSave(existing);

            return;
          }
        }

        setSaveStatus('failed');
        setErrorMessage(normalizeError(error));
      }
    },
    [dependencies, finishSave, meetingId],
  );

  // 화면 진입 시 prepare → 자동 record를 명시적 체인으로 한 번에 이어간다.
  // reducer가 PREPARE→RECORD와 RECORD+PROCESSING→COMPLETED 전이를 실제 상태로 소유한다.
  const begin = useCallback(async () => {
    try {
      await recordingService.prepare();
      dispatch({ state: RecordingState.PREPARE, status: RecordingStatus.COMPLETED });
    } catch (error) {
      const message = normalizeError(error);

      setErrorMessage(message);
      dispatch({ state: RecordingState.PREPARE, status: RecordingStatus.FAILED, message });

      return;
    }

    try {
      await recordingService.record();
      dispatch({ state: RecordingState.RECORD, status: RecordingStatus.COMPLETED });
    } catch (error) {
      const message = normalizeError(error);

      setErrorMessage(message);
      dispatch({ state: RecordingState.RECORD, status: RecordingStatus.FAILED, message });
    }
  }, [dispatch, recordingService]);

  /**
   * @when 녹음 화면 mount 시 1회
   * @expect prepare→record를 명시적 체인으로 실행해 자동 녹음을 시작한다.
   * @clear -
   */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void begin();
  }, [begin]);

  /**
   * @when session이 RECORD+COMPLETED(실제 녹음 중)일 때만
   * @expect 이전 구간까지 누적한 경과에 이어서 500ms 간격으로 갱신한다.
   * @clear 일시정지·정지·이탈 시 이번 구간을 누적하고 타이머를 해제한다.
   */
  useEffect(() => {
    if (session.state !== RecordingState.RECORD || session.status !== RecordingStatus.COMPLETED)
      return;

    const startedAt = Date.now();
    const baseMs = accumulatedMsRef.current;

    const interval = setInterval(() => {
      setElapsedMs(baseMs + (Date.now() - startedAt));
    }, 500);

    return () => {
      accumulatedMsRef.current = baseMs + (Date.now() - startedAt);
      clearInterval(interval);
    };
  }, [session.state, session.status]);

  const pause = useCallback(async () => {
    dispatch({ state: RecordingState.PAUSE, status: RecordingStatus.REQUESTED });

    try {
      await recordingService.pause();
      dispatch({ state: RecordingState.PAUSE, status: RecordingStatus.COMPLETED });
    } catch (error) {
      const message = normalizeError(error);

      setErrorMessage(message);
      dispatch({ state: RecordingState.PAUSE, status: RecordingStatus.FAILED, message });
    }
  }, [dispatch, recordingService]);

  const resume = useCallback(async () => {
    dispatch({ state: RecordingState.RECORD, status: RecordingStatus.REQUESTED });

    try {
      await recordingService.record();
      dispatch({ state: RecordingState.RECORD, status: RecordingStatus.COMPLETED });
    } catch (error) {
      const message = normalizeError(error);

      setErrorMessage(message);
      dispatch({ state: RecordingState.RECORD, status: RecordingStatus.FAILED, message });
    }
  }, [dispatch, recordingService]);

  const stop = useCallback(async () => {
    if (savedCandidateRef.current) return;

    dispatch({ state: RecordingState.STOP, status: RecordingStatus.REQUESTED });

    try {
      const candidate = await recordingService.stop();

      savedCandidateRef.current = candidate;
      dispatch({ state: RecordingState.STOP, status: RecordingStatus.COMPLETED, candidate });
      await saveCurrentCandidate(candidate);
    } catch (error) {
      const message = normalizeError(error);

      setErrorMessage(message);
      dispatch({ state: RecordingState.STOP, status: RecordingStatus.FAILED, message });
    }
  }, [dispatch, recordingService, saveCurrentCandidate]);

  const retrySave = useCallback(() => {
    const candidate = savedCandidateRef.current;

    if (!candidate) return;

    void saveCurrentCandidate(candidate);
  }, [saveCurrentCandidate]);

  // 녹음을 멈추고 임시 파일과 draft를 지운다. 실패하면 호출자가 화면에 남아 다시 시도한다.
  const discard = useCallback(async () => {
    const candidate = savedCandidateRef.current ?? (await recordingService.stop());

    await dependencies.deleteTempRecording(candidate.tempUri);
    clearRecordingDraft(meetingId);
  }, [dependencies, meetingId, recordingService]);

  const changeTitle = useCallback(
    (title: string) => {
      setTitleInput(title);
      titleInputRef.current = title;
      updateRecordingDraftTitle(meetingId, title);
    },
    [meetingId],
  );

  const canPause =
    session.state === RecordingState.RECORD && session.status === RecordingStatus.COMPLETED;
  const canResume =
    session.state === RecordingState.PAUSE && session.status === RecordingStatus.COMPLETED;
  const canStop =
    (session.state === RecordingState.RECORD || session.state === RecordingState.PAUSE) &&
    session.status === RecordingStatus.COMPLETED;
  const isTransitioning =
    (session.state === RecordingState.RECORD || session.state === RecordingState.PAUSE) &&
    session.status === RecordingStatus.PROCESSING;
  const canDiscard = canStop || isTransitioning || saveStatus === 'failed';
  const isSaving =
    session.state === RecordingState.STOP &&
    session.status !== RecordingStatus.FAILED &&
    saveStatus !== 'failed' &&
    saveStatus !== 'saved';

  return {
    session,
    elapsedMs,
    elapsedLabel: formatElapsedLabel(elapsedMs),
    errorMessage,
    savedRecording,
    saveStatus,
    titleInput,
    canPause,
    canResume,
    canStop,
    isTransitioning,
    canDiscard,
    isSaving,
    pause,
    resume,
    stop,
    retrySave,
    changeTitle,
    discard,
  };
}
