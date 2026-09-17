import { describe, expect, it } from 'vitest';

import { resolveDialogKeyboardOffset, resolveDialogSlack } from './keyboard-offset';

// 화면 800, 카드 300이면 카드 아래 여유는 250이고 간격 24를 빼 226이 남는다.
const LAYOUT = { backdropHeight: 800, cardHeight: 300 };

describe('resolveDialogKeyboardOffset', () => {
  it('키보드가 없으면 카드를 움직이지 않는다', () => {
    expect(resolveDialogKeyboardOffset({ ...LAYOUT, keyboardHeight: 0 })).toBe(0);
  });

  it('키보드가 카드 아래 여유보다 낮으면 카드를 움직이지 않는다', () => {
    expect(resolveDialogKeyboardOffset({ ...LAYOUT, keyboardHeight: 200 })).toBe(0);
    expect(resolveDialogKeyboardOffset({ ...LAYOUT, keyboardHeight: 226 })).toBe(0);
  });

  it('여유를 넘는 만큼만 올린다', () => {
    expect(resolveDialogKeyboardOffset({ ...LAYOUT, keyboardHeight: 300 })).toBe(-74);
    expect(resolveDialogKeyboardOffset({ ...LAYOUT, keyboardHeight: 400 })).toBe(-174);
  });

  it('키보드가 커져도 가린 양을 넘겨 올리지 않는다', () => {
    const keyboardHeight = 500;
    const offset = resolveDialogKeyboardOffset({ ...LAYOUT, keyboardHeight });

    expect(Math.abs(offset)).toBeLessThan(keyboardHeight);
    expect(offset).toBe(-(keyboardHeight - resolveDialogSlack(LAYOUT)));
  });

  it('카드가 화면을 가득 채워도 여유를 1 이상으로 유지해 0으로 나누지 않는다', () => {
    expect(resolveDialogSlack({ backdropHeight: 400, cardHeight: 400 })).toBe(1);
    expect(
      resolveDialogKeyboardOffset({ backdropHeight: 400, cardHeight: 400, keyboardHeight: 300 }),
    ).toBe(-299);
  });
});
