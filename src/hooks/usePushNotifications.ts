import { useCallback, useEffect, useState } from "react";
import { subscribeForPush, syncPushSubscription, unsubscribeFromPush, isPushSupported } from "../services/notificationService";

/**
 * usePushNotifications — push state + actions bound to the current session.
 */
export function usePushNotifications() {
  const [supported] = useState<boolean>(() => isPushSupported());
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    () => (isPushSupported() ? Notification.permission : "unsupported"),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!supported) return;
    const onPerm = () => setPermission(Notification.permission);
    window.addEventListener("change", onPerm);
    return () => window.removeEventListener("change", onPerm);
  }, [supported]);

  // Re-attach any existing subscription after session changes.
  useEffect(() => {
    if (!supported || Notification.permission !== "granted") return;
    void syncPushSubscription();
  }, [supported]);

  const enable = useCallback(async (): Promise<boolean> => {
    setBusy(true);
    try {
      const ok = await subscribeForPush();
      setPermission(Notification.permission);
      return ok;
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    try {
      await unsubscribeFromPush();
      setPermission(Notification.permission);
    } finally {
      setBusy(false);
    }
  }, []);

  return { supported, permission, busy, enable, disable };
}