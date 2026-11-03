import Link from "next/link";

/** Why MetaMask flags this page (research/METAMASK_FLAG.md): its scanner marks every *.vercel.app host. */
export function MetaMaskNote() {
  return (
    <details className="mmnote" data-testid="metamask-note">
      <summary>MetaMask says &ldquo;Malicious site&rdquo;?</summary>
      <p>MetaMask&apos;s site scanner currently marks <b>every</b> address on shared hosting (<span className="mono">*.vercel.app</span>, <span className="mono">*.netlify.app</span>, <span className="mono">*.pages.dev</span>…) as a drainer. That includes well-known open-source sites and names that were never deployed. The warning is about the hosting address, not about this request: KEYHOLE only asks MetaMask to sign a plain-text message. It never asks for a token approval or a transfer you did not start.</p>
      <p>Prefer not to click through? <Link href="/verify">Check the enclave with no wallet</Link>, follow the <Link href="/judge">judge path</Link>, or use a NEAR wallet.</p>
    </details>
  );
}
