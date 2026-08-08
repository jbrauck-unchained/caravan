import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: {
    entry: {
      index: "src/index.ts",
    },
  },
  entry: {
    browser: "src/browser.ts",
    index: "src/index.ts",
  },
  external: [
    "@ledgerhq/device-management-kit",
    "@ledgerhq/device-transport-kit-web-hid",
    "rxjs",
  ],
  format: ["esm"],
  platform: "browser",
  sourcemap: false,
  splitting: false,
  target: "es2022",
  treeshake: true,
});
