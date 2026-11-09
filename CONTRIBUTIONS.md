# Authorship and dependencies

KEYHOLE is authored and directed by devmo. AI coding tools assisted implementation and review; generated output is checked through the repository tests, threat models and public evidence. Tool assistance is not a third-party security audit.

The first code commit is [66f7070](https://github.com/mohamedwael201193/keyhole/commit/66f7070). Git history records subsequent work. The public project uses Rust/near-sdk and near-contract-standards for the contract; Rust and the crates pinned in the worker Cargo.lock for the enclave; TypeScript and the Model Context Protocol SDK for the CLI; Next.js/React and the wallet, cryptography and motion libraries pinned in the web package lock.

Dependency versions and their transitive dependencies are reproducible from:

- [Contract Cargo.toml](contracts/keys/Cargo.toml) and [lockfile](contracts/keys/Cargo.lock)
- [Worker Cargo.toml](tee/worker/Cargo.toml) and [lockfile](tee/worker/Cargo.lock)
- [CLI package.json](cli/package.json) and [lockfile](cli/package-lock.json)
- [Web package.json](web/package.json) and [lockfile](web/package-lock.json)

Original KEYHOLE code is [MIT licensed](LICENSE); dependency licenses remain their own. The optional ambient audio is [CC0](web/public/audio/LICENSE.txt).
