if (process.env.KEYHOLE_LIVE_OPT_IN !== "1") {
  console.error("refusing: judge/live.mts loads a wallet, calls the worker and can mint. Set KEYHOLE_LIVE_OPT_IN=1 to run it.");
  process.exit(2);
}
