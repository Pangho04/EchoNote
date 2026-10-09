import { Pencil } from 'lucide-react-native';
import { type ReactElement, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { PressedHighlight } from '@/shared/ui/pressed-highlight';
import { createThemedStyles, useTheme } from '@/shared/ui/theme-provider';

import { normalizeMeetingRenameTitle } from '../model/rename-meeting';

const EDIT_ICON_SIZE = 18;
const TOUCH_TARGET_SIZE = 44;

export interface RenameMeetingEditorProps {
  title: string;
  disabled: boolean;
  onSave(title: string): Promise<void>;
}

type Mode =
  | { kind: 'view' }
  | { kind: 'editing'; draft: string }
  | { kind: 'saving'; draft: string }
  | { kind: 'error'; draft: string; message: string };

export function RenameMeetingEditor(props: RenameMeetingEditorProps): ReactElement {
  const { title, disabled, onSave } = props;
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const styles = useStyles();
  const { colors } = useTheme();

  if (mode.kind === 'view') {
    return (
      <View style={styles.titleRow}>
        <AppText accessibilityRole="header" style={styles.title} variant="title">
          {title}
        </AppText>
        <Pressable
          accessibilityLabel={UI_STRINGS.meetingDetail.renameEdit}
          accessibilityRole="button"
          accessibilityState={{ disabled }}
          disabled={disabled}
          onPress={() => setMode({ kind: 'editing', draft: title })}
          style={({ pressed }) => [styles.editButton, pressed && styles.editButtonPressed]}
        >
          <Pencil color={colors.textTertiary} size={EDIT_ICON_SIZE} />
        </Pressable>
      </View>
    );
  }

  const { draft } = mode;
  const isSaving = mode.kind === 'saving';
  const normalized = normalizeMeetingRenameTitle(draft);
  const saveDisabled = isSaving || normalized === '' || normalized === title;

  const handleCancel = () => {
    if (isSaving) return;

    setMode({ kind: 'view' });
  };

  const handleSave = () => {
    if (saveDisabled) return;

    setMode({ kind: 'saving', draft });

    onSave(normalized)
      .then(() => setMode({ kind: 'view' }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);

        setMode({ kind: 'error', draft, message });
      });
  };

  return (
    <View style={styles.container}>
      <TextInput
        accessibilityLabel={UI_STRINGS.meetingDetail.renameInput}
        editable={!isSaving}
        maxLength={80}
        onChangeText={(text) =>
          setMode({ kind: mode.kind === 'error' ? 'editing' : mode.kind, draft: text })
        }
        style={styles.input}
        value={draft}
      />

      <View style={styles.actions}>
        <Pressable
          accessibilityLabel={UI_STRINGS.common.cancel}
          accessibilityRole="button"
          accessibilityState={{ disabled: isSaving }}
          disabled={isSaving}
          onPress={handleCancel}
        >
          {({ pressed }) => (
            <>
              <PressedHighlight pressed={pressed} />
              <AppText variant="body">{UI_STRINGS.common.cancel}</AppText>
            </>
          )}
        </Pressable>

        <Pressable
          accessibilityLabel={UI_STRINGS.meetingDetail.renameSave}
          accessibilityRole="button"
          accessibilityState={{ busy: isSaving, disabled: saveDisabled }}
          disabled={saveDisabled}
          onPress={handleSave}
        >
          {({ pressed }) => (
            <>
              <PressedHighlight pressed={pressed} />
              <AppText color="accent" variant="body">
                {UI_STRINGS.meetingDetail.renameSave}
              </AppText>
            </>
          )}
        </Pressable>
      </View>

      {mode.kind === 'error' ? (
        <AppText accessibilityLiveRegion="polite" color="warning" variant="caption">
          {mode.message}
        </AppText>
      ) : null}
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    titleRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: theme.spacing[2],
    },
    title: {
      flexShrink: 1,
      fontSize: 29,
      fontWeight: theme.typography.fontWeight.semibold,
      lineHeight: 32,
    },
    editButton: {
      alignItems: 'center',
      height: TOUCH_TARGET_SIZE,
      justifyContent: 'center',
      width: TOUCH_TARGET_SIZE,
    },
    editButtonPressed: {
      backgroundColor: theme.colors.surfacePressed,
      borderRadius: theme.radii.round,
    },
    container: {
      gap: theme.spacing[2],
      paddingVertical: theme.spacing[2],
    },
    input: {
      borderColor: theme.colors.border,
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.colors.textPrimary,
      minHeight: 44,
      paddingHorizontal: theme.spacing[3],
    },
    actions: {
      flexDirection: 'row',
      gap: theme.spacing[2],
      justifyContent: 'flex-end',
    },
  }),
);
