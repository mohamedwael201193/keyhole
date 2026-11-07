import Link from "next/link";

/** Shown for any unknown path. Uses the site's page layout and palette, so it is not a black page. */
export default function NotFound() {
  return (
    <div className="page">
      <div className="pagehead">
        <p className="eb">Not found</p>
        <h1>This page is not here.</h1>
        <p className="lead">The link may be old or mistyped.</p>
      </div>
      <p className="hero-actions">
        <Link className="btn b1" href="/">Home</Link>{" "}
        <Link className="btn b2" href="/judge">Judge path</Link>
      </p>
    </div>
  );
}
