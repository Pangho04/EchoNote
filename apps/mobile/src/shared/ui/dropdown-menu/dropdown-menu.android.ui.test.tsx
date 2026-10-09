import {
  Column,
  DropdownMenu as MaterialDropdownMenu,
  DropdownMenuItem,
} from '@expo/ui/jetpack-compose';
import { act, fireEvent, render } from '@testing-library/react-native';
import type * as ReactModule from 'react';
import type * as ReactNativeModule from 'react-native';
import { Text } from 'react-native';

import type { DropdownMenuOption } from './dropdown-menu';
import { DropdownMenu } from './dropdown-menu.android';

// jest 기본 플랫폼이 ios라 Compose 부품은 이 파일에서만 RN 요소로 대신한다.
// Items 슬롯은 expanded일 때만 그려 열림·닫힘을 화면 조회로 확인할 수 있게 한다.
jest.mock('@expo/ui/jetpack-compose', () => {
  const { Children, createElement, Fragment, isValidElement } =
    jest.requireActual<typeof ReactModule>('react');
  const { Pressable, Text: RNText } = jest.requireActual<typeof ReactNativeModule>('react-native');

  const passThrough = ({ children }: { children?: ReactModule.ReactNode }) =>
    createElement(Fragment, null, children);
  const Items = jest.fn(passThrough);

  const DropdownMenu = Object.assign(
    jest.fn(({ expanded, children }: { expanded?: boolean; children?: ReactModule.ReactNode }) =>
      createElement(
        Fragment,
        null,
        Children.map(children, (child) =>
          isValidElement(child) && child.type === Items && !expanded ? null : child,
        ),
      ),
    ),
    { Trigger: passThrough, Items },
  );

  const DropdownMenuItem = Object.assign(
    jest.fn(({ onClick, children }: { onClick?: () => void; children?: ReactModule.ReactNode }) =>
      createElement(Pressable, { accessibilityRole: 'menuitem', onPress: onClick }, children),
    ),
    { Text: passThrough, TrailingIcon: passThrough },
  );

  return {
    Column: jest.fn(passThrough),
    DropdownMenu,
    DropdownMenuItem,
    Host: passThrough,
    RNHostView: passThrough,
    Text: ({ children }: { children?: ReactModule.ReactNode }) =>
      createElement(RNText, null, children),
  };
});

const mockedColumn = jest.mocked(Column);
const mockedMaterialDropdownMenu = jest.mocked(MaterialDropdownMenu);
const mockedDropdownMenuItem = jest.mocked(DropdownMenuItem);

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

describe('DropdownMenu (Android)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('트리거를 누르면 항목을 연다', async () => {
    const { getByLabelText, queryAllByRole } = await renderMenu();

    expect(queryAllByRole('menuitem')).toHaveLength(0);

    await fireEvent.press(getByLabelText('연도'));

    expect(queryAllByRole('menuitem')).toHaveLength(2);
  });

  it('선택 항목에만 체크 표시와 선택 낭독 문구를 붙인다', async () => {
    const { getByLabelText, getAllByRole } = await renderMenu();

    await fireEvent.press(getByLabelText('연도'));

    // 마지막 렌더의 행이 options 순서대로 호출 기록 끝에 남는다.
    const semantics = mockedDropdownMenuItem.mock.calls
      .slice(-YEARS.length)
      .map(([props]) => props.modifiers?.filter((modifier) => modifier.$type === 'semantics'));
    const [selectedRow, otherRow] = getAllByRole('menuitem');

    expect(semantics).toEqual([[{ $type: 'semantics', contentDescription: '2026년, 선택됨' }], []]);
    expect(selectedRow).toHaveTextContent('2026년✓');
    expect(otherRow).toHaveTextContent('2025년');
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

  it('바깥 누름·뒤로가기로 시스템이 닫으면 닫힌 상태를 따른다', async () => {
    const { getByLabelText, queryAllByRole } = await renderMenu();

    await fireEvent.press(getByLabelText('연도'));
    await act(() => mockedMaterialDropdownMenu.mock.calls.at(-1)![0].onDismissRequest?.());

    expect(queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('disabled면 트리거만 그리고 누름에 반응하지 않는다', async () => {
    const { getByLabelText, queryAllByRole } = await renderMenu({ disabled: true });

    expect(getByLabelText('연도')).toBeDisabled();

    await fireEvent.press(getByLabelText('연도'));

    expect(mockedMaterialDropdownMenu).not.toHaveBeenCalled();
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
    [2, 96],
    [57, 216],
  ])('항목 %i개면 메뉴 높이는 %idp다', async (count, expected) => {
    const options = Array.from({ length: count }, (_, index) => ({
      id: String(index),
      label: `${index}`,
      selected: false,
    }));
    const { getByLabelText } = await renderMenu({ options });

    await fireEvent.press(getByLabelText('연도'));

    expect(mockedColumn.mock.calls.at(-1)![0].modifiers?.slice(0, 2)).toEqual([
      { $type: 'height', height: expected },
      { $type: 'verticalScroll' },
    ]);
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
