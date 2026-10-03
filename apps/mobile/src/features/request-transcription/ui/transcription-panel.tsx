import type { ReactElement } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { TranscriptList } from '@/entities/transcript';
import { palette } from '@/shared/config/theme';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles, useTheme } from '@/shared/ui/theme-provider';

import { toFailureMessage } from '../model/request-transcription';
import type {
  CreatedReason,
  TranscriptionNotice,
  TranscriptionViewModel,
} from '../model/use-transcription';

export interface TranscriptionPanelProps {
  viewModel: TranscriptionViewModel;
  onPressSegment(startMs: number): void;
}

type Banner = { title: string; details: readonly string[] };

const BANNERS = UI_STRINGS.transcription.banner;

function StatusRow({ label }: { label: string }): ReactElement {
  const styles = useStyles();
  const theme = useTheme();

  return (
    <View style={styles.statusRow}>
      <AppText style={styles.statusLabel} variant="body">
        {label}
      </AppText>

      <ActivityIndicator
        accessibilityElementsHidden
        color={theme.colors.accent}
        importantForAccessibility="no-hide-descendants"
        size="small"
      />
    </View>
  );
}

function FailureBox({ title, details }: Banner): ReactElement {
  const styles = useStyles();

  return (
    <View accessible accessibilityRole="alert" style={styles.failureBox}>
      <AppText style={styles.failureTitle} variant="body">
        {title}
      </AppText>

      {details.map((detail) => (
        <AppText color="textSecondary" key={detail} variant="caption">
          {`• ${detail}`}
        </AppText>
      ))}
    </View>
  );
}

function PanelButton(props: { label: string; disabled: boolean; onPress(): void }): ReactElement {
  const { label, disabled, onPress } = props;
  const styles = useStyles();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        disabled && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <AppText style={styles.buttonLabel} variant="body">
        {label}
      </AppText>
    </Pressable>
  );
}

// 상세 화면 아래 텍스트 변환 영역. 실패 상태는 제목·불릿 이유 상자와 오른쪽 끝 버튼으로 그린다.
export function TranscriptionPanel({
  viewModel,
  onPressSegment,
}: TranscriptionPanelProps): ReactElement {
  const { panel, disabled } = viewModel;
  const styles = useStyles();

  function renderBody(): ReactElement {
    switch (panel.kind) {
      case 'loading':
        return (
          <PanelButton
            disabled
            label={UI_STRINGS.transcription.request}
            onPress={viewModel.request}
          />
        );

      case 'none':
        return (
          <>
            {panel.notice !== null && <FailureBox {...toNoticeBanner(panel.notice)} />}
            <PanelButton
              disabled={disabled}
              label={UI_STRINGS.transcription.request}
              onPress={viewModel.request}
            />
          </>
        );

      case 'rejected':
        return <FailureBox {...BANNERS.rejected} />;

      case 'sending':
        if (panel.progress === null)
          return <StatusRow label={UI_STRINGS.transcription.preparing} />;

        return (
          <>
            <StatusRow label={`${UI_STRINGS.transcription.requesting} ${panel.progress}%`} />
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${panel.progress}%` }]} />
            </View>
          </>
        );

      case 'created':
        return (
          <>
            <FailureBox {...toCreatedBanner(panel.reason)} />
            <PanelButton
              disabled={disabled}
              label={UI_STRINGS.transcription.reupload}
              onPress={viewModel.reupload}
            />
          </>
        );

      case 'queued':
        return <StatusRow label={UI_STRINGS.transcription.queued} />;

      case 'processing':
        return <StatusRow label={UI_STRINGS.transcription.processing} />;

      case 'failed':
        return (
          <>
            <FailureBox
              details={[toFailureMessage(panel.errorCode)]}
              title={UI_STRINGS.transcription.failedTitle}
            />
            <PanelButton
              disabled={disabled}
              label={UI_STRINGS.common.retry}
              onPress={viewModel.retry}
            />
          </>
        );

      case 'unreadable':
        return (
          <>
            <FailureBox
              {...(panel.status === 'completed'
                ? BANNERS.unreadableResult
                : BANNERS.unreadableStatus)}
            />
            <PanelButton
              disabled={disabled}
              label={UI_STRINGS.transcription.recheck}
              onPress={viewModel.recheck}
            />
          </>
        );

      case 'completed':
        return (
          <AppText color="textSecondary" variant="caption">
            {UI_STRINGS.transcription.empty}
          </AppText>
        );
    }
  }

  if (panel.kind === 'completed' && panel.content.segments.length > 0) {
    return (
      <TranscriptList
        contentContainerStyle={styles.container}
        onPressSegment={onPressSegment}
        segments={panel.content.segments}
      />
    );
  }

  return <View style={[styles.container, styles.body]}>{renderBody()}</View>;
}

function toNoticeBanner(notice: TranscriptionNotice): Banner {
  switch (notice) {
    case 'start-failed':
      return BANNERS.startFailed;
    case 'recording-rejected':
      return BANNERS.recordingRejected;
  }
}

function toCreatedBanner(reason: CreatedReason): Banner {
  switch (reason) {
    case 'desktop-offline':
      return BANNERS.desktopOffline;
    case 'send-failed':
      return BANNERS.sendFailed;
    case 'interrupted':
      return BANNERS.interrupted;
  }
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      paddingBottom: 80,
      paddingHorizontal: theme.spacing[5],
      paddingTop: theme.spacing[6],
    },
    body: {
      gap: theme.spacing[2],
    },
    statusRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: theme.spacing[2],
    },
    statusLabel: {
      fontSize: 15,
      fontWeight: theme.typography.fontWeight.semibold,
    },
    track: {
      backgroundColor: theme.colors.border,
      borderRadius: theme.radii.round,
      height: 3,
      overflow: 'hidden',
    },
    fill: {
      backgroundColor: theme.colors.accent,
      height: '100%',
    },
    failureBox: {
      alignSelf: 'stretch',
      gap: theme.spacing[1],
    },
    failureTitle: {
      fontSize: 15,
      fontWeight: theme.typography.fontWeight.semibold,
    },
    button: {
      alignItems: 'center',
      alignSelf: 'flex-end',
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radii.control,
      justifyContent: 'center',
      minHeight: 36,
      paddingHorizontal: theme.spacing[4],
    },
    buttonLabel: {
      color: palette.white,
      fontSize: 14,
      fontWeight: theme.typography.fontWeight.semibold,
    },
    disabled: {
      opacity: 0.4,
    },
    pressed: {
      opacity: 0.82,
    },
  }),
);
