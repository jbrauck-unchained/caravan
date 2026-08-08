---
"@caravan/wallets": patch
---

Close the exact Ledger WebUSB or U2F transport owned by each interaction on
success and failure, while preserving the primary operation error if cleanup
also fails.
