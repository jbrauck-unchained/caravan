/** Production builds omit every installer route unless explicitly opted in. */
export const LEDGER_BITCOIN_POC_ENABLED =
  __CARAVAN_LEDGER_POC__ || __CARAVAN_LEDGER_LIVE_POC__;

/** Selects the real `@caravan/ledger` WebHID adapter instead of simulation. */
export const LEDGER_BITCOIN_LIVE_POC_ENABLED = __CARAVAN_LEDGER_LIVE_POC__;

/**
 * Human-controlled legal/configuration gate. This only unlocks the coordinator
 * UI; the package's compiled model allowlist remains an independent fail-closed
 * gate before any Ledger service action.
 */
export const LEDGER_BITCOIN_BACKEND_AUTHORIZED =
  __CARAVAN_LEDGER_BACKEND_AUTHORIZED__;
