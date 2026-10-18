import { Buffer } from "node:buffer";
import type { Cipher } from "../session/vault";

/** Structural adapter: only the Electron bridge supplies the actual safeStorage object. */
export interface SafeStorageBridge {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Uint8Array;
  decryptString(value: Buffer): string;
  getSelectedStorageBackend?(): string;
}

export type CredentialStoreProvider = "dpapi" | "keychain" | "gnome-libsecret" | "kwallet" | "kwallet5" | "kwallet6" | "basic_text" | "unknown";
export interface CredentialStoreStatus {
  available: boolean;
  reason: "available" | "unavailable" | "insecure-backend";
  provider: CredentialStoreProvider;
}
export interface CredentialStore extends Cipher {
  status(): CredentialStoreStatus;
}

const linuxProviders: Readonly<Record<string, CredentialStoreProvider>> = Object.freeze({
  gnome_libsecret: "gnome-libsecret", kwallet: "kwallet", kwallet5: "kwallet5", kwallet6: "kwallet6", basic_text: "basic_text",
});

/** Never downgrades to plaintext, including a keyring that disappears after startup. */
export function createCredentialStore(safeStorage: SafeStorageBridge, options: { platform: NodeJS.Platform }): CredentialStore {
  const status = (): CredentialStoreStatus => {
    let provider: CredentialStoreProvider = options.platform === "win32" ? "dpapi" : options.platform === "darwin" ? "keychain" : "unknown";
    try {
      if (options.platform === "linux") {
        const backend = safeStorage.getSelectedStorageBackend?.();
        provider = backend && Object.hasOwn(linuxProviders, backend) ? linuxProviders[backend] : "unknown";
        if (provider === "basic_text") return { available: false, reason: "insecure-backend", provider };
      }
      const available = safeStorage.isEncryptionAvailable() === true && provider !== "unknown";
      return { available, reason: available ? "available" : "unavailable", provider };
    } catch { return { available: false, reason: "unavailable", provider }; }
  };
  const ensureAvailable = () => { if (!status().available) throw new Error("secure_storage_unavailable"); };
  return Object.freeze({
    status,
    isAvailable: () => status().available,
    encrypt(value: string): Uint8Array {
      ensureAvailable();
      try { return safeStorage.encryptString(value); }
      catch { throw new Error("secure_storage_unavailable"); }
    },
    decrypt(value: Uint8Array): string {
      ensureAvailable();
      try { return safeStorage.decryptString(Buffer.from(value)); }
      catch { throw new Error("secure_storage_unavailable"); }
    },
  });
}
