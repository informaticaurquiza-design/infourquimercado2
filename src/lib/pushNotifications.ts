export type PushPermissionState = NotificationPermission | 'unsupported';

export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getPushPermission(): PushPermissionState {
  if (!isPushSupported()) return 'unsupported';
  return Notification.permission;
}

export async function requestPushPermission(): Promise<PushPermissionState> {
  if (!isPushSupported()) return 'unsupported';
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

export function sendBrowserPush(title: string, body: string, tag?: string): boolean {
  if (!isPushSupported() || Notification.permission !== 'granted') {
    return false;
  }
  try {
    new Notification(title, {
      body,
      tag: tag || `alba-${Date.now()}`,
      silent: false,
    });
    return true;
  } catch {
    return false;
  }
}
