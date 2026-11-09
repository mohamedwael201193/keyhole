"use client";
import { Button } from "@/components/ui";
import { Card, Icon } from "@/components/v7";

/**
 * The "About Private Swap" card beside the form: one plain paragraph about how a swap runs, and a real link to the landing page
 * section that explains it (/#private). The arch art is the cream background image, mirrored onto the right edge.
 */
export function SwapAbout() {
  return (
    <Card as="section" className="sw-about" labelledBy="sw-about-h" testid="swap-about">
      <div className="sw-about-art" aria-hidden="true" />
      <div className="sw-about-body">
        <h2 id="sw-about-h" className="v7-card-h">About Private Swap</h2>
        <p>Swaps run inside your key&apos;s vault using NEAR Intents, keeping your assets and strategy confidential.</p>
        <Button variant="secondary" href="/#private" className="sw-learn" testid="swap-learn">
          Learn more <Icon name="arrow-up-right" size={16} />
        </Button>
      </div>
    </Card>
  );
}
