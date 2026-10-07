import { Download } from 'lucide-react-native';
import { type ReactElement, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { TranscriptContent } from '@/entities/transcript';
import { palette } from '@/shared/config/theme';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { useDialog } from '@/shared/ui/dialog';
import { DropdownMenu } from '@/shared/ui/dropdown-menu';
import { createThemedStyles, useTheme } from '@/shared/ui/theme-provider';

import { type ExportKind, type ExportRequest, toTranscriptText } from '../model/export-file';
import { useExportMeetingFile } from '../model/use-export-meeting-file';

const ICON_SIZE = 18;

const KIND_LABELS: Record<ExportKind, string> = {
  transcript: UI_STRINGS.meetingExport.transcript,
  recording: UI_STRINGS.meetingExport.recording,
};

export interface ExportMeetingButtonProps {
  title: string;
  // null이면 녹음 파일을 아직 가져오는 중이라 비활성한다.
  recordingUri: string | null;
  transcript: TranscriptContent | null;
}

export function ExportMeetingButton({
  title,
  recordingUri,
  transcript,
}: ExportMeetingButtonProps): ReactElement {
  const styles = useStyles();
  const { openDialog } = useDialog();
  const { busy, exportFile } = useExportMeetingFile();
  const kindRef = useRef<ExportKind>('recording');
  const disabled = recordingUri === null || busy;

  // 팝업은 연 순간의 제목·녹음·전사로 고정한다. 열린 뒤 전사가 끝나면 다시 열 때 반영된다.
  function openExportDialog(uri: string) {
    const content = transcript !== null && toTranscriptText(transcript) !== '' ? transcript : null;
    const initialKind: ExportKind = content === null ? 'recording' : 'transcript';

    function toExportRequest(kind: ExportKind): ExportRequest {
      // 전사가 없으면 드롭다운이 잠겨 transcript를 고를 수 없다.
      if (kind === 'transcript' && content !== null) return { kind, title, content };

      return { kind: 'recording', title, recordingUri: uri };
    }

    kindRef.current = initialKind;
    openDialog({
      title: UI_STRINGS.meetingExport.title,
      message: UI_STRINGS.meetingExport.message,
      content: (
        <ExportKindField
          initialKind={initialKind}
          locked={content === null}
          onChange={(kind) => {
            kindRef.current = kind;
          }}
        />
      ),
      actions: [
        { label: UI_STRINGS.common.cancel },
        {
          label: UI_STRINGS.meetingExport.save,
          emphasis: 'primary',
          onPress: () => void exportFile(toExportRequest(kindRef.current)),
        },
      ],
      runActionsAfterClose: true,
    });
  }

  return (
    <Pressable
      accessibilityLabel={UI_STRINGS.meetingExport.open}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={12}
      onPress={() => {
        if (recordingUri !== null) openExportDialog(recordingUri);
      }}
      style={[styles.button, disabled && styles.disabled]}
    >
      <Download color={palette.white} size={ICON_SIZE} />
    </Pressable>
  );
}

interface ExportKindFieldProps {
  initialKind: ExportKind;
  locked: boolean;
  onChange: (kind: ExportKind) => void;
}

// 팝업 content는 열 때 캡처되므로 선택 상태는 이 컴포넌트가 직접 갖는다.
export function ExportKindField({
  initialKind,
  locked,
  onChange,
}: ExportKindFieldProps): ReactElement {
  const styles = useStyles();
  const { colors } = useTheme();
  const [kind, setKind] = useState(initialKind);
  const [fieldWidth, setFieldWidth] = useState<number>();

  function handleSelect(id: string) {
    switch (id) {
      case 'transcript':
      case 'recording':
        setKind(id);
        onChange(id);
        break;
    }
  }

  return (
    // DropdownMenu는 안쪽 내용 너비로 줄어들어 바깥 너비를 재서 필드를 채운다.
    <View
      onLayout={(event) => setFieldWidth(event.nativeEvent.layout.width)}
      style={styles.fieldWrap}
    >
      <DropdownMenu
        accessibilityLabel={`${UI_STRINGS.meetingExport.kindFieldLabel} ${KIND_LABELS[kind]}`}
        disabled={locked}
        onSelect={handleSelect}
        options={[
          { id: 'transcript', label: KIND_LABELS.transcript, selected: kind === 'transcript' },
          { id: 'recording', label: KIND_LABELS.recording, selected: kind === 'recording' },
        ]}
      >
        <View style={[styles.field, { width: fieldWidth }]}>
          <AppText variant="body">{KIND_LABELS[kind]}</AppText>
          <Svg height={6} width={10}>
            <Path
              d="M1 1l4 4 4-4"
              fill="none"
              stroke={locked ? colors.textTertiary : colors.accent}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
            />
          </Svg>
        </View>
      </DropdownMenu>
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    button: {
      alignItems: 'center',
      justifyContent: 'center',
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: theme.colors.accent,
    },
    disabled: {
      opacity: 0.4,
    },
    fieldWrap: {
      marginTop: theme.spacing[2],
    },
    field: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 44,
      paddingHorizontal: theme.spacing[3],
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: theme.radii.control,
      backgroundColor: theme.colors.surfaceMuted,
    },
  }),
);
