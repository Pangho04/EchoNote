import {
  createContext,
  type PropsWithChildren,
  type ReactElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Toast } from './toast';

const DEFAULT_DURATION_MS = 2400;

export interface ToastOptions {
  durationMs?: number;
}

// 같은 문구를 연달아 알려도 새 표시로 취급하도록 id로 구분한다.
type ActiveToast = {
  id: number;
  message: string;
  durationMs: number;
};

type ToastContextValue = {
  showToast: (message: string, options?: ToastOptions) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: PropsWithChildren): ReactElement {
  const [activeToast, setActiveToast] = useState<ActiveToast | null>(null);
  const lastIdRef = useRef(0);

  const showToast = useCallback((message: string, options?: ToastOptions) => {
    lastIdRef.current += 1;

    setActiveToast({
      id: lastIdRef.current,
      message,
      durationMs: options?.durationMs ?? DEFAULT_DURATION_MS,
    });
  }, []);

  /**
   * @when 표시할 토스트가 생기거나 새 showToast 호출로 교체될 때마다
   * @expect durationMs 이후 토스트를 자동으로 숨긴다.
   * @clear 다음 토스트로 교체되거나 unmount되면 대기 중인 타이머를 해제한다.
   */
  useEffect(() => {
    if (activeToast === null) return;

    const hideTimer = setTimeout(() => {
      setActiveToast(null);
    }, activeToast.durationMs);

    return () => clearTimeout(hideTimer);
  }, [activeToast]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {activeToast !== null ? <Toast message={activeToast.message} /> : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);

  if (!value) {
    throw new Error('useToast는 ToastProvider 내부에서 사용해야 합니다.');
  }

  return value;
}
