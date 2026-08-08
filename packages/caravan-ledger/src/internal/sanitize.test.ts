import { readReviewedErrorTag } from "./sanitize";

describe("readReviewedErrorTag", () => {
  it("reads only an own string data property", () => {
    expect(readReviewedErrorTag({ _tag: "DeviceLockedError" })).toBe(
      "DeviceLockedError",
    );
    expect(readReviewedErrorTag({ _tag: 123 })).toBeUndefined();
    expect(
      readReviewedErrorTag(Object.create({ _tag: "DeviceLockedError" })),
    ).toBeUndefined();
  });

  it("does not invoke getters or coercion hooks", () => {
    const getter = vi.fn(() => "DeviceLockedError");
    const coercion = vi.fn(() => "DeviceLockedError");
    const withGetter = Object.defineProperty({}, "_tag", { get: getter });

    expect(readReviewedErrorTag(withGetter)).toBeUndefined();
    expect(
      readReviewedErrorTag({ _tag: { toString: coercion } }),
    ).toBeUndefined();
    expect(getter).not.toHaveBeenCalled();
    expect(coercion).not.toHaveBeenCalled();
  });

  it("fails closed for hostile proxies", () => {
    const hostile = new Proxy(
      {},
      {
        getOwnPropertyDescriptor: () => {
          throw new Error("private proxy detail");
        },
      },
    );

    expect(readReviewedErrorTag(hostile)).toBeUndefined();
  });
});
