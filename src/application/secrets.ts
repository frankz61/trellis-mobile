import type { CredentialStore } from '../repositories/contracts';

interface SecretChange<T> {
  credentials: CredentialStore;
  // The reference currently committed in settings.
  previousRef: string | null;
  // The reference to commit when no new key is given (the previous one, or null to drop it).
  keptRef: string | null;
  // The newly entered key; empty keeps `keptRef`.
  key: string;
  createRef: () => string;
  commit: (ref: string | null) => Promise<T>;
}

// Write a new secret first, then atomically switch the SQLite reference, then delete the old secret.
// If the process dies between stores, the previous configuration still works; if the commit fails,
// the uncommitted secret is removed again.
export async function commitWithSecret<T>({ credentials, previousRef, keptRef, key, createRef, commit }: SecretChange<T>): Promise<T> {
  const ref = key ? createRef() : keptRef;
  if (key && ref) await credentials.set(ref, key);
  let result: T;
  try {
    result = await commit(ref);
  } catch (error) {
    if (key && ref) await credentials.remove(ref).catch(() => undefined);
    throw error;
  }
  if (previousRef && previousRef !== ref) {
    // Best-effort cleanup after the committed reference changes.
    await credentials.remove(previousRef).catch(() => undefined);
  }
  return result;
}
