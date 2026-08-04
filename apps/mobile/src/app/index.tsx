import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function HomeScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.productName}>EchoNote</Text>
      <Text style={styles.status}>RN 개발 골격 준비 완료</Text>
      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    backgroundColor: '#f7f7f5',
    flex: 1,
    justifyContent: 'center',
    padding: 24,
  },
  productName: {
    color: '#171717',
    fontSize: 32,
    fontWeight: '700',
  },
  status: {
    color: '#5b5b57',
    fontSize: 15,
    marginTop: 8,
  },
});
