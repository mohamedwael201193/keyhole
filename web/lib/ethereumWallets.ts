import type { WalletModuleFactory } from "@near-wallet-selector/core";

/** Reown / WalletConnect is optional. An empty value hides that path. */
export function reownProjectId(env: string | undefined = process.env.NEXT_PUBLIC_REOWN_PROJECT_ID): string | null {
  const id = env?.trim();
  return id ? id : null;
}

const NEAR_EVM_ID = 397;
const NEAR_EVM_RPC = "https://eth-rpc.mainnet.near.org";

/**
 * Ethereum Wallets module (NEAR Wallet Selector).
 * Injected MetaMask works with no project id.
 * WalletConnect / the Reown modal is added only when NEXT_PUBLIC_REOWN_PROJECT_ID is set.
 * The module does not implement NEP-413 signMessage.
 */
export async function ethereumWalletModule(): Promise<WalletModuleFactory | null> {
  try {
    const { setupEthereumWallets } = await import("@near-wallet-selector/ethereum-wallets");
    const projectId = reownProjectId();
    if (!projectId) {
      const { createConfig, http } = await import("@wagmi/core");
      const { injected } = await import("@wagmi/connectors");
      const { nearMainnetEvm } = await import("./nearEvm");
      const wagmiConfig = createConfig({
        chains: [nearMainnetEvm],
        connectors: [injected({ shimDisconnect: true })],
        transports: { [NEAR_EVM_ID]: http(NEAR_EVM_RPC) },
      });
      return setupEthereumWallets({ wagmiConfig, chainId: NEAR_EVM_ID });
    }
    const { WagmiAdapter } = await import("@reown/appkit-adapter-wagmi");
    const { createAppKit } = await import("@reown/appkit/react");
    const { defineChain } = await import("@reown/appkit/networks");
    const near = defineChain({
      id: NEAR_EVM_ID,
      caipNetworkId: "eip155:397",
      chainNamespace: "eip155",
      name: "NEAR Protocol",
      nativeCurrency: { decimals: 18, name: "NEAR", symbol: "NEAR" },
      rpcUrls: { default: { http: [NEAR_EVM_RPC] } },
      blockExplorers: { default: { name: "NEAR Explorer", url: "https://eth-explorer.near.org" } },
    });
    const metadata = {
      name: "KEYHOLE",
      description: "NFT viewing keys for confidential accounts",
      url: location.origin,
      icons: [`${location.origin}/brand/icon-192.png`],
    };
    const wagmiAdapter = new WagmiAdapter({ projectId, networks: [near] });
    const web3Modal = createAppKit({
      adapters: [wagmiAdapter],
      projectId,
      networks: [near],
      defaultNetwork: near,
      enableWalletConnect: true,
      features: { analytics: false, swaps: false, onramp: false, email: false, socials: false },
      metadata,
      coinbasePreference: "eoaOnly",
      allWallets: "SHOW",
    });
    return setupEthereumWallets({ wagmiConfig: wagmiAdapter.wagmiConfig, web3Modal, chainId: NEAR_EVM_ID });
  } catch {
    return null;
  }
}
