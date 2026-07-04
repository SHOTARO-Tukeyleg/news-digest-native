/* AsyncStorage JSON helpers */
import AsyncStorage from "@react-native-async-storage/async-storage";

export async function jget<T>(key: string): Promise<T | null> {
  try {
    const s = await AsyncStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch {
    return null;
  }
}

export async function jset(key: string, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota/serialization errors */
  }
}

export async function jdel(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
  } catch {}
}

export async function prefixGetAll<T>(prefix: string): Promise<{ key: string; value: T }[]> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
    const out: { key: string; value: T }[] = [];
    for (const k of keys) {
      const v = await AsyncStorage.getItem(k);
      if (v) {
        try {
          out.push({ key: k, value: JSON.parse(v) as T });
        } catch {}
      }
    }
    return out;
  } catch {
    return [];
  }
}
