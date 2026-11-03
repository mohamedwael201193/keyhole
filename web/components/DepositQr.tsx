"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { CopyBtn } from "./ui";

/** Deposit address with copy, a QR code, and the amount in human units. */
export function DepositQr({ address, amount }: { address: string; amount: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => { QRCode.toString(address, { type: "svg", margin: 1, width: 168 }).then(setSvg).catch(() => setSvg("")); }, [address]);
  return (
    <div className="depqr" data-testid="deposit-qr">
      {svg && <div className="qr" aria-label="QR code of the deposit address" role="img" dangerouslySetInnerHTML={{ __html: svg }} />}
      <div>
        <p>Send <b data-testid="deposit-amount">{amount}</b> on the NEAR chain to:</p>
        <div className="vbox ro"><span className="v addr" data-testid="deposit-address">{address}</span><CopyBtn value={address} /></div>
        <p className="vhelp">From any NEAR wallet or an exchange that withdraws on NEAR. Coming from another chain? Use a cross-chain swap with this address as the recipient.</p>
      </div>
    </div>
  );
}
