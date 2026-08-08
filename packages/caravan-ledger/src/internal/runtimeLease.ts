export class RuntimeLeaseBusyError extends Error {
  readonly name = "RuntimeLeaseBusyError" as const;

  constructor() {
    super("The shared Ledger runtime is already in use.");
  }
}

export interface RuntimeLease {
  readonly generation: number;
  isCurrent(): boolean;
  invalidate(): void;
  release(): void;
}

interface RuntimeLeaseState {
  readonly generation: number;
  valid: boolean;
  released: boolean;
}

let currentGeneration = 0;
let activeLease: RuntimeLeaseState | undefined;

function incrementGeneration(): number {
  if (currentGeneration === Number.MAX_SAFE_INTEGER) {
    throw new Error("The Ledger runtime generation is exhausted.");
  }
  currentGeneration += 1;
  return currentGeneration;
}

/** Acquire the only live runtime/session lease in this JavaScript realm. */
export function acquireRuntimeLease(): RuntimeLease {
  if (activeLease) {
    throw new RuntimeLeaseBusyError();
  }

  const state: RuntimeLeaseState = {
    generation: incrementGeneration(),
    valid: true,
    released: false,
  };
  activeLease = state;

  return Object.freeze({
    generation: state.generation,
    isCurrent(): boolean {
      return (
        activeLease === state &&
        state.valid &&
        !state.released &&
        currentGeneration === state.generation
      );
    },
    invalidate(): void {
      if (activeLease !== state || state.released || !state.valid) {
        return;
      }
      state.valid = false;
      incrementGeneration();
    },
    release(): void {
      if (state.released) {
        return;
      }
      state.released = true;
      if (activeLease === state) {
        if (state.valid) {
          state.valid = false;
          incrementGeneration();
        }
        activeLease = undefined;
      }
    },
  });
}

export function currentRuntimeGenerationForTesting(): number {
  return currentGeneration;
}

export function resetRuntimeLeaseForTesting(): void {
  activeLease = undefined;
  currentGeneration = 0;
}
