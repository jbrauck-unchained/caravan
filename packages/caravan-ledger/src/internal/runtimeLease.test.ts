import {
  acquireRuntimeLease,
  currentRuntimeGenerationForTesting,
  resetRuntimeLeaseForTesting,
  RuntimeLeaseBusyError,
} from "./runtimeLease";

describe("global Ledger runtime lease", () => {
  beforeEach(() => {
    resetRuntimeLeaseForTesting();
  });

  afterEach(() => {
    resetRuntimeLeaseForTesting();
  });

  it("permits one live owner and rejects concurrent acquisition", () => {
    const lease = acquireRuntimeLease();

    expect(lease.isCurrent()).toBe(true);
    expect(() => acquireRuntimeLease()).toThrow(RuntimeLeaseBusyError);
    expect(currentRuntimeGenerationForTesting()).toBe(lease.generation);
  });

  it("invalidates one generation idempotently while retaining ownership", () => {
    const lease = acquireRuntimeLease();
    const generation = lease.generation;

    lease.invalidate();
    lease.invalidate();

    expect(lease.isCurrent()).toBe(false);
    expect(currentRuntimeGenerationForTesting()).toBe(generation + 1);
    expect(() => acquireRuntimeLease()).toThrow(RuntimeLeaseBusyError);
  });

  it("releases idempotently and gives a later owner a fresh generation", () => {
    const first = acquireRuntimeLease();
    first.release();
    first.release();

    const second = acquireRuntimeLease();
    expect(second.generation).toBeGreaterThan(first.generation);
    expect(first.isCurrent()).toBe(false);
    expect(second.isCurrent()).toBe(true);
  });

  it("does not let an old lease disturb a newer owner", () => {
    const first = acquireRuntimeLease();
    first.release();
    const second = acquireRuntimeLease();

    first.invalidate();
    first.release();

    expect(second.isCurrent()).toBe(true);
  });
});
