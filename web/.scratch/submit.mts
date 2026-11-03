import { readFileSync, writeFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
const c = JSON.parse(readFileSync("/workspace/near_hackathon/.secrets/agent_api_demo.json", "utf8"));
const acct = privateKeyToAccount(JSON.parse(readFileSync("/workspace/near_hackathon/.secrets/agent_api_demo_owner.json", "utf8")).pk);
const api = async (p: string, m = "GET", b?: unknown) => { const r = await fetch(c.base_url + p, { method: m, headers: { "X-API-Key": c.api_key, "content-type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); return [r.status, await r.json()] as const; };
const g = JSON.parse(readFileSync("/tmp/aoi/gen.json", "utf8"));
const p = g.intent.payload;
const signature = await acct.signTypedData({ domain: p.domain, types: Object.fromEntries(Object.entries(p.types).filter(([k]) => k !== "EIP712Domain")) as never, primaryType: p.primaryType, message: p.message });
const [s, r] = await api("/v1/submit-intent", "POST", { type: "agent_create", correlation_id: g.correlation_id, signed_data: { standard: "eip712", payload: p, signature } });
console.log(s, JSON.stringify(r).slice(0, 600));
for (let i = 0; i < 20; i++) { await new Promise((z) => setTimeout(z, 3000)); const [s2, st] = await api(`/v1/status?correlation_id=${g.correlation_id}`); console.log(s2, st.status); if (/SETTLED|COMPLETED|SUCCESS|FAILED|EXPIRED|ACTIVE|APPLIED/.test(st.status)) { writeFileSync("/tmp/aoi/status.json", JSON.stringify(st)); break; } }
