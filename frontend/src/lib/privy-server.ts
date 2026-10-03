import "server-only";
import { PrivyClient } from "@privy-io/node";
import { PRIVY_APP_ID } from "@/lib/auth";

/**
 * Who just signed in, as Privy vouches for it. ⚠️ SERVER ONLY.
 *
 * The browser sends an identity token: a JWT Privy signed, listing the
 * person's linked accounts. It is verified here with the app secret, and the
 * email and wallet address are read from the VERIFIED token, never from
 * anything the browser says outside it. That is what makes it safe to save the
 * wallet as the merchant's settlement address without a separate proof: the
 * address in a valid token is, by construction, the signed-in person's own
 * embedded wallet.
 *
 * Needs "Return user data in an identity token" switched on in the Privy
 * dashboard (User management → Authentication → Advanced). Without it the
 * token carries no linked accounts and every sign-in fails here.
 */

let client: PrivyClient | undefined;

function privy(): PrivyClient | null {
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!PRIVY_APP_ID || !appSecret) return null;
  client ??= new PrivyClient({ appId: PRIVY_APP_ID, appSecret });
  return client;
}

export type Identity = {
  /** The Privy user id (`did:privy:…`): permanent, and what the merchant is keyed on. */
  userId: string;
  email: string;
  name: string;
  /** The person's own Ethereum embedded wallet, or null if it is not created yet. */
  wallet: string | null;
};

/** Why a token was refused, for the server log. Never shown to the visitor. */
export type IdentityFailure = "not_configured" | "verify_failed" | "no_google_email";

/**
 * Verifies an identity token and reads the person from it.
 * Null for anything that does not verify, or a user with no Google email.
 */
export async function identityFromToken(idToken: string): Promise<Identity | null> {
  const result = await checkIdentityToken(idToken);
  return result.ok ? result.identity : null;
}

/**
 * Same as `identityFromToken`, but says WHY a token was refused, so the
 * session route can log it. The reason is logged, never returned to the
 * browser: "your token is missing an email" is a hint to someone forging one.
 */
export async function checkIdentityToken(
  idToken: string,
): Promise<{ ok: true; identity: Identity } | { ok: false; reason: IdentityFailure; detail?: string }> {
  const app = privy();
  if (!app) return { ok: false, reason: "not_configured" };
  if (!idToken) return { ok: false, reason: "verify_failed", detail: "empty token" };

  let user;
  try {
    user = await app.users().get({ id_token: idToken });
  } catch (err) {
    // A bad, expired or forged token is an ordinary failed sign-in, not an error.
    return { ok: false, reason: "verify_failed", detail: (err as Error).message?.slice(0, 160) };
  }

  let email = "";
  let name = "";
  let wallet: string | null = null;
  for (const account of user.linked_accounts) {
    if (account.type === "google_oauth") {
      email = account.email;
      name = account.name?.trim() ?? "";
    } else if (
      account.type === "wallet" &&
      "connector_type" in account &&
      account.connector_type === "embedded" &&
      account.chain_type === "ethereum"
    ) {
      wallet ??= account.address;
    }
  }

  // Google is the only login method, so an account without its email is not one
  // we created. The backend requires an email to open a merchant. This is also
  // what happens when the identity token carries no linked accounts at all,
  // i.e. "Return user data in an identity token" is off in the Privy dashboard.
  if (!email) {
    return {
      ok: false,
      reason: "no_google_email",
      detail: `linked account types in token: ${user.linked_accounts.map((a) => a.type).join(", ") || "none"}`,
    };
  }

  return {
    ok: true,
    identity: { userId: user.id, email, name: name || email.split("@")[0]!, wallet },
  };
}
