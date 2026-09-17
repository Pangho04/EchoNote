import { describe, expect, it } from 'vitest';

import { resolveDialogKeyboardOffset, resolveDialogSlack } from './keyboard-offset';

// 화면 874, 카드 180이면 카드 아래 여유는 347이고 간격 24를 빼 323이 남는다.
// iPhone 16 Pro 시뮬레이터에서 실제로 잰 값이다.
const LAYOUT = { screenHeight: 874, cardHeight: 180 };

describe('resolveDialogKeyboardOffset', () => {
  it('키보드가 없으면 카드를 움직이지 않는다', () => {
    expect(resolveDialogKeyboardOffset({ ...LAYOUT, keyboardHeight: 0 })).toBe(0);
  });

  it('키보드가 카드를 가리지 않으면 움직이지 않는다', () => {
    expect(resolveDialogKeyboardOffset({ ...LAYOUT, keyboardHeight: 200 })).toBe(0);
    expect(resolveDialogKeyboardOffset({ ...LAYOUT, keyboardHeight: 323 })).toBe(0);
  });

  it('가린 만큼만 올린다', () => {
    expect(resolveDialogKeyboardOffset({ ...LAYOUT, keyboardHeight: 336 })).toBe(-13);
    expect(resolveDialogKeyboardOffset({ ...LAYOUT, keyboardHeight: 400 })).toBe(-77);
  });

  it('키보드가 커져도 가린 양을 넘겨 올리지 않는다', () => {
    const keyboardHeight = 600;
    const offset = resolveDialogKeyboardOffset({ ...LAYOUT, keyboardHeight });

    expect(Math.abs(offset)).toBeLessThan(keyboardHeight);
    expect(offset).toBe(-(keyboardHeight - resolveDialogSlack(LAYOUT)));
  });

  it('카드를 아직 재지 못했으면 여유를 크게 잡아 섣불리 움직이지 않는다', () => {
    // onLayout 전에는 cardHeight가 0이다. 이때 움직이면 열리는 순간 카드가 튄다.
    expect(
      resolveDialogKeyboardOffset({ screenHeight: 874, cardHeight: 0, keyboardHeight: 336 }),
    ).toBe(0);
  });

  it('카드가 화면을 가득 채우면 여유가 없어 키보드 높이만큼 올린다', () => {
    expect(resolveDialogSlack({ screenHeight: 400, cardHeight: 400 })).toBe(0);
    expect(
      resolveDialogKeyboardOffset({ screenHeight: 400, cardHeight: 400, keyboardHeight: 300 }),
    ).toBe(-300);
  });
});
