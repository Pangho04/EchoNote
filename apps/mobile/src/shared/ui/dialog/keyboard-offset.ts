// 키보드 위로 남길 최소 간격.
const KEYBOARD_GAP = 24;

export interface DialogKeyboardLayout {
  backdropHeight: number;
  cardHeight: number;
}

// 카드를 중앙에 뒀을 때 카드 아래에 남는 여유다. 키보드가 이보다 낮으면 카드를 움직이지 않는다.
export function resolveDialogSlack({ backdropHeight, cardHeight }: DialogKeyboardLayout): number {
  return Math.max(1, (backdropHeight - cardHeight) / 2 - KEYBOARD_GAP);
}

// 키보드가 카드를 가리는 만큼만 올린다. 그보다 더 올리면 제목이 화면 위로 잘린다.
export function resolveDialogKeyboardOffset(
  layout: DialogKeyboardLayout & { keyboardHeight: number },
): number {
  const slack = resolveDialogSlack(layout);
  const covered = layout.keyboardHeight - slack;

  if (covered <= 0) return 0;

  return -covered;
}
