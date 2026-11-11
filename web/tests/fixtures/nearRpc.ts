/**
 * Shapes returned by NEAR RPC `query` (`call_function`) and `block`.
 * https://docs.near.org/api/rpc/contracts
 * https://docs.near.org/api/rpc/block-chunk
 */
export const FIXTURE_BLOCK_HASH = "block42";
export const FIXTURE_BLOCK_HEIGHT = 41;
/** Nanoseconds, the string NEAR returns on `header.timestamp_nanosec`. */
export const FIXTURE_BLOCK_TIMESTAMP_NS = "1794486857027935824";

export function callFunctionResponse(value: unknown, block: { hash?: string; height?: number } = {}) {
  return {
    jsonrpc: "2.0" as const,
    id: "kh",
    result: {
      result: [...Buffer.from(JSON.stringify(value))],
      logs: [] as string[],
      block_hash: block.hash ?? FIXTURE_BLOCK_HASH,
      block_height: block.height ?? FIXTURE_BLOCK_HEIGHT,
    },
  };
}

export function blockResponse(block: { hash?: string; height?: number; timestampNs?: string } = {}) {
  const timestamp_nanosec = block.timestampNs ?? FIXTURE_BLOCK_TIMESTAMP_NS;
  return {
    jsonrpc: "2.0" as const,
    id: "kh",
    result: {
      header: {
        hash: block.hash ?? FIXTURE_BLOCK_HASH,
        height: block.height ?? FIXTURE_BLOCK_HEIGHT,
        timestamp: Number(timestamp_nanosec),
        timestamp_nanosec,
      },
    },
  };
}
