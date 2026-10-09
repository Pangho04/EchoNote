import { Linking, StyleSheet, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SignInForm } from '@/features/authenticate';
import { UI_STRINGS } from '@/shared/config/ui-strings';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

export function SignInPage() {
  const styles = useStyles();

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAwareScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <AppText accessibilityRole="header" color="textPrimary" variant="display">
            {UI_STRINGS.auth.appName}
          </AppText>
          <AppText color="textSecondary" variant="reading">
            {UI_STRINGS.auth.tagline}
          </AppText>
        </View>

        <SignInForm />

        <AppText color="textSecondary" style={styles.contact} variant="caption">
          {UI_STRINGS.auth.contact}{' '}
          <AppText
            accessibilityLabel={`${UI_STRINGS.auth.contactLabel}, ${UI_STRINGS.auth.contactEmail}`}
            accessibilityRole="link"
            color="accent"
            onPress={() => {
              void Linking.openURL(`mailto:${UI_STRINGS.auth.contactEmail}`).catch(() => {});
            }}
            variant="caption"
          >
            {UI_STRINGS.auth.contactEmail}
          </AppText>
        </AppText>
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}

const useStyles = createThemedStyles((theme) =>
  StyleSheet.create({
    safeArea: {
      backgroundColor: theme.colors.background,
      flex: 1,
    },
    content: {
      flexGrow: 1,
      gap: theme.spacing[6],
      justifyContent: 'center',
      paddingHorizontal: theme.spacing[5],
      paddingVertical: theme.spacing[6],
    },
    header: {
      alignItems: 'center',
      gap: theme.spacing[2],
    },
    contact: {
      textAlign: 'center',
    },
  }),
);
