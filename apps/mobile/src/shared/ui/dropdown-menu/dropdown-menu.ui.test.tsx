import { Button, Image, Popover, ScrollView } from '@expo/ui/swift-ui';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { DropdownMenu, type DropdownMenuOption } from './dropdown-menu';

const mockedButton = jest.mocked(Button);
const mockedImage = jest.mocked(Image);
const mockedPopover = jest.mocked(Popover);
const mockedScrollView = jest.mocked(ScrollView);

const YEARS: DropdownMenuOption[] = [
  { id: '2026', label: '2026년', selected: true },
  { id: '2025', label: '2025년', selected: false },
];

function renderMenu(
  props: {
    options?: DropdownMenuOption[];
    onSelect?: (id: string) => void;
    disabled?: boolean;
  } = {},
) {
  const { options = YEARS, onSelect = jest.fn(), disabled } = props;

  return render(
    <DropdownMenu
      accessibilityLabel="연도"
      disabled={disabled}
      onSelect={onSelect}
      options={options}
    >
      <Text>트리거</Text>
    </DropdownMenu>,
  );
}

describe('DropdownMenu (iOS)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('트리거를 누르면 항목을 연다', async () => {
    const { getByLabelText, queryAllByRole } = await renderMenu();

    expect(queryAllByRole('menuitem')).toHaveLength(0);

    await fireEvent.press(getByLabelText('연도'));

    expect(queryAllByRole('menuitem')).toHaveLength(2);
  });

  it('선택 항목에만 체크 표시와 선택 상태를 붙인다', async () => {
    const { getByLabelText, getAllByRole } = await renderMenu();

    await fireEvent.press(getByLabelText('연도'));

    // 마지막 렌더의 행이 options 순서대로 호출 기록 끝에 남는다.
    const traits = mockedButton.mock.calls
      .slice(-YEARS.length)
      .map(([props]) =>
        props.modifiers?.filter((modifier) => modifier.$type === 'accessibilityAddTraits'),
      );

    expect(traits).toEqual([[{ $type: 'accessibilityAddTraits', traits: ['isSelected'] }], []]);
    expect(mockedImage.mock.calls.map(([props]) => props.systemName)).toEqual(['checkmark']);
    expect(getAllByRole('menuitem')[0]).toHaveTextContent('2026년');
  });

  it('항목을 누르면 onSelect(id)를 호출하고 닫는다', async () => {
    const onSelect = jest.fn();
    const { getByLabelText, getByText, queryAllByRole } = await renderMenu({ onSelect });

    await fireEvent.press(getByLabelText('연도'));
    await fireEvent.press(getByText('2025년'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('2025');
    expect(queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('바깥을 눌러 시스템이 닫으면 닫힌 상태를 따른다', async () => {
    const { getByLabelText, queryAllByRole } = await renderMenu();

    await fireEvent.press(getByLabelText('연도'));
    await act(() => mockedPopover.mock.calls.at(-1)![0].onIsPresentedChange?.(false));

    expect(queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('disabled면 트리거만 그리고 누름에 반응하지 않는다', async () => {
    const { getByLabelText, queryAllByRole } = await renderMenu({ disabled: true });

    expect(getByLabelText('연도')).toBeDisabled();

    await fireEvent.press(getByLabelText('연도'));

    expect(mockedPopover).not.toHaveBeenCalled();
    expect(queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('열린 채 비활성됐다가 다시 활성되면 닫힌 상태로 돌아온다', async () => {
    const { getByLabelText, queryAllByRole, rerender } = await renderMenu();

    await fireEvent.press(getByLabelText('연도'));
    await rerender(
      <DropdownMenu accessibilityLabel="연도" disabled onSelect={jest.fn()} options={YEARS}>
        <Text>트리거</Text>
      </DropdownMenu>,
    );
    await rerender(
      <DropdownMenu accessibilityLabel="연도" onSelect={jest.fn()} options={YEARS}>
        <Text>트리거</Text>
      </DropdownMenu>,
    );

    expect(queryAllByRole('menuitem')).toHaveLength(0);
  });

  it.each([
    [2, 88],
    [57, 198],
  ])('항목 %i개면 메뉴 높이는 %ipt다', async (count, expected) => {
    const options = Array.from({ length: count }, (_, index) => ({
      id: String(index),
      label: `${index}`,
      selected: false,
    }));
    const { getByLabelText } = await renderMenu({ options });

    await fireEvent.press(getByLabelText('연도'));

    const frameOf = mockedScrollView.mock.calls
      .at(-1)![0]
      .modifiers?.find((modifier) => modifier.$type === 'frame');

    expect(frameOf).toMatchObject({ height: expected });
  });

  it('함수 children이 렌더된다', async () => {
    const { getByText } = await render(
      <DropdownMenu accessibilityLabel="연도" onSelect={jest.fn()} options={YEARS}>
        {() => <Text>함수 트리거</Text>}
      </DropdownMenu>,
    );

    expect(getByText('함수 트리거')).toBeOnTheScreen();
  });

  it('disabled면서 함수 children이 렌더된다', async () => {
    const { getByText } = await render(
      <DropdownMenu accessibilityLabel="연도" disabled onSelect={jest.fn()} options={YEARS}>
        {() => <Text>함수 트리거</Text>}
      </DropdownMenu>,
    );

    expect(getByText('함수 트리거')).toBeOnTheScreen();
  });
});
