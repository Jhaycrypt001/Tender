import {
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbi,
  parseSignature,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monad } from "viem/chains";
import { MULTICALL3 } from "../lib/tokens.js";

/**
 * Everything Tender does on Monad for outgoing transfers, behind one small
 * interface so the rest of the code (and its tests) never touches an RPC.
 *
 * The relayer is a wallet Tender controls, holding only MON for gas. It can do
 * exactly one thing with a merchant's money: submit an authorization the
 * merchant's own wallet signed, which names the recipient, the amount and the
 * deadline. It cannot change any of those, and it never holds the funds.
 */

export type SignedLine = {
  from: Hex;
  to: Hex;
  /** Base units. */
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
  signature: Hex;
};

export type TransferChain = {
  /** The relayer's address, or null when no relayer key is configured. */
  relayerAddress(): Hex | null;
  /** The relayer's MON balance, in wei. */
  relayerBalance(): Promise<bigint>;
  /** `owner`'s balance of `token`, in base units. */
  tokenBalance(token: Hex, owner: Hex): Promise<bigint>;
  /** Whether this authorization nonce has already been used (or cancelled) on `token`. */
  authorizationUsed(token: Hex, authorizer: Hex, nonce: Hex): Promise<boolean>;
  /** Simulates, then sends. Resolves to the transaction hash. Throws `TransferRejected` if the chain would revert. */
  send(token: Hex, lines: SignedLine[]): Promise<Hex>;
  /** The outcome of a transaction, or null while it is not mined. */
  receipt(hash: Hex): Promise<{ status: "success" | "reverted" } | null>;
};

/** The chain refused the transfer in simulation. Nothing was broadcast, so no money moved. */
export class TransferRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransferRejected";
  }
}

const erc20 = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
]);

const multicall = parseAbi([
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
]);

/** Monad charges the gas LIMIT, not the gas used, so the limit is the estimate plus a small margin and no more. */
const GAS_MARGIN_PERCENT = 115n;

function callDataFor(line: SignedLine): Hex {
  const { r, s, yParity } = parseSignature(line.signature);
  return encodeFunctionData({
    abi: erc20,
    functionName: "transferWithAuthorization",
    args: [line.from, line.to, line.value, line.validAfter, line.validBefore, line.nonce, 27 + (yParity ?? 0), r, s],
  });
}

export function createTransferChain(opts: { client: PublicClient; rpcUrl: string; relayerKey?: Hex }): TransferChain {
  const { client } = opts;
  const account = opts.relayerKey ? privateKeyToAccount(opts.relayerKey) : null;
  const wallet = account ? createWalletClient({ account, chain: monad, transport: http(opts.rpcUrl, { timeout: 15_000 }) }) : null;

  return {
    relayerAddress: () => account?.address ?? null,

    relayerBalance: async () => (account ? client.getBalance({ address: account.address }) : 0n),

    tokenBalance: (token, owner) => client.readContract({ address: token, abi: erc20, functionName: "balanceOf", args: [owner] }),

    authorizationUsed: (token, authorizer, nonce) =>
      client.readContract({ address: token, abi: erc20, functionName: "authorizationState", args: [authorizer, nonce] }),

    async send(token, lines) {
      if (!account || !wallet) throw new Error("no relayer configured");

      // One line goes straight to the token. Several go through Multicall3 with
      // `allowFailure: false`, so the whole batch lands or none of it does.
      const request =
        lines.length === 1
          ? { to: token, data: callDataFor(lines[0]!) }
          : {
              to: MULTICALL3,
              data: encodeFunctionData({
                abi: multicall,
                functionName: "aggregate3",
                args: [lines.map((line) => ({ target: token, allowFailure: false, callData: callDataFor(line) }))],
              }),
            };

      // Simulate first: a signature that is invalid, expired, already used, or
      // for more than the wallet holds fails here, for free, instead of costing gas on-chain.
      let gas: bigint;
      try {
        gas = await client.estimateGas({ account: account.address, ...request });
      } catch (err) {
        throw new TransferRejected(revertReason(err));
      }

      return wallet.sendTransaction({ ...request, gas: (gas * GAS_MARGIN_PERCENT) / 100n, account, chain: monad });
    },

    async receipt(hash) {
      try {
        const r = await client.getTransactionReceipt({ hash });
        return { status: r.status };
      } catch {
        // "not found" while the transaction is still pending.
        return null;
      }
    },
  };
}

/** A short, readable cause from a viem simulation error. */
function revertReason(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  const text = (e.shortMessage ?? e.message ?? "the chain rejected the transfer").replace(/\s+/g, " ");
  return text.slice(0, 240);
}
