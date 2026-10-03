"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { defineChain } from "viem";

/**
 * Sign-in for the /app routes: Google login, and an embedded wallet created for
 * the merchant the first time they sign in. Privy runs both; our own session
 * (see `lib/auth.ts`) is what the rest of the app trusts.
 *
 * ⚠️ Google is the ONLY login method, on purpose. Every merchant then has an
 * email, which the backend requires to create the account, and there is one
 * sign-in path to explain and to secure. Enable only Google in the Privy
 * dashboard too: the dashboard setting wins over this one.
 *
 * Without an app id (a fresh clone) this renders its children unwrapped, so
 * the sign-in page can say that sign-in is not set up instead of crashing.
 */

/**
 * Monad mainnet. The wallet lives here: this is where Aurora settles payments.
 * Receiving needs no gas, so the merchant never has to hold MON to be paid.
 */
export const monad = defineChain({
  id: 143,
  name: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.monad.xyz"] } },
  blockExplorers: { default: { name: "MonadVision", url: "https://monadvision.com" } },
});

export default function AuthProvider({
  appId,
  children,
}: {
  appId: string;
  children: React.ReactNode;
}) {
  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        loginMethods: ["google"],
        embeddedWallets: {
          // A wallet for anyone who signs in without one. The merchant never
          // sees a seed phrase; their Google login is how they reach it.
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        defaultChain: monad,
        supportedChains: [monad],
        appearance: {
          theme: "light",
          // The sand accent used across the dashboard.
          accentColor: "#c48535",
          logo: "/img/tender-mark.svg",
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
