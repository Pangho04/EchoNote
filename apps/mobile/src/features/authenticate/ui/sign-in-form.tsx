import { useRef } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

import { useSignInForm } from '../model/use-sign-in-form';

export function SignInForm() {
  const { email, password, errorMessage, isSubmitting, canSubmit, setEmail, setPassword, submit } =
    useSignInForm();
  const styles = useStyles();
  const passwordInputRef = useRef<TextInput>(null);

  return (
    <View style={styles.form}>
      <TextInput
        accessibilityLabel={UI_STRINGS.auth.email}
        autoCapitalize="none"
        autoComplete="email"
        autoCorrect={false}
        editable={!isSubmitting}
        keyboardType="email-address"
        onChangeText={setEmail}
        onSubmitEditing={() => passwordInputRef.current?.focus()}
        placeholder={UI_STRINGS.auth.email}
        placeholderTextColor={styles.placeholder.color}
        returnKeyType="next"
        style={styles.input}
        textContentType="username"
        value={email}
      />

      <TextInput
        accessibilityLabel={UI_STRINGS.auth.password}
        autoComplete="password"
        editable={!isSubmitting}
        onChangeText={setPassword}
        onSubmitEditing={submit}
        placeholder={UI_STRINGS.auth.password}
        placeholderTextColor={styles.placeholder.color}
        ref={passwordInputRef}
        returnKeyType="go"
        secureTextEntry
        style={styles.input}
        textContentType="password"
        value={password}
      />

      {errorMessage ? (
        <AppText accessibilityLiveRegion="polite" color="warning" variant="caption">
          {errorMessage}
        </AppText>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit, busy: isSubmitting }}
        disabled={!canSubmit}
        onPress={submit}
        style={[styles.primary, !canSubmit && styles.primaryDisabled]}
      >
        <AppText style={styles.primaryLabel} variant="reading">
          {isSubmitting ? UI_STRINGS.auth.signingIn : UI_STRINGS.auth.signIn}
        </AppText>
      </Pressable>
    </View>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    form: {
      gap: theme.spacing[3],
    },
    input: {
      backgroundColor: theme.colors.surface,
      borderColor: theme.colors.border,
      borderRadius: theme.radii.control,
      borderWidth: StyleSheet.hairlineWidth,
      color: theme.colors.textPrimary,
      minHeight: 46,
      paddingHorizontal: theme.spacing[3],
    },
    placeholder: {
      color: theme.colors.textTertiary,
    },
    primary: {
      alignItems: 'center',
      backgroundColor: theme.colors.accent,
      borderRadius: theme.radii.control,
      minHeight: 46,
      justifyContent: 'center',
    },
    primaryDisabled: {
      opacity: 0.5,
    },
    primaryLabel: {
      color: theme.colors.surface,
      fontWeight: theme.typography.fontWeight.semibold,
    },
  }),
);
