import {
  DeviceManagementKitBuilder,
  GenuineCheckDeviceAction,
  InstallAppDeviceAction,
  ListInstalledAppsDeviceAction,
  OpenAppDeviceAction,
} from "@ledgerhq/device-management-kit";
import { webHidTransportFactory } from "@ledgerhq/device-transport-kit-web-hid";
import { Observable } from "rxjs";

// Keep these runtime imports private. Vitest's Vite transform proves that the
// exact supported package roots resolve as bundler-transformed source without
// constructing a kit, transport, action, observable, or browser permission
// request. This is deliberately neither a native-Node import proof nor the
// consumer browser-bundle proof; the pinned Ledger ESM artifacts contain
// unsupported directory imports.
const ledgerRootApiImports = Object.freeze([
  DeviceManagementKitBuilder,
  GenuineCheckDeviceAction,
  InstallAppDeviceAction,
  ListInstalledAppsDeviceAction,
  OpenAppDeviceAction,
  webHidTransportFactory,
  Observable,
]);

if (ledgerRootApiImports.some((rootExport) => typeof rootExport !== "function")) {
  throw new Error("The reviewed Ledger package-root API is unavailable");
}
