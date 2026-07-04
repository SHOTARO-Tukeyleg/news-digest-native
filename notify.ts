/* Local notifications (expo-notifications).
   Works in Expo Go for LOCAL notifications; remote push is NOT available in Expo Go. */
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function ensurePermission(): Promise<boolean> {
  try {
    const cur = await Notifications.getPermissionsAsync();
    if (cur.granted) return true;
    const req = await Notifications.requestPermissionsAsync();
    return !!req.granted;
  } catch {
    return false;
  }
}

const DIGEST_ID = "morning-digest";

export async function scheduleDailyDigest(hour: number, minute: number, title: string, body: string): Promise<boolean> {
  try {
    await cancelDigest();
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("digest", {
        name: "Morning Digest",
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    await Notifications.scheduleNotificationAsync({
      identifier: DIGEST_ID,
      content: { title, body },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function cancelDigest(): Promise<void> {
  try {
    await Notifications.cancelScheduledNotificationAsync(DIGEST_ID);
  } catch {}
}

export async function presentNow(title: string, body: string): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: null,
    });
  } catch {}
}
