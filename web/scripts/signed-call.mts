// Real signed call through the site gateway, signing with the same lib/nep413.ts the browser uses.
// usage: KEYFILE=path/{account_id,private_key}.json BASE=https://site npx tsx scripts/signed-call.mts <op> '<params json>'
import { readFileSync } from "node:fs";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519.js";
import { buildMessage, freshNonce, payloadHash, toB64, type Op } from "../lib/nep413";
const [op, params = "{}"] = process.argv.slice(2);
const k = JSON.parse(readFileSync(process.env.KEYFILE!, "utf8"));
const sk = bs58.decode(k.private_key.replace("ed25519:", "")).slice(0, 32);
const pk = ed25519.getPublicKey(sk);
const message = buildMessage(op as Op, k.account_id, JSON.parse(params));
const nonce = freshNonce();
const auth = { account_id: k.account_id, public_key: "ed25519:" + bs58.encode(pk), signature: toB64(ed25519.sign(payloadHash(message, nonce), sk)), nonce: toB64(nonce), message, recipient: "keyhole" };
const body = JSON.stringify({ op, auth });
const r = await fetch(`${process.env.BASE || "http://localhost:3100"}/api/worker`, { method: "POST", headers: { "content-type": "application/json" }, body });
const j = await r.json();
if (process.env.REPLAY) { const r2 = await fetch(`${process.env.BASE || "http://localhost:3100"}/api/worker`, { method: "POST", headers: { "content-type": "application/json" }, body }); console.log("REPLAY", JSON.stringify(await r2.json())); }
console.log(JSON.stringify(j));
