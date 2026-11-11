/** Cache identity for a lien read. A later response may update the panel only when this key is still current. */

export function lienCacheKey(parts: { contract: string; tokenId: string; owner: string | null; marker: string }): string {
  return `${parts.contract}\n${parts.tokenId}\n${parts.owner ?? ""}\n${parts.marker}`;
}

export function lienReadCurrent(
  started: { tokenId: string; generation: number },
  current: { tokenId: string | null; generation: number },
  aborted: boolean,
): boolean {
  return !aborted && current.generation === started.generation && current.tokenId === started.tokenId;
}

/** A certificate result is for the key that requested it. A newer key, or an aborted request, does not become "valid". */
export function certificateCurrent(
  started: { tokenId: string; generation: number },
  current: { tokenId: string | null; generation: number },
  aborted: boolean,
  certificateTokenId: string | null,
): boolean {
  return lienReadCurrent(started, current, aborted) && certificateTokenId === started.tokenId;
}
