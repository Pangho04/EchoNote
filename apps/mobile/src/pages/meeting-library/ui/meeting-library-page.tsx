import { StyleSheet, Text, View } from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

export function MeetingLibraryPage() {
  return (
    <SafeAreaView edges={['top']} style={styles.safeArea}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          회의
        </Text>
      </View>
      <View style={styles.content} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  content: {
    backgroundColor: '#F2F2F7',
    flex: 1,
  },
  header: {
    backgroundColor: '#FFFFFF',
    borderBottomColor: '#E5E5EA',
    borderBottomWidth: StyleSheet.hairlineWidth,
    justifyContent: 'flex-end',
    minHeight: 64,
    paddingBottom: 9,
    paddingHorizontal: 18,
    paddingTop: 10,
  },
  safeArea: {
    backgroundColor: '#FFFFFF',
    flex: 1,
  },
  title: {
    color: '#161617',
    fontSize: 30,
    fontWeight: '700',
    lineHeight: 36,
  },
});
