import * as SecureStore from 'expo-secure-store';

import type { AuthStorage } from '@/shared/api/supabase-client';

export const secureStoreAdapter: AuthStorage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};
