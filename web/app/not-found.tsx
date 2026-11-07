import Link from "next/link";
import "./public-pages.css";

// Literal classes: buttonClass() lives in a client module and cannot be called from this server component.

/** Shown for any unknown path. Uses the site's page layout and palette, so it is not a black page. */
export default function NotFound() {
  return (
    <div className="page pp pp-notfound">
      <div className="pp-nf">
        <svg className="pp-nf-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <circle cx="8" cy="12" r="3.5" /><path d="M11.5 12H21" /><path d="M18 12v3.5" /><path d="M21 12v2.5" />
        </svg>
        <p className="eb">Not found</p>
        <h1>This page is not here.</h1>
        <p className="pp-nf-lead">The link may be old or mistyped.</p>
        <div className="uact">
          <Link className="kh-btn kh-btn--primary" href="/">Home</Link>
          <Link className="kh-btn kh-btn--secondary" href="/judge">Judge path</Link>
          <Link className="kh-btn kh-btn--ghost" href="/verify">Verify a call</Link>
        </div>
      </div>
    </div>
  );
}
