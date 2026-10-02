import { useRef, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';

import { useSession } from './session-provider';

export interface SignInFormView {
  email: string;
  password: string;
  errorMessage: string | null;
  isSubmitting: boolean;
  canSubmit: boolean;
  setEmail(email: string): void;
  setPassword(password: string): void;
  submit(): void;
}

// 성공하면 SIGNED_IN 알림으로 화면이 바뀌므로 폼은 실패만 처리한다.
export function useSignInForm(): SignInFormView {
  const { signIn } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canSubmit = !isSubmitting && email.trim() !== '' && password.trim() !== '';
  // 같은 tick에 submit이 연달아 불려도 signIn이 한 번만 나가게 막는다. isSubmitting state는 화면 표시용이라
  // 갱신이 다음 렌더까지 미뤄져 연타를 막지 못한다.
  const submittingRef = useRef(false);

  const submit = async () => {
    if (submittingRef.current) return;

    submittingRef.current = true;
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      await signIn({ email: email.trim(), password });
    } catch {
      setErrorMessage(UI_STRINGS.auth.signInFailed);

      // Android는 오류 문구의 accessibilityLiveRegion이 읽으므로 iOS에서만 직접 낭독한다.
      if (Platform.OS === 'ios')
        AccessibilityInfo.announceForAccessibility(UI_STRINGS.auth.signInFailed);
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  };

  return {
    email,
    password,
    errorMessage,
    isSubmitting,
    canSubmit,
    setEmail,
    setPassword,
    submit: () => {
      if (canSubmit) void submit();
    },
  };
}
