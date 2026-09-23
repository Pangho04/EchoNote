import type { ReactElement } from 'react';

import { useAudioPlayback } from '../api/use-audio-playback.native';
import { usePlaybackSession } from '../model/use-playback-session';
import { PlaybackControls } from './playback-controls';

export interface RecordingPlayerProps {
  uri: string;
}

// saved final URI만 받아 native player와 controls를 잇는다. 원본 파일은 읽기만 한다.
export function RecordingPlayer({ uri }: RecordingPlayerProps): ReactElement {
  const viewModel = usePlaybackSession(useAudioPlayback(uri));

  return (
    <PlaybackControls
      canPause={viewModel.canPause}
      canPlay={viewModel.canPlay}
      canSeek={viewModel.canSeek}
      durationLabel={viewModel.durationLabel}
      errorMessage={viewModel.errorMessage}
      onPause={viewModel.pause}
      onPlay={() => void viewModel.play()}
      onSeekBackward={() => void viewModel.seekBackward()}
      onSeekForward={() => void viewModel.seekForward()}
      positionLabel={viewModel.positionLabel}
      progressRatio={viewModel.progressRatio}
    />
  );
}
