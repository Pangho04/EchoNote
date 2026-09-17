// 카드와 키보드 사이에 남길 최소 간격.
const KEYBOARD_GAP = 24;

export interface DialogKeyboardLayout {
  // 화면 전체 높이다. Modal 프레임은 키보드에 따라 줄어들 수 있어 재지 않는다.
  screenHeight: number;
  cardHeight: number;
}

// 카드를 중앙에 뒀을 때 카드 아래에 남는 여유다. 키보드가 이보다 낮으면 카드를 움직이지 않는다.
export function resolveDialogSlack({ screenHeight, cardHeight }: DialogKeyboardLayout): number {
  return Math.max(0, (screenHeight - cardHeight) / 2 - KEYBOARD_GAP);
}

// 키보드가 카드를 가리는 만큼만 올린다. 가리지 않으면 0을 돌려 제자리에 둔다.
export function resolveDialogKeyboardOffset(
  layout: DialogKeyboardLayout & { keyboardHeight: number },
): number {
  const covered = layout.keyboardHeight - resolveDialogSlack(layout);

  if (covered <= 0) return 0;

  return -covered;
}
