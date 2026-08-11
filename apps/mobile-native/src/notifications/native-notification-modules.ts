/** Native module boundary kept separate so adapter behavior can be deterministically unit tested. */
export {
  getMessaging,
  getInitialNotification,
  getToken,
  isDeviceRegisteredForRemoteMessages,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  registerDeviceForRemoteMessages,
  type Messaging
} from "@react-native-firebase/messaging";
export * as Network from "expo-network";
export * as Notifications from "expo-notifications";
export { Linking, Platform } from "react-native";
