declare const hidDeviceIdentityBrand: unique symbol;

/** Opaque in-memory identity used only to compare browser snapshots. */
export interface HidDeviceIdentity {
  readonly [hidDeviceIdentityBrand]: never;
}

/** A package-owned reduction of a granted browser HID device. */
export interface HidDeviceSnapshot {
  readonly identity: HidDeviceIdentity;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName?: string;
  readonly opened: boolean;
}

/** Read-only browser seam used to prove release without force-closing devices. */
export interface HidPort {
  getGrantedDevices(): Promise<readonly HidDeviceSnapshot[]>;
}
