import { describe, expect, it } from "vitest";
import { createPledgeClient } from "@/lib/pledgeClient";
import { lienPanelLabel } from "@/lib/lien";
import { applyLienSnapshot, lienSnapshotFromViews, type LienControlFields, type PinnedView } from "@/lib/lienRead";

const TOKEN = "k5f4750858f328940";
const BEFORE = { owner: "a.near", epoch: "0", height: 100, hash: "h100aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" };
const AFTER = { owner: "b.near", epoch: "1", height: 101, hash: "h101bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" };

function bytes(value: unknown): number[] {
  return [...Buffer.from(JSON.stringify(value))];
}

function controlOf(state: typeof BEFORE, pledged = false): LienControlFields {
  return {
    token_id: TOKEN,
    owner_epoch: state.epoch,
    pending_value_ops: "0",
    listed: false,
    transfer_pending: false,
    pledged,
    value_op_nonce: "0",
  };
}

function viewBody(state: typeof BEFORE, method: string) {
  const value = method === "nft_token"
    ? { token_id: TOKEN, owner_id: state.owner }
    : method === "get_control_state"
      ? controlOf(state)
      : null;
  return { jsonrpc: "2.0", id: "lien", result: { block_height: state.height, block_hash: state.hash, result: bytes(value) } };
}

function rpcResponse(body: unknown): Response {
  return { ok: true, json: async () => body } as Response;
}

type Query = { method?: string; params?: { method_name?: string; block_id?: unknown; finality?: unknown; request_type?: string } };

/** Finality-only reads alternate blocks, which is the sale landing between them. A shared block_id stays on that block. */
function saleFetch(queries: Query[]): typeof fetch {
  let unpinned = 0;
  return (async (_url: string, init?: RequestInit) => {
    const q = JSON.parse(String(init?.body)) as Query;
    queries.push(q);
    if (q.method === "block") {
      return rpcResponse({ result: { header: { height: BEFORE.height, hash: BEFORE.hash, timestamp_nanosec: "1" } } });
    }
    const params = q.params ?? {};
    const pinned = params.block_id === BEFORE.hash || params.block_id === BEFORE.height
      ? BEFORE
      : params.block_id === AFTER.hash || params.block_id === AFTER.height
        ? AFTER
        : unpinned++ % 2 === 0 ? BEFORE : AFTER;
    return rpcResponse(viewBody(pinned, params.method_name ?? ""));
  }) as typeof fetch;
}

function pin(value: unknown, state: typeof BEFORE = BEFORE): PinnedView {
  return { value, blockHeight: state.height, blockHash: state.hash };
}

function facts(owner: string | null, control: LienControlFields | null): string | null {
  if (!control) return null;
  return `Owner ${owner} · Owner epoch ${control.owner_epoch} · Pledged ${control.pledged} · Listed ${control.listed} · Transfer pending ${control.transfer_pending} · Value operations pending ${control.pending_value_ops} · Collateral binding none on record`;
}

describe("lien snapshot on one block", () => {
  it("a sale between reads never renders an owner from one block with an epoch from another", async () => {
    const queries: Query[] = [];
    const client = createPledgeClient({ live: true, rpcUrl: "https://rpc.test/lien", fetchImpl: saleFetch(queries) });
    const read = await client.readLienAtFinalBlock(TOKEN);
    const shown = applyLienSnapshot(TOKEN, read);
    const line = facts(shown.owner, shown.control);
    expect(shown.status).toBe("ready");
    expect(line).toBe("Owner a.near · Owner epoch 0 · Pledged false · Listed false · Transfer pending false · Value operations pending 0 · Collateral binding none on record");
    expect(line).not.toContain("Owner epoch 1");
    expect(lienPanelLabel(shown.status, shown.control, null)).toBe("Not locked");
    const views = queries.filter((q) => q.method === "query");
    expect(views).toHaveLength(5);
    expect(views.every((q) => q.params?.block_id === BEFORE.hash && q.params.finality === undefined)).toBe(true);
    expect(views.map((q) => q.params?.method_name)).toEqual([
      "nft_token", "get_control_state", "get_loan", "get_collateral_binding", "get_pledge_config",
    ]);
  });

  it("a snapshot whose views return different block heights is discarded and never rendered", async () => {
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const q = JSON.parse(String(init?.body)) as Query;
      if (q.method === "block") return rpcResponse({ result: { header: { height: BEFORE.height, hash: BEFORE.hash } } });
      const method = q.params?.method_name;
      const state = method === "get_control_state" ? AFTER : BEFORE;
      return rpcResponse(viewBody(state, method ?? ""));
    }) as typeof fetch;
    const client = createPledgeClient({ live: true, rpcUrl: "https://rpc.test/lien", fetchImpl });
    const shown = applyLienSnapshot(TOKEN, await client.readLienAtFinalBlock(TOKEN));
    expect(shown).toMatchObject({ status: "error", owner: null, control: null, loan: null });
    expect(facts(shown.owner, shown.control)).toBeNull();
    expect(lienPanelLabel(shown.status, shown.control, null)).toBe("Not read");
    expect(lienPanelLabel(shown.status, shown.control, null)).not.toBe("Not locked");
  });

  it("one refetch publishes only the consistent block after a mixed first read", async () => {
    let blocks = 0;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      const q = JSON.parse(String(init?.body)) as Query;
      if (q.method === "block") {
        blocks += 1;
        const state = blocks === 1 ? BEFORE : AFTER;
        return rpcResponse({ result: { header: { height: state.height, hash: state.hash } } });
      }
      const method = q.params?.method_name ?? "";
      if (q.params?.block_id === BEFORE.hash) return rpcResponse(viewBody(method === "get_control_state" ? AFTER : BEFORE, method));
      return rpcResponse(viewBody(AFTER, method));
    }) as typeof fetch;
    const client = createPledgeClient({ live: true, rpcUrl: "https://rpc.test/lien", fetchImpl });
    const shown = applyLienSnapshot(TOKEN, await client.readLienAtFinalBlock(TOKEN));
    expect(blocks).toBe(2);
    expect(shown.status).toBe("ready");
    expect(facts(shown.owner, shown.control)).toContain("Owner b.near · Owner epoch 1");
    expect(facts(shown.owner, shown.control)).not.toContain("a.near");
  });

  it("rejects a loan, an epoch, or a token id that does not belong on the pinned block", () => {
    const block = { height: BEFORE.height, hash: BEFORE.hash };
    const base = {
      tokenId: TOKEN,
      block,
      owner: pin({ owner_id: "a.near" }),
      control: pin(controlOf(BEFORE)),
      loan: pin(null),
      binding: pin(null),
      config: pin(null),
    };
    expect(lienSnapshotFromViews(base).ok).toBe(true);
    expect(lienSnapshotFromViews({ ...base, control: { ...base.control, blockHeight: AFTER.height, blockHash: AFTER.hash } }).ok).toBe(false);
    expect(lienSnapshotFromViews({ ...base, owner: { ...base.owner, blockHash: "other-hash" } }).ok).toBe(false);
    const pledged = controlOf(BEFORE, true);
    pledged.owner_epoch = "1";
    expect(lienSnapshotFromViews({ ...base, control: pin(pledged) }).ok).toBe(false);
    const loan = { token_id: TOKEN, owner_epoch: "0", state: "Active" };
    expect(lienSnapshotFromViews({ ...base, control: pin(pledged), loan: pin({ ...loan, owner_epoch: "9" }) }).ok).toBe(false);
    expect(lienSnapshotFromViews({ ...base, control: pin(pledged), loan: pin({ ...loan, token_id: "k0000000000000000", owner_epoch: "1" }) }).ok).toBe(false);
    expect(lienSnapshotFromViews({ ...base, control: pin({ ...controlOf(BEFORE), token_id: "k0000000000000000" }) }).ok).toBe(false);
    const agreed = lienSnapshotFromViews({ ...base, control: pin(pledged), loan: pin({ ...loan, owner_epoch: "1" }) });
    expect(agreed.ok).toBe(true);
    if (agreed.ok && !agreed.missing) expect(agreed.control.pledged).toBe(true);
  });
});
