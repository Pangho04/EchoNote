import type { CSSProperties } from 'react';
import { StyleSheet, View } from 'react-native';

import type { DropdownMenuProps } from './dropdown-menu';

// 네이티브 메뉴가 없어 트리거 위에 투명 select를 겹쳐 OS 선택 UI를 그대로 빌린다.
const selectStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  opacity: 0,
  cursor: 'pointer',
};

export function DropdownMenu({
  options,
  onSelect,
  disabled,
  accessibilityLabel,
  children,
}: DropdownMenuProps) {
  const selectedId = options.find((option) => option.selected)?.id;

  return (
    <View style={styles.container}>
      <View
        accessibilityLabel={accessibilityLabel}
        accessibilityRole="button"
        accessibilityState={{ disabled }}
        accessible
      >
        {children}
      </View>

      <select
        aria-label={accessibilityLabel}
        disabled={disabled}
        onChange={(event) => onSelect(event.target.value)}
        style={selectStyle}
        value={selectedId}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
});
