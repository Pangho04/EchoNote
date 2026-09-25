import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useSession } from '@/features/authenticate';
import { palette } from '@/shared/config/theme';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { createThemedStyles, useTheme } from '@/shared/ui/theme-provider';

function statusLabel(kind: 'restoring' | 'signedIn' | 'signedOut'): string {
  switch (kind) {
    case 'restoring':
      return UI_STRINGS.auth.restoring;
    case 'signedIn':
      return UI_STRINGS.auth.signedIn;
    case 'signedOut':
      return UI_STRINGS.auth.signedOut;
  }
}

export function UiLabPage() {
  const theme = useTheme();
  const styles = useStyles();
  const { state, signIn, signOut } = useSession();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [failureMessage, setFailureMessage] = useState<string | null>(null);

  async function handleSignIn() {
    setIsSubmitting(true);
    setFailureMessage(null);

    try {
      await signIn({ email: email.trim(), password });
      setPassword('');
    } catch {
      setFailureMessage(UI_STRINGS.auth.signInFailed);
    } finally {
      setIsSubmitting(false);
    }
  }

  const signInDisabled = isSubmitting || state.kind === 'restoring' || state.kind === 'signedIn';

  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <StatusBar style={theme.mode === 'dark' ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>ECHONOTE</Text>
        <Text style={styles.title}>UI Lab</Text>
        <View style={styles.divider} />
        <View style={styles.preview}>
          <Text style={styles.harnessHeading}>{UI_STRINGS.auth.harnessHeading}</Text>
          <Text style={styles.status}>{statusLabel(state.kind)}</Text>

          <TextInput
            accessibilityLabel={UI_STRINGS.auth.email}
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder={UI_STRINGS.auth.email}
            placeholderTextColor={styles.placeholder.color}
            style={styles.input}
            textContentType="username"
            value={email}
          />

          <TextInput
            accessibilityLabel={UI_STRINGS.auth.password}
            onChangeText={setPassword}
            placeholder={UI_STRINGS.auth.password}
            placeholderTextColor={styles.placeholder.color}
            secureTextEntry
            style={styles.input}
            textContentType="password"
            value={password}
          />

          {failureMessage ? <Text style={styles.failure}>{failureMessage}</Text> : null}

          <Pressable
            accessibilityLabel={UI_STRINGS.auth.signIn}
            accessibilityRole="button"
            disabled={signInDisabled}
            onPress={handleSignIn}
            style={[styles.button, signInDisabled && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>{UI_STRINGS.auth.signIn}</Text>
          </Pressable>

          <Pressable
            accessibilityLabel={UI_STRINGS.auth.signOut}
            accessibilityRole="button"
            disabled={state.kind !== 'signedIn'}
            onPress={signOut}
            style={[styles.button, state.kind !== 'signedIn' && styles.buttonDisabled]}
          >
            <Text style={styles.buttonText}>{UI_STRINGS.auth.signOut}</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    content: {
      flexGrow: 1,
      paddingHorizontal: theme.spacing[5],
      paddingVertical: theme.spacing[6],
    },
    divider: {
      backgroundColor: theme.colors.border,
      height: StyleSheet.hairlineWidth,
      marginTop: theme.spacing[5],
    },
    eyebrow: {
      color: theme.colors.recording,
      fontSize: theme.typography.fontSize.caption,
      fontWeight: theme.typography.fontWeight.bold,
    },
    preview: {
      flex: 1,
      gap: theme.spacing[3],
      minHeight: 320,
      paddingTop: theme.spacing[6],
    },
    harnessHeading: {
      color: theme.colors.textPrimary,
      fontSize: theme.typography.fontSize.title,
      fontWeight: theme.typography.fontWeight.semibold,
    },
    status: {
      color: theme.colors.textSecondary,
      fontSize: theme.typography.fontSize.body,
    },
    input: {
      borderColor: theme.colors.border,
      borderRadius: theme.radii.item,
      borderWidth: 1,
      color: theme.colors.textPrimary,
      fontSize: theme.typography.fontSize.body,
      paddingHorizontal: theme.spacing[3],
      paddingVertical: theme.spacing[2],
    },
    placeholder: {
      color: theme.colors.textTertiary,
    },
    failure: {
      color: theme.colors.recording,
      fontSize: theme.typography.fontSize.caption,
    },
    button: {
      alignItems: 'center',
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radii.item,
      paddingVertical: theme.spacing[3],
    },
    buttonDisabled: {
      opacity: 0.4,
    },
    buttonText: {
      color: palette.white,
      fontSize: theme.typography.fontSize.body,
      fontWeight: theme.typography.fontWeight.semibold,
    },
    safeArea: {
      backgroundColor: theme.colors.background,
      flex: 1,
    },
    title: {
      color: theme.colors.textPrimary,
      fontSize: theme.typography.fontSize.largeTitle,
      fontWeight: theme.typography.fontWeight.bold,
      lineHeight: theme.typography.lineHeight.largeTitle,
      marginTop: theme.spacing[2],
    },
  }),
);
