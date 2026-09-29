import * as SecureStore from 'expo-secure-store';
import type { CredentialStore } from '../../repositories/contracts';

export const credentials: CredentialStore = {
  get: (ref) => SecureStore.getItemAsync(ref),
  set: (ref, value) => SecureStore.setItemAsync(ref, value),
  remove: (ref) => SecureStore.deleteItemAsync(ref),
};
