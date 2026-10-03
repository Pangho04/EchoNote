import type { ReactElement } from 'react';

import type { PlaybackSessionViewModel } from '../model/use-playback-session';
import { PlaybackControls } from './playback-controls';

export interface RecordingPlayerProps {
  viewModel: PlaybackSessionViewModel;
}

export function RecordingPlayer({ viewModel }: RecordingPlayerProps): ReactElement {
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
