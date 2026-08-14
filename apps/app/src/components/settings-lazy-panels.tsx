import { lazy } from "react";

function lazyNamed<
  T extends Record<K, React.ComponentType<any>>,
  K extends keyof T,
>(loader: () => Promise<T>, name: K) {
  return lazy(async () => ({ default: (await loader())[name] }));
}

const settingsSectionLoaders = {
  account: () => import("./SettingsAccountSection"),
  "device-tokens": () => import("./DeviceTokensPanel"),
  interface: () => import("./InterfaceSettings"),
  memories: () => import("./PersonalContentPanel"),
  notes: () => import("./PersonalContentPanel"),
  notifications: () => import("./NotificationPanel"),
  security: () => import("./SettingsSecuritySection"),
} as const;

export async function preloadSettingsSection(section: string): Promise<void> {
  if (!(section in settingsSectionLoaders)) return;
  await settingsSectionLoaders[
    section as keyof typeof settingsSectionLoaders
  ]();
}

export const DeviceTokensPanel = lazyNamed(
  settingsSectionLoaders["device-tokens"],
  "DeviceTokensPanel",
);
export const InterfaceSettings = lazyNamed(
  settingsSectionLoaders.interface,
  "InterfaceSettings",
);
export const NotificationPanel = lazyNamed(
  settingsSectionLoaders.notifications,
  "NotificationPanel",
);
export const PersonalContentPanel = lazyNamed(
  settingsSectionLoaders.memories,
  "PersonalContentPanel",
);
export const SettingsAccountSection = lazyNamed(
  settingsSectionLoaders.account,
  "SettingsAccountSection",
);
export const SettingsSecuritySection = lazyNamed(
  settingsSectionLoaders.security,
  "SettingsSecuritySection",
);
