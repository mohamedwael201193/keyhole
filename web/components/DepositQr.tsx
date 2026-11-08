"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CopyButton, QRFrame } from "./motion";
import { FundAnyChain } from "./FundAnyChain";

/**
 * Deposit address with copy, a QR code, and the amount in human units. `otherChain` (default on) adds the older
 * "coming from Base" section; the vault passes false because its sheet has a "From another chain" tab of its own.
 */
export function DepositQr({ address, amount, evm, otherChain = true }: { address: string; amount: string; evm?: string | null; otherChain?: boolean }) {
  const [svg, setSvg] = useState("");
  useEffect(() => { QRCode.toString(address, { type: "svg", margin: 1, width: 168 }).then(setSvg).catch(() => setSvg("")); }, [address]);
  return (
    <div className="depqr" data-testid="deposit-qr">
      {svg && <QRFrame caption="Scan to copy the address"><div className="qr" aria-label="QR code of the deposit address" role="img" dangerouslySetInnerHTML={{ __html: svg }} /></QRFrame>}
      <div>
        <p>Send <b data-testid="deposit-amount">{amount}</b> on the NEAR chain to:</p>
        <div className="vbox ro"><span className="v addr" data-testid="deposit-address">{address}</span><CopyButton value={address} /></div>
        <p className="vhelp">From any NEAR wallet or an exchange that withdraws on NEAR.</p>
        {otherChain && <details className="fanyc-d" open={!!evm} data-testid="fund-other-chain"><summary>Coming from Base, Arbitrum or Solana?</summary><FundAnyChain recipient={address} evm={evm} /></details>}
      </div>
    </div>
  );
}
