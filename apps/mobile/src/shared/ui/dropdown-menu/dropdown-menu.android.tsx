import {
  Column,
  DropdownMenu as MaterialDropdownMenu,
  DropdownMenuItem,
  Host,
  RNHostView,
  Text,
} from '@expo/ui/jetpack-compose';
import { height, semantics, verticalScroll } from '@expo/ui/jetpack-compose/modifiers';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { UI_STRINGS } from '@/shared/config/ui-strings';

import type { DropdownMenuProps } from './dropdown-menu';

const ROW_HEIGHT = 48;

// 정수 행 수로 자르면 목록이 끝난 것처럼 보이므로 반 행을 걸쳐 스크롤할 항목이 더 있음을 드러낸다.
const VISIBLE_ROWS = 4.5;

export function DropdownMenu({ disabled, ...props }: DropdownMenuProps) {
  if (disabled) {
    return (
      <View
        accessibilityLabel={props.accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessible
      >
        {props.children}
      </View>
    );
  }

  // 비활성 동안 언마운트해 다시 활성될 때 열림 상태가 남지 않게 한다.
  return <OpenableMenu {...props} />;
}

function OpenableMenu({
  options,
  onSelect,
  accessibilityLabel,
  children,
}: Omit<DropdownMenuProps, 'disabled'>) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Host matchContents>
      <MaterialDropdownMenu expanded={isOpen} onDismissRequest={() => setIsOpen(false)}>
        <MaterialDropdownMenu.Trigger>
          <RNHostView matchContents>
            <Pressable
              accessibilityLabel={accessibilityLabel}
              accessibilityRole="button"
              onPress={() => setIsOpen(true)}
            >
              {children}
            </Pressable>
          </RNHostView>
        </MaterialDropdownMenu.Trigger>
        <MaterialDropdownMenu.Items>
          {/* height가 verticalScroll보다 앞서야 스크롤 영역이 그 높이로 묶인다. */}
          <Column
            modifiers={[
              height(Math.min(options.length, VISIBLE_ROWS) * ROW_HEIGHT),
              verticalScroll(),
            ]}
          >
            {options.map((option) => (
              <DropdownMenuItem
                key={option.id}
                modifiers={[
                  height(ROW_HEIGHT),
                  ...(option.selected
                    ? [
                        semantics({
                          contentDescription: `${option.label}, ${UI_STRINGS.common.selected}`,
                        }),
                      ]
                    : []),
                ]}
                onClick={() => {
                  onSelect(option.id);
                  setIsOpen(false);
                }}
              >
                <DropdownMenuItem.Text>
                  <Text>{option.label}</Text>
                </DropdownMenuItem.Text>
                {option.selected ? (
                  <DropdownMenuItem.TrailingIcon>
                    <Text>{UI_STRINGS.common.selectedMark}</Text>
                  </DropdownMenuItem.TrailingIcon>
                ) : null}
              </DropdownMenuItem>
            ))}
          </Column>
        </MaterialDropdownMenu.Items>
      </MaterialDropdownMenu>
    </Host>
  );
}
