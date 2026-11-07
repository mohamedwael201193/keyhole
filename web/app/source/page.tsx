import manifest from "../../public/source/manifest.json";
import { Purpose } from "@/components/ui";
import "../public-pages.css";

// Literal classes: buttonClass() lives in a client module and cannot be called from this server component.

const REPO = "https://github.com/mohamedwael201193/keyhole";

/** Judge source download. The tarball, checksum and manifest are static files in public/source, cut by scripts/make-source-tarball.sh. */
export default function Source() {
  return (
    <div className="page pp pp-source">
      <Purpose
        eyebrow="Judge source"
        title="Source code"
        line="One tarball, cut from one commit with git archive. Check the sha256 before you unpack it."
      />
      <section className="pp-card pp-source-facts" aria-labelledby="src-facts">
        <h2 id="src-facts">This tarball</h2>
        <dl className="pp-facts">
          <div><dt>Commit</dt><dd><a href={`${REPO}/commit/${manifest.commit}`} target="_blank" rel="noreferrer"><span className="mono">{manifest.commit}</span></a></dd></div>
          <div><dt>SHA-256</dt><dd><span className="mono" data-kind="hash">{manifest.sha256}</span></dd></div>
          <div><dt>Size</dt><dd>{manifest.bytes.toLocaleString("en-US")} bytes, {manifest.files} files</dd></div>
        </dl>
      </section>
      <section className="pp-card" aria-labelledby="src-get">
        <h2 id="src-get">Download</h2>
        <div className="pp-dl">
          <a className="kh-btn kh-btn--primary" href="/source/keyhole-src.tar.gz" download>Download keyhole-src.tar.gz</a>
          <a className="kh-btn kh-btn--secondary" href="/source/keyhole-src.tar.gz.sha256" download>Download the checksum file</a>
        </div>
        <ul className="pp-links">
          <li><a href="/source/manifest.json">Manifest (JSON)</a></li>
          <li><a href={REPO} target="_blank" rel="noreferrer">Git repository on GitHub</a></li>
        </ul>
      </section>
      <section className="pp-card" aria-labelledby="src-check">
        <h2 id="src-check">Check the download</h2>
        <p>Run <span className="mono">sha256sum -c keyhole-src.tar.gz.sha256</span>. It must print <span className="mono">keyhole-src.tar.gz: OK</span>.</p>
        <p className="muted">The steps for AI judges are in <a href={`${REPO}/blob/main/JUDGE_AGENT.md`} target="_blank" rel="noreferrer">JUDGE_AGENT.md</a>.</p>
      </section>
    </div>
  );
}
