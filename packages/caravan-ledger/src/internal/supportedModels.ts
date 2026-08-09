export const KNOWN_LEDGER_MODEL_IDS = Object.freeze([
  "nanoS",
  "nanoSP",
  "nanoX",
  "stax",
  "flex",
  "apexp",
] as const);

export type KnownLedgerModelId = (typeof KNOWN_LEDGER_MODEL_IDS)[number];

export interface SupportedModelPolicy {
  allows(modelId: string | undefined): boolean;
}

const knownModelIds: ReadonlySet<string> = new Set(KNOWN_LEDGER_MODEL_IDS);

// No model has the authorization and physical evidence required for release.
const approvedProductionModelIds: ReadonlySet<KnownLedgerModelId> = new Set();

export const productionSupportedModelPolicy: SupportedModelPolicy =
  Object.freeze({
    allows(modelId: string | undefined): boolean {
      return (
        typeof modelId === "string" &&
        approvedProductionModelIds.has(modelId as KnownLedgerModelId)
      );
    },
  });

/**
 * Internal test policy for exercising the allowed branch without changing the
 * empty production authority. Unknown SDK model identifiers cannot be added.
 */
export function createCandidateModelPolicyForTesting(
  allowedModelIds: readonly string[],
): SupportedModelPolicy {
  for (const modelId of allowedModelIds) {
    if (!knownModelIds.has(modelId)) {
      throw new TypeError("Candidate model policy contains an unknown model.");
    }
  }
  const allowed = new Set(allowedModelIds);
  return Object.freeze({
    allows(modelId: string | undefined): boolean {
      return typeof modelId === "string" && allowed.has(modelId);
    },
  });
}
