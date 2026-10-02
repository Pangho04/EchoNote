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
import { type ReactNode, useState } from 'react';
import { Pressable, View } from 'react-native';

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
  children: ReactNode;
}

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
