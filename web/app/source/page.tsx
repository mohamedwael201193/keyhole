import manifest from "../../public/source/manifest.json";
import { PageHead } from "@/components/PageHead";

const REPO = "https://github.com/mohamedwael201193/keyhole";

/** Judge source download. The tarball, checksum and manifest are static files in public/source, cut by scripts/make-source-tarball.sh. */
export default function Source() {
  return (
    <div className="page">
      <PageHead
        eyebrow="Judge source"
        title="Source code"
        sub="One tarball, cut from one commit with git archive. Check the sha256 before you unpack it."
      />
      <div className="card" style={{ maxWidth: 760 }}>
        <table className="jtable">
          <tbody>
            <tr><th scope="row">Commit</th><td><a href={`${REPO}/commit/${manifest.commit}`} target="_blank" rel="noreferrer"><span className="mono">{manifest.commit}</span></a></td></tr>
            <tr><th scope="row">SHA-256</th><td><span className="mono" style={{ wordBreak: "break-all" }}>{manifest.sha256}</span></td></tr>
            <tr><th scope="row">Size</th><td>{manifest.bytes.toLocaleString("en-US")} bytes, {manifest.files} files</td></tr>
          </tbody>
        </table>
      </div>
      <ul style={{ marginTop: 24, lineHeight: 1.9 }}>
        <li><a href="/source/keyhole-src.tar.gz" download>Download keyhole-src.tar.gz</a></li>
        <li><a href="/source/keyhole-src.tar.gz.sha256" download>Download the checksum file</a></li>
        <li><a href="/source/manifest.json">Manifest (JSON)</a></li>
        <li><a href={REPO} target="_blank" rel="noreferrer">Git repository on GitHub</a></li>
      </ul>
      <p className="note" style={{ marginTop: 24 }}>
        To check the download: <span className="mono">sha256sum -c keyhole-src.tar.gz.sha256</span> must print <span className="mono">keyhole-src.tar.gz: OK</span>. The steps for AI judges are in <a href={`${REPO}/blob/main/JUDGE_AGENT.md`} target="_blank" rel="noreferrer">JUDGE_AGENT.md</a>.
      </p>
    </div>
  );
}
