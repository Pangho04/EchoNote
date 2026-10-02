import { act, render, renderHook } from '@testing-library/react-native';
import { Activity } from 'react';

import { isRecordingScreenHeld, useRecordingScreenHold } from './recording-screen-hold';

describe('useRecordingScreenHold', () => {
  it('둘이 마운트되면 하나가 빠져도 켜져 있고 둘 다 빠지면 꺼진다', async () => {
    const first = await renderHook(() => useRecordingScreenHold());
    const second = await renderHook(() => useRecordingScreenHold());

    expect(isRecordingScreenHeld()).toBe(true);

    await act(async () => {
      first.unmount();
    });

    expect(isRecordingScreenHeld()).toBe(true);

    await act(async () => {
      second.unmount();
    });

    expect(isRecordingScreenHeld()).toBe(false);
  });

  it('release를 두 번 부르거나 release 뒤 언마운트해도 1만 내린다', async () => {
    const other = await renderHook(() => useRecordingScreenHold());
    const { result, unmount } = await renderHook(() => useRecordingScreenHold());

    await act(async () => {
      result.current();
      result.current();
    });
    await act(async () => {
      unmount();
    });

    expect(isRecordingScreenHeld()).toBe(true);

    await act(async () => {
      other.unmount();
    });

    expect(isRecordingScreenHeld()).toBe(false);
  });

  it('effect가 정리 뒤 다시 시작되면 다시 켜지고 release도 다시 동작한다', async () => {
    let release: () => void = () => {};

    function Holder(): null {
      release = useRecordingScreenHold();

      return null;
    }

    // Activity를 숨기면 effect를 정리하고, 다시 보이면 같은 인스턴스에서 effect를 다시 실행한다.
    const view = await render(
      <Activity mode="visible">
        <Holder />
      </Activity>,
    );

    await act(async () => {
      release();
    });
    await view.rerender(
      <Activity mode="hidden">
        <Holder />
      </Activity>,
    );
    await view.rerender(
      <Activity mode="visible">
        <Holder />
      </Activity>,
    );

    expect(isRecordingScreenHeld()).toBe(true);

    await act(async () => {
      release();
    });

    expect(isRecordingScreenHeld()).toBe(false);

    await act(async () => {
      view.unmount();
    });
  });
});
