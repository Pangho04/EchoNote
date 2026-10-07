import { useState } from 'react';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { useDialog } from '@/shared/ui/dialog';

import { saveRecordingCopy, saveTextFile } from '../api/export-meeting-file';
import { type ExportRequest, toExportFileName, toTranscriptText } from './export-file';

export type ExportMeetingFileViewModel = {
  busy: boolean;
  exportFile: (request: ExportRequest) => Promise<void>;
};

// busy 동안 아이콘이 비활성이다. 화면을 다시 열어 겹쳐 누른 경우는 api가 거절해 실패 팝업이 뜬다.
export function useExportMeetingFile(): ExportMeetingFileViewModel {
  const { openDialog } = useDialog();
  const [busy, setBusy] = useState(false);

  async function exportFile(request: ExportRequest): Promise<void> {
    setBusy(true);

    try {
      const result = await saveRequest(request);

      if (result === 'saved') {
        openDialog({
          title: UI_STRINGS.meetingExport.savedTitle,
          message: UI_STRINGS.meetingExport.savedMessage,
          actions: [{ label: UI_STRINGS.common.confirm, emphasis: 'primary' }],
        });
      }
    } catch {
      openDialog({
        title: UI_STRINGS.meetingExport.failedTitle,
        message: UI_STRINGS.meetingExport.failedMessage,
        actions: [{ label: UI_STRINGS.common.confirm, emphasis: 'primary' }],
      });
    } finally {
      setBusy(false);
    }
  }

  return { busy, exportFile };
}

function saveRequest(request: ExportRequest) {
  switch (request.kind) {
    case 'transcript':
      return saveTextFile(
        toExportFileName(request.title, 'txt'),
        toTranscriptText(request.content),
      );
    case 'recording':
      return saveRecordingCopy(request.recordingUri, toExportFileName(request.title, 'm4a'));
  }
}
