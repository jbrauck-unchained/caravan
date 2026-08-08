/**
 * Compile-time gate for the private, simulated Ledger Bitcoin installer PoC.
 * Production builds omit the route unless an operator explicitly opts in.
 */
export const LEDGER_BITCOIN_POC_ENABLED = __CARAVAN_LEDGER_POC__;
