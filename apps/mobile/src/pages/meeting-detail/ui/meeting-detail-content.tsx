import { useSQLiteContext } from 'expo-sqlite';
import { type ReactElement, useMemo } from 'react';

import type { Recording } from '@/entities/recording';
import { RecordingPlayer, useRecordingPlayback } from '@/features/play-recording';
import {
  createTranscriptionDeps,
  TranscriptionPanel,
  useTranscription,
} from '@/features/request-transcription';
import { useGatewayClient } from '@/shared/api/gateway-client';

import { toDetailMetaLabel } from '../model/to-detail-meta-label';
import type { MeetingDetailViewModel } from '../model/use-meeting-detail-view-model';
import { MeetingDetailHeader } from './meeting-detail-header';

export interface MeetingDetailContentProps {
  viewModel: Extract<MeetingDetailViewModel, { kind: 'ready' }>;
  recording: Recording;
  autoRequest: boolean;
}

// page가 ready일 때만 마운트한다. 재생·텍스트 변환 훅을 조건 없이 호출하기 위해서다.
export function MeetingDetailContent({
  viewModel,
  recording,
  autoRequest,
}: MeetingDetailContentProps): ReactElement {
  const database = useSQLiteContext();
  const gateway = useGatewayClient();

  const deps = useMemo(() => createTranscriptionDeps(database, gateway), [database, gateway]);
  const player = useRecordingPlayback(recording.uri);
  const transcription = useTranscription(deps, recording, autoRequest);

  return (
    <>
      <MeetingDetailHeader
        dateLabel={viewModel.dateLabel}
        metaLabel={toDetailMetaLabel(viewModel.durationLabel, transcription.panel)}
        title={viewModel.title}
      />

      <RecordingPlayer viewModel={player} />

      <TranscriptionPanel
        onPressSegment={(startMs) => void player.playFrom(startMs)}
        positionMs={player.positionMs}
        viewModel={transcription}
      />
    </>
  );
}
