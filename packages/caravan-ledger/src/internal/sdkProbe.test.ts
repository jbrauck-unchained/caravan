describe("bundler-transformed Ledger package-root imports", () => {
  it("resolve through Vite without reading browser globals or requesting a device", async () => {
    const globalNames = ["window", "navigator"] as const;
    const originalDescriptors = new Map(
      globalNames.map((name) => [
        name,
        Object.getOwnPropertyDescriptor(globalThis, name),
      ])
    );

    for (const name of globalNames) {
      const original = originalDescriptors.get(name);

      if (original && !original.configurable) {
        throw new Error(`Cannot instrument non-configurable global: ${name}`);
      }

      Object.defineProperty(globalThis, name, {
        configurable: true,
        get() {
          throw new Error(`Ledger package read ${name} during evaluation`);
        },
      });
    }

    try {
      await expect(import("./sdkProbe")).resolves.toBeDefined();
    } finally {
      for (const name of globalNames) {
        const original = originalDescriptors.get(name);

        if (original) {
          Object.defineProperty(globalThis, name, original);
        } else {
          Reflect.deleteProperty(globalThis, name);
        }
      }
    }
  });
});
