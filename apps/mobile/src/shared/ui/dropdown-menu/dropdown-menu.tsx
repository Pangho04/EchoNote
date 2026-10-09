import {
  Button,
  Host,
  HStack,
  Image,
  Popover,
  RNHostView,
  ScrollView,
  Spacer,
  Text,
  VStack,
} from '@expo/ui/swift-ui';
import {
  accessibilityAddTraits,
  accessibilityHidden,
  buttonStyle,
  contentShape,
  frame,
  padding,
  shapes,
} from '@expo/ui/swift-ui/modifiers';
import { useState } from 'react';
import { Pressable, type PressableProps, View } from 'react-native';

import { spacing } from '@/shared/config/theme';

const ROW_HEIGHT = 44;
const MENU_MIN_WIDTH = 96;

// 정수 행 수로 자르면 목록이 끝난 것처럼 보이므로 반 행을 걸쳐 스크롤할 항목이 더 있음을 드러낸다.
const VISIBLE_ROWS = 4.5;

export interface DropdownMenuOption {
  id: string;
  label: string;
  selected: boolean;
}

export interface DropdownMenuProps {
  options: DropdownMenuOption[];
  onSelect: (id: string) => void;
  disabled?: boolean;
  accessibilityLabel: string;
  children: PressableProps['children'];
}

// 두 플랫폼 tsconfig가 PressableStateCallbackType을 서로 다른 선언으로 가져와, 리터럴로
// 넘기면 한쪽에선 초과 속성으로 다른 쪽에선 누락 속성으로 막힌다. 변수로 감싸 양쪽을 만족시킨다.
const notPressedState = { pressed: false, hovered: false };

export function DropdownMenu({ disabled, ...props }: DropdownMenuProps) {
  if (disabled) {
    return (
      <View
        accessibilityLabel={props.accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessible
      >
        {typeof props.children === 'function' ? props.children(notPressedState) : props.children}
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
      <Popover isPresented={isOpen} onIsPresentedChange={setIsOpen}>
        <Popover.Trigger>
          <RNHostView matchContents>
            <Pressable
              accessibilityLabel={accessibilityLabel}
              accessibilityRole="button"
              onPress={() => setIsOpen(true)}
            >
              {children}
            </Pressable>
          </RNHostView>
        </Popover.Trigger>
        <Popover.Content>
          <ScrollView
            modifiers={[
              frame({
                minWidth: MENU_MIN_WIDTH,
                height: Math.min(options.length, VISIBLE_ROWS) * ROW_HEIGHT,
              }),
            ]}
          >
            <VStack spacing={0}>
              {options.map((option) => (
                <Button
                  key={option.id}
                  modifiers={[
                    buttonStyle('plain'),
                    ...(option.selected ? [accessibilityAddTraits(['isSelected'])] : []),
                  ]}
                  onPress={() => {
                    onSelect(option.id);
                    setIsOpen(false);
                  }}
                >
                  <HStack
                    modifiers={[
                      frame({ height: ROW_HEIGHT }),
                      padding({ horizontal: spacing[3] }),
                      contentShape(shapes.rectangle()),
                    ]}
                  >
                    <Text>{option.label}</Text>
                    <Spacer />
                    {option.selected ? (
                      <Image modifiers={[accessibilityHidden()]} systemName="checkmark" />
                    ) : null}
                  </HStack>
                </Button>
              ))}
            </VStack>
          </ScrollView>
        </Popover.Content>
      </Popover>
    </Host>
  );
}
