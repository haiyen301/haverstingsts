/**
 * Mobile push notification contract — mirrors Flutter stsapp:
 * - `lib/core/helper/notification_helper.dart` (FCM data keys, Android channel)
 * - `lib/core/utils/url_container.dart` (token registration endpoint)
 * - `lib/core/helper/device_registration_helper.dart` (device sync; uses `package_info_plus` for app_version)
 * - `lib/data/controller/auth/login_controller.dart` (login → force device sync)
 *
 * Update this file when the mobile app changes its FCM payload or channel settings.
 * PHP `App\Libraries\AlertMobilePush` reads the same field names documented here.
 */
export const MOBILE_PUSH_NOTIFICATION_CONFIG = {
  firebase: {
    projectId: "stsgroup-7fb38",
    serviceAccountFile: "stsgroup-service-account.json",
    tokenRegisterPath: "firebaseconfig/save_cm_firebase_token",
    tokenRegisterField: "cm_firebase_token",
    deviceUuidField: "device_uuid",
    platformField: "platform",
    userMetaKey: "user_cm_firebase_token",
    devicesTable: "sts_user_notification_devices",
  },
  android: {
    channelId: "stsgroup",
    channelName: "STS Portal",
    notificationIcon: "notification_icon",
    sound: "notification",
  },
  /** Keys inside FCM `data` — Flutter `NotificationHelper.showNotification` reads these. */
  fcmDataKeys: {
    title: "title",
    description: "description",
    type: "type",
    image: "image",
    orderId: "order_id",
    countNotifications: "count_notifications",
    clickAction: "click_action",
    alertId: "alert_id",
    eventId: "event_id",
    href: "href",
    action: "action",
  },
  notificationTypes: {
    alert: "my_alert",
    created: "my_alert_created",
    updated: "my_alert_updated",
    deleted: "my_alert_deleted",
  },
  defaults: {
    systemNotificationTitle: "Sports Turf Solutions",
    clickAction: "FLUTTER_NOTIFICATION_CLICK",
    pushMobile: true,
    pushWeb: true,
    pushEmail: false,
  },
} as const;

export type MobilePushAlertAction = "created" | "updated" | "deleted";

export function mobilePushTypeForAction(action: MobilePushAlertAction): string {
  const types = MOBILE_PUSH_NOTIFICATION_CONFIG.notificationTypes;
  switch (action) {
    case "created":
      return types.created;
    case "updated":
      return types.updated;
    case "deleted":
      return types.deleted;
    default:
      return types.alert;
  }
}
