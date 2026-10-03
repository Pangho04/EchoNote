import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { z } from 'zod';

import type { Recording } from '@/entities/recording';
import type {
  StoredTranscription,
  TranscriptContent,
  Transcription,
  TranscriptionErrorCode,
  TranscriptionStatus,
} from '@/entities/transcript';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { type DialogOptions, useDialog } from '@/shared/ui/dialog';

import type { TranscriptionDeps } from './create-transcription-deps';
import {
  isTranscribable,
  requestTranscription,
  toFailureMessage,
  type UploadOutcome,
  type UploadProgressPort,
  uploadToDesktop,
} from './request-transcription';

// none.notice·created.reason은 이 화면에서 본 실패 이유다. 저장하지 않아 다시 들어오면
// none은 null, created는 interrupted가 된다.
export type TranscriptionNotice = 'start-failed' | 'recording-rejected';

export type CreatedReason = 'desktop-offline' | 'send-failed' | 'interrupted';

// rejected는 1단계 조건을 어긴 녹음이라 요청할 수 없는 상태다.
// sending.progress가 null이면 아직 데스크탑 연결을 확인하는 중이다.
// unreadable.status는 마지막으로 본 행 status다. 손상 행의 status 원문이 알 수 없는 값이거나 저장소 읽기가 실패했으면 null이다.
export type TranscriptionPanelState =
  | { kind: 'loading' }
  | { kind: 'none'; notice: TranscriptionNotice | null }
  | { kind: 'rejected' }
  | { kind: 'sending'; progress: number | null }
  | { kind: 'created'; reason: CreatedReason }
  | { kind: 'queued' }
  | { kind: 'processing' }
  | { kind: 'failed'; errorCode: TranscriptionErrorCode | null }
  | { kind: 'unreadable'; status: TranscriptionStatus | null }
  | { kind: 'completed'; content: TranscriptContent };

export type TranscriptionView = {
  panel: TranscriptionPanelState;
  disabled: boolean;
};

export type TranscriptionController = {
  load(): Promise<void>;
  open(autoRequest: boolean): Promise<void>;
  changeAppState(next: AppStateStatus): void;
  dispose(): void;
  request(): void;
  retry(): void;
  reupload(): void;
  recheck(): void;
};

type ControllerPorts = {
  onChange: (view: TranscriptionView) => void;
  openDialog: (options: DialogOptions) => void;
};

// 손상 행은 status·job_id 원문만 남는다. jobId는 손상 completed 행(transcript 재조회 대상)일 때만 있다.
type UnreadableRow = {
  kind: 'unreadable';
  status: TranscriptionStatus | null;
  jobId: string | null;
};

type RowView = { kind: 'none' } | { kind: 'row'; transcription: Transcription } | UnreadableRow;

type ExpectedRow = { status: 'none' } | { status: 'failed' | 'created'; jobId: string };

// entry는 상세 진입 조회, after-upload는 업로드 성공·grant 409 직후의 첫 조회다.
type FetchContext = 'entry' | 'poll' | 'after-upload';

// schedule은 조건이 맞으면 다음 조회를 예약하고, reconcile은 쓰기가 0행이라 행을 다시 읽는다.
type FetchStep = 'schedule' | 'reconcile' | 'done';

const POLL_INTERVAL_MS = 5_000;

const jobIdSchema = z.uuid();

const statusSchema = z.enum(['created', 'queued', 'processing', 'completed', 'failed']);

function isPending(status: TranscriptionStatus): boolean {
  return status === 'created' || status === 'queued' || status === 'processing';
}

function isPolled(status: TranscriptionStatus | null): boolean {
  return status === 'queued' || status === 'processing';
}

// 401은 토큰 갱신 중일 수 있고 429·5xx는 서버 사정이라 이번 회차만 건너뛴다.
function isSkippedStatus(status: number): boolean {
  return status === 401 || status === 429 || status >= 500;
}

function toPanel(transcription: Transcription): TranscriptionPanelState {
  switch (transcription.status) {
    case 'created':
      return { kind: 'created', reason: 'interrupted' };
    case 'queued':
      return { kind: 'queued' };
    case 'processing':
      return { kind: 'processing' };
    case 'failed':
      return { kind: 'failed', errorCode: transcription.errorCode };
    case 'completed':
      return { kind: 'completed', content: transcription.content };
  }
}

function matchesExpected(stored: StoredTranscription, expected: ExpectedRow): boolean {
  switch (expected.status) {
    case 'none':
      return stored.kind === 'none';

    case 'failed':
    case 'created':
      return (
        stored.kind === 'row' &&
        stored.transcription.status === expected.status &&
        stored.transcription.jobId === expected.jobId
      );
  }
}

// 화면 하나의 텍스트 변환 상태를 소유한다. polling 상태는 polling 중 표시·예약 타이머·요청 중 표시 셋이다.
export function createTranscriptionController(
  deps: TranscriptionDeps,
  recording: Recording,
  initialAppState: AppStateStatus,
  ports: ControllerPorts,
): TranscriptionController {
  const { meetingId } = recording;

  let isOpen = true;
  let appState = initialAppState;
  let wentBackground = false;

  let jobId: string | null = null;
  let rowStatus: TranscriptionStatus | null = null;
  let panel: TranscriptionPanelState = { kind: 'loading' };
  let isUploading = false;
  let isChecking = false;

  let isPolling = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let request: AbortController | null = null;
  let upload: AbortController | null = null;

  function emit(): void {
    if (isOpen) ports.onChange({ panel, disabled: isUploading || isChecking });
  }

  function show(next: TranscriptionPanelState): void {
    panel = next;
    emit();
  }

  function isInBackground(): boolean {
    return appState === 'background';
  }

  function clearTimer(): void {
    if (timer === null) return;

    clearTimeout(timer);
    timer = null;
  }

  // 닫힌 화면은 polling을 시작하지 않는다.
  function startPolling(): void {
    if (isOpen) isPolling = true;
  }

  function stopPolling(): void {
    request?.abort();
    request = null;
    clearTimer();
    isPolling = false;
  }

  function scheduleNext(): void {
    if (!isPolling || !isOpen || isInBackground() || timer !== null || request !== null) return;

    timer = setTimeout(() => {
      timer = null;
      void fetchJob('poll');
    }, POLL_INTERVAL_MS);
  }

  function showNoRow(notice: TranscriptionNotice | null = null): void {
    jobId = null;
    rowStatus = null;
    show(isTranscribable(recording) ? { kind: 'none', notice } : { kind: 'rejected' });
  }

  function applyRow(view: RowView): void {
    switch (view.kind) {
      case 'none':
        showNoRow();

        return;

      case 'unreadable':
        jobId = view.jobId;
        rowStatus = view.status;
        show({ kind: 'unreadable', status: view.status });

        return;

      case 'row':
        jobId = view.transcription.jobId;
        rowStatus = view.transcription.status;
        show(toPanel(view.transcription));

        return;
    }
  }

  function toUnreadable(stored: { status: string; jobId: string }): UnreadableRow {
    const status = statusSchema.safeParse(stored.status);
    const isCompleted = status.data === 'completed' && jobIdSchema.safeParse(stored.jobId).success;

    return {
      kind: 'unreadable',
      status: status.success ? status.data : null,
      jobId: isCompleted ? stored.jobId : null,
    };
  }

  // 손상 completed 행은 전사를 다시 받을 수 있어 지우지 않는다. 그 외 손상 행은 읽은 job_id로 지운다.
  // 지우기가 0행이면 한 번만 다시 읽고, 그래도 손상이면 지우지 않고 unreadable로 둔다.
  async function readRow(): Promise<RowView> {
    const first = await deps.transcriptions.get(meetingId);

    if (first.kind !== 'corrupt') return first;

    const firstView = toUnreadable(first);

    if (firstView.jobId !== null) return firstView;

    if (await deps.transcriptions.deleteCorrupt(meetingId, first.jobId)) return { kind: 'none' };

    const second = await deps.transcriptions.get(meetingId);

    switch (second.kind) {
      case 'corrupt':
        return toUnreadable(second);

      case 'none':
      case 'row':
        return second;
    }
  }

  // 저장소 읽기가 실패하면 행을 알 수 없어 unreadable로 둔다. [다시 확인]이 처음부터 다시 읽는다.
  async function readRowOrUnreadable(): Promise<RowView> {
    try {
      return await readRow();
    } catch {
      return { kind: 'unreadable', status: null, jobId: null };
    }
  }

  // 다른 화면이 행을 먼저 바꿨을 때 행을 기준으로 화면을 다시 그린다. 팝업은 띄우지 않는다.
  async function reconcile(): Promise<void> {
    stopPolling();

    const view = await readRowOrUnreadable();

    if (!isOpen) return;

    applyRow(view);

    if (view.kind === 'row' && isPolled(view.transcription.status)) {
      startPolling();
      scheduleNext();
    }
  }

  async function updateStatus(
    targetJobId: string,
    status: Exclude<TranscriptionStatus, 'completed'>,
    errorCode: TranscriptionErrorCode | null,
  ): Promise<boolean> {
    const updated = await deps.transcriptions.updateStatus(
      meetingId,
      targetJobId,
      status,
      errorCode,
    );

    if (updated) rowStatus = status;

    return updated;
  }

  async function saveCompleted(targetJobId: string, content: TranscriptContent): Promise<boolean> {
    const saved = await deps.transcriptions.saveCompleted(meetingId, targetJobId, content);

    if (!saved) return false;

    rowStatus = 'completed';
    stopPolling();
    show({ kind: 'completed', content });

    return true;
  }

  function showUnreadable(): void {
    stopPolling();
    show({ kind: 'unreadable', status: rowStatus });
  }

  // 서버 completed를 받으면 전사를 받아 한 번에 저장한다. 받지 못하면 processing으로 두고 다시 묻는다.
  async function completeJob(targetJobId: string, signal: AbortSignal): Promise<FetchStep> {
    if (!isOpen) {
      return (await updateStatus(targetJobId, 'processing', null)) ? 'done' : 'reconcile';
    }

    const transcript = await deps.gateway.getTranscript(targetJobId, signal);

    if (transcript.kind === 'aborted' || jobId !== targetJobId) return 'done';

    switch (transcript.kind) {
      case 'ok':
        return (await saveCompleted(targetJobId, transcript.data)) ? 'done' : 'reconcile';

      case 'http-error':
        if (!isSkippedStatus(transcript.status)) {
          showUnreadable();

          return 'done';
        }

        break;

      case 'network-error':
        break;

      case 'invalid-response':
        showUnreadable();

        return 'done';
    }

    if (!(await updateStatus(targetJobId, 'processing', null))) return 'reconcile';

    show({ kind: 'processing' });
    startPolling();

    return 'schedule';
  }

  async function handleJob(
    targetJobId: string,
    signal: AbortSignal,
    context: FetchContext,
  ): Promise<FetchStep> {
    const result = await deps.gateway.getJob(meetingId, targetJobId, signal);

    // 취소된 요청과 옛 job의 응답은 행·타이머·팝업에 손대지 않는다.
    if (result.kind === 'aborted' || jobId !== targetJobId) return 'done';

    switch (result.kind) {
      case 'ok':
        break;

      case 'http-error':
        if (result.status === 404) {
          if (!(await deps.transcriptions.delete(meetingId, targetJobId))) return 'reconcile';

          stopPolling();
          showNoRow();

          return 'done';
        }

        if (isSkippedStatus(result.status)) return skipRound(context);

        showUnreadable();

        return 'done';

      case 'network-error':
        return skipRound(context);

      case 'invalid-response':
        showUnreadable();

        return 'done';
    }

    const job = result.data;

    switch (job.status) {
      case 'created':
        if (!(await updateStatus(targetJobId, 'created', null))) return 'reconcile';

        stopPolling();
        show({ kind: 'created', reason: 'interrupted' });

        return 'done';

      case 'queued':
      case 'processing':
        if (!(await updateStatus(targetJobId, job.status, null))) return 'reconcile';

        show({ kind: job.status });

        if (context === 'entry') startPolling();

        return 'schedule';

      case 'failed':
        if (!(await updateStatus(targetJobId, 'failed', job.errorCode))) return 'reconcile';

        stopPolling();
        show({ kind: 'failed', errorCode: job.errorCode });

        if (isOpen) {
          ports.openDialog({
            title: UI_STRINGS.transcription.failedTitle,
            message: toFailureMessage(job.errorCode),
            actions: [{ label: UI_STRINGS.common.confirm, emphasis: 'primary' }],
          });
        }

        return 'done';

      case 'completed':
        return completeJob(targetJobId, signal);
    }
  }

  // 건너뛴 회차도 다음 조회는 예약한다. 진입 조회를 건너뛰었으면 로컬 행 기준으로 polling을 시작한다.
  function skipRound(context: FetchContext): FetchStep {
    if (context === 'entry' && isPolled(rowStatus)) startPolling();

    return 'schedule';
  }

  async function fetchJob(context: FetchContext): Promise<void> {
    const targetJobId = jobId;

    if (!isOpen || targetJobId === null || request !== null) return;

    const controller = new AbortController();

    request = controller;

    let step: FetchStep;

    // 행 쓰기가 실패하면 행이 어떤 상태인지 알 수 없어 다시 읽는다.
    try {
      step = await handleJob(targetJobId, controller.signal, context);
    } catch {
      step = 'reconcile';
    } finally {
      if (request === controller) request = null;
    }

    switch (step) {
      case 'schedule':
        scheduleNext();

        return;
      case 'reconcile':
        await reconcile();

        return;
      case 'done':
        return;
    }
  }

  // 읽기 시작부터 버튼을 막아 [다시 확인] 연타가 조회를 겹치지 않게 한다.
  async function load(): Promise<void> {
    stopPolling();
    isChecking = true;
    emit();

    try {
      const view = await readRowOrUnreadable();

      if (!isOpen) return;

      applyRow(view);

      if (view.kind === 'row' && isPending(view.transcription.status)) await fetchJob('entry');
    } finally {
      isChecking = false;
      emit();
    }
  }

  // 손상 completed 행의 [다시 확인]. 실패하면 unreadable을 유지하고 행을 지우지 않는다.
  async function refetchTranscript(targetJobId: string): Promise<void> {
    const controller = new AbortController();

    request = controller;
    isChecking = true;
    emit();

    // 다시 맞추기도 버튼을 막은 채 끝낸다.
    try {
      let needsReconcile = false;

      try {
        const transcript = await deps.gateway.getTranscript(targetJobId, controller.signal);

        if (transcript.kind === 'ok' && jobId === targetJobId) {
          needsReconcile = !(await saveCompleted(targetJobId, transcript.data));
        }
      } catch {
        needsReconcile = true;
      } finally {
        if (request === controller) request = null;
      }

      if (needsReconcile) await reconcile();
    } finally {
      isChecking = false;
      emit();
    }
  }

  // 팝업 직전에 화면이 닫혔거나 background면 팝업 없이 멈춘다.
  function canNotify(): boolean {
    return isOpen && !isInBackground();
  }

  function notify(title: string, message: string): void {
    if (!canNotify()) return;

    ports.openDialog({
      title,
      message,
      actions: [{ label: UI_STRINGS.common.confirm, emphasis: 'primary' }],
    });
  }

  // 팝업보다 panel을 먼저 바꾼다. 팝업이 다른 팝업에 교체돼도 [다시 요청]이 남는다.
  function showDesktopOffline(targetJobId: string): void {
    show({ kind: 'created', reason: 'desktop-offline' });

    if (!canNotify()) return;

    ports.openDialog({
      title: UI_STRINGS.transcription.desktopOfflineTitle,
      message: UI_STRINGS.transcription.desktopOffline,
      actions: [
        { label: UI_STRINGS.common.cancel },
        {
          label: UI_STRINGS.transcription.recheck,
          emphasis: 'primary',
          onPress: () => {
            if (!isOpen) return;

            runUpload({ status: 'created', jobId: targetJobId }, (port) =>
              uploadToDesktop(deps, port, { recording, jobId: targetJobId }),
            );
          },
        },
      ],
    });
  }

  async function finishUpload(
    outcome: UploadOutcome,
    previous: TranscriptionPanelState,
  ): Promise<void> {
    switch (outcome.kind) {
      case 'uploaded':
        show({ kind: 'sending', progress: 100 });
        startPolling();
        await fetchJob('after-upload');

        return;

      case 'invalid-recording':
        show({ kind: 'rejected' });
        notify(
          UI_STRINGS.transcription.invalidRecordingTitle,
          UI_STRINGS.transcription.invalidRecording,
        );

        return;

      // 기존 failed 행은 그대로 두고, 행이 없던 요청만 시작 실패로 표시한다.
      case 'create-failed':
        show(previous.kind === 'none' ? { kind: 'none', notice: 'start-failed' } : previous);
        notify(UI_STRINGS.transcription.requestFailedTitle, UI_STRINGS.transcription.requestFailed);

        return;

      case 'grant-failed':
      case 'upload-failed':
        show({ kind: 'created', reason: 'send-failed' });
        notify(UI_STRINGS.transcription.requestFailedTitle, UI_STRINGS.transcription.requestFailed);

        return;

      case 'job-missing':
        showNoRow();

        return;

      case 'recording-rejected':
        showNoRow('recording-rejected');
        notify(
          UI_STRINGS.transcription.recordingRejectedTitle,
          UI_STRINGS.transcription.recordingRejected,
        );

        return;

      case 'desktop-offline':
        showDesktopOffline(outcome.jobId);

        return;

      case 'aborted':
        show({ kind: 'created', reason: 'interrupted' });

        return;

      // 새 job 행을 만들기 전에 닫혔으면 이전 행이 그대로다.
      case 'stopped':
        show(rowStatus === 'created' ? { kind: 'created', reason: 'interrupted' } : previous);

        return;

      case 'row-changed':
        await reconcile();

        return;
    }
  }

  // 업로드 버튼이 모두 거치는 0단계. 같은 회의 업로드가 앱 어디서든 진행 중이면 막는다.
  // 목록 확인과 추가는 await 없이 한 동기 구간에서 하고, 목록 해제 뒤에 팝업·다시 맞추기를 한다.
  function runUpload(
    expected: ExpectedRow,
    run: (port: UploadProgressPort) => Promise<UploadOutcome>,
  ): void {
    if (isUploading || isChecking) return;

    if (deps.uploadingMeetingIds.has(meetingId)) {
      ports.openDialog({
        title: UI_STRINGS.transcription.alreadyRequestedTitle,
        message: UI_STRINGS.transcription.alreadyRequested,
        actions: [{ label: UI_STRINGS.common.confirm, emphasis: 'primary' }],
      });

      return;
    }

    deps.uploadingMeetingIds.add(meetingId);
    isUploading = true;
    emit();

    const previous = panel;

    const port: UploadProgressPort = {
      isScreenOpen: () => isOpen,
      isInBackground,
      onJobCreated: (createdJobId) => {
        jobId = createdJobId;
        rowStatus = 'created';
      },
      onUploadStarted: (abort) => {
        upload = abort;
        show({ kind: 'sending', progress: 0 });
      },
      onProgress: (percent) => show({ kind: 'sending', progress: percent }),
    };

    async function execute(): Promise<UploadOutcome> {
      const stored = await deps.transcriptions.get(meetingId);

      if (!matchesExpected(stored, expected)) return { kind: 'row-changed' };

      if (!isTranscribable(recording)) return { kind: 'invalid-recording' };

      show({ kind: 'sending', progress: null });

      return run(port);
    }

    // 흐름 중 예외는 행 상태를 알 수 없어 다시 맞추기로 보낸다.
    void (async () => {
      let outcome: UploadOutcome;

      try {
        outcome = await execute();
      } catch {
        outcome = { kind: 'row-changed' };
      } finally {
        upload = null;
        deps.uploadingMeetingIds.delete(meetingId);
        isUploading = false;
        emit();
      }

      await finishUpload(outcome, previous);
    })();
  }

  function requestNew(): void {
    runUpload({ status: 'none' }, (port) => requestTranscription(deps, port, recording));
  }

  return {
    load,

    // 녹음 직후 진입이면 읽기가 끝난 뒤 한 번 요청한다. 이미 행이 있으면 행 대조가 막고 행을 다시 그린다.
    async open(autoRequest) {
      await load();

      if (autoRequest && isOpen) requestNew();
    },

    // inactive는 무시한다. background를 거친 active 복귀만 즉시 조회한다.
    changeAppState(next) {
      appState = next;

      if (next === 'background') {
        wentBackground = true;
        upload?.abort();
        clearTimer();

        return;
      }

      if (next !== 'active') return;

      const resumed = wentBackground;

      wentBackground = false;

      if (!resumed || !isPolling || request !== null) return;

      clearTimer();
      void fetchJob('poll');
    },

    dispose() {
      isOpen = false;
      upload?.abort();
      stopPolling();
    },

    request: requestNew,

    retry() {
      if (jobId === null) return;

      runUpload({ status: 'failed', jobId }, (port) => requestTranscription(deps, port, recording));
    },

    reupload() {
      if (jobId === null) return;

      const targetJobId = jobId;

      runUpload({ status: 'created', jobId: targetJobId }, (port) =>
        uploadToDesktop(deps, port, { recording, jobId: targetJobId }),
      );
    },

    recheck() {
      if (isUploading || isChecking) return;

      if (panel.kind === 'unreadable' && jobId !== null && rowStatus === 'completed') {
        void refetchTranscript(jobId);

        return;
      }

      void load();
    },
  };
}

export type TranscriptionViewModel = TranscriptionView & {
  request: () => void;
  retry: () => void;
  reupload: () => void;
  recheck: () => void;
};

// recording은 화면이 열려 있는 동안 같은 객체여야 한다. 바뀌면 상태를 처음부터 다시 읽는다.
// autoRequest는 녹음 직후 들어온 화면이면 true다. 첫 읽기 뒤 한 번만 요청한다.
export function useTranscription(
  deps: TranscriptionDeps,
  recording: Recording,
  autoRequest: boolean,
): TranscriptionViewModel {
  const { openDialog } = useDialog();
  const [view, setView] = useState<TranscriptionView>({
    panel: { kind: 'loading' },
    disabled: true,
  });
  const controllerRef = useRef<TranscriptionController | null>(null);

  /**
   * @when 상세 화면이 열리거나 회의 녹음·의존성이 바뀔 때
   * @expect 로컬 행을 읽어 panel을 그리고, 진행 중이면 서버에 한 번 묻는다. autoRequest면 읽은 뒤 요청한다. AppState 변화를 polling·업로드에 전한다.
   * @clear AppState 구독을 끊고, polling을 멈추고, 진행 중 업로드를 끊는다.
   */
  useEffect(() => {
    const controller = createTranscriptionController(deps, recording, AppState.currentState, {
      onChange: setView,
      openDialog,
    });
    const subscription = AppState.addEventListener('change', controller.changeAppState);

    controllerRef.current = controller;
    void controller.open(autoRequest);

    return () => {
      subscription.remove();
      controller.dispose();
    };
  }, [autoRequest, deps, openDialog, recording]);

  const request = useCallback(() => controllerRef.current?.request(), []);
  const retry = useCallback(() => controllerRef.current?.retry(), []);
  const reupload = useCallback(() => controllerRef.current?.reupload(), []);
  const recheck = useCallback(() => controllerRef.current?.recheck(), []);

  return { ...view, request, retry, reupload, recheck };
}
