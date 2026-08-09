import {
  createCandidateModelPolicyForTesting,
  KNOWN_LEDGER_MODEL_IDS,
  productionSupportedModelPolicy,
} from "./supportedModels";

describe("compiled Ledger model policy", () => {
  it.each(KNOWN_LEDGER_MODEL_IDS)(
    "keeps known production candidate %s unapproved",
    (modelId) => {
      expect(productionSupportedModelPolicy.allows(modelId)).toBe(false);
    },
  );

  it("fails closed for missing and unknown model evidence", () => {
    expect(productionSupportedModelPolicy.allows(undefined)).toBe(false);
    expect(productionSupportedModelPolicy.allows("future-model")).toBe(false);
  });

  it("allows an internal candidate branch without widening production", () => {
    const candidatePolicy = createCandidateModelPolicyForTesting([
      "nanoS",
      "flex",
    ]);

    expect(candidatePolicy.allows("nanoS")).toBe(true);
    expect(candidatePolicy.allows("flex")).toBe(true);
    expect(candidatePolicy.allows("nanoX")).toBe(false);
    expect(candidatePolicy.allows(undefined)).toBe(false);
    expect(productionSupportedModelPolicy.allows("nanoS")).toBe(false);
  });

  it("rejects unknown candidate-policy entries", () => {
    expect(() =>
      createCandidateModelPolicyForTesting(["future-model"]),
    ).toThrow("unknown model");
  });
});
