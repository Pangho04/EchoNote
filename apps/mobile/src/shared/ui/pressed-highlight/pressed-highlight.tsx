import type { ReactElement } from 'react';
import { StyleSheet, View } from 'react-native';

import { createThemedStyles } from '@/shared/ui/theme-provider';

export interface PressedHighlightProps {
  pressed: boolean;
}

export function PressedHighlight({ pressed }: PressedHighlightProps): ReactElement {
  const styles = useStyles();

  return <View style={[styles.highlight, pressed && styles.pressed]} testID="pressed-highlight" />;
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    highlight: {
      backgroundColor: 'transparent',
      borderRadius: theme.radii.control,
      bottom: -theme.spacing[1],
      left: -theme.spacing[2],
      pointerEvents: 'none',
      position: 'absolute',
      right: -theme.spacing[2],
      top: -theme.spacing[1],
    },
    pressed: {
      backgroundColor: theme.colors.surfacePressed,
    },
  }),
);
