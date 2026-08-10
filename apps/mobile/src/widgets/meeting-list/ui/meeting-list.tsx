import { FlatList, StyleSheet, View } from 'react-native';

import type { MeetingListItemVM } from '@/entities/meeting';
import { MeetingListItem } from '@/entities/meeting';
import { AppText } from '@/shared/ui/app-text';
import { createThemedStyles } from '@/shared/ui/theme-provider';

type Props = {
  items: MeetingListItemVM[];
};

export function MeetingList({ items }: Props) {
  const styles = useStyle();

  return (
    <View style={styles.container}>
      <AppText color="textSecondary" style={styles.sectionLabel} variant="caption">
        최근 기록
      </AppText>
      <FlatList
        style={styles.list}
        data={items}
        renderItem={({ item }) => <MeetingListItem item={item} />}
        keyExtractor={(item) => item.id}
      />
    </View>
  );
}

const useStyle = createThemedStyles((theme) =>
  StyleSheet.create({
    container: {
      flex: 1,
    },
    sectionLabel: {
      marginTop: theme.spacing[6],
      marginHorizontal: 18,
      marginBottom: theme.spacing[2],
      fontWeight: theme.typography.fontWeight.bold,
    },
    list: {
      flex: 1,

      borderTopColor: theme.colors.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.colors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
  }),
);
