# Verify the deployment

Use the immutable checkout generated in [README.md](README.md#1-verify-in-5-minutes-zero-install). That block names one commit. This page does not name a floating branch.

From that checkout:

```bash
bash judge/0-live.sh
```

`judge/0-live.sh` needs `curl` and Python 3. If `identity.json` is not beside the script, set `IDENTITY_JSON` or `IDENTITY_URL` to the same commit. The script does not guess a branch.

The check compares the on-chain code hash with `identity.json`, reads `config`, source metadata and supply, re-fetches the recorded worker info attestation, and checks one recorded refusal receipt. It also reads `identity.governance`: owner the guardian implicit account `0705fdc1…`, lending off, three access keys. It does not claim those keys are gone.

Longer commands are in [JUDGE_AGENT.md](JUDGE_AGENT.md). `judge/live.mts` is opt-in (`KEYHOLE_LIVE_OPT_IN=1`) because it loads a wallet and can mint. It is not this check.

The executable checkout fence is the generated block in [README.md](README.md#1-verify-in-5-minutes-zero-install), marked `keyhole-fence: safe`. `node judge/check-readme.mjs README.md` runs that fence in a clean directory and a clean environment and keeps its exit code.
