# Live contract v2.7 evidence promotion

Credit: devmo. `promotion.public.json` is a read-only pinned-block capture of
actual code SHA256/bytes, NEP-330 version, config/pledge authorities and the genuine
original FINAL deployment receipt. `scripts/release/promote-v27.mjs` re-reads those
public facts, verifies the complete successful receipt lineage and compares the
existing local release bytes before promotion. Regression tests reject different
bytes, version, authorities, receipts and incomplete lineage.

Deployment: `6rD2iMs146L3H3ghKTGwhcXtAmNQCGU2P3C7nx1ewi2h`.
WASM: `26d3deeff8a4445515d6356097bd7634e8b26deaee7e7ea1ebe47849b807c08c`, 519382 bytes.

No contract file, transaction, governance state, immutable minter/attestor,
historical migration or live worker identity was changed. Strict verifiers select
the existing release/v2.7 artifact. The old deployed/v2.6 artifact and original
release candidate metadata are preserved as historical source evidence.
