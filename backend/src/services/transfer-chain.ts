import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  HttpRequestError,
  InsufficientFundsError,
  RpcRequestError,
  TimeoutError,
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
  /**
   * Simulates, then sends. Resolves to the transaction hash. Throws `TransferRejected` if the chain would revert, and
   * `TransferNotSent` if nothing was broadcast for a reason that says nothing about the transfer (the RPC was down, the
   * relayer could not be prepared). Any other error means the broadcast itself may or may not have gone out.
   */
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

/**
 * Nothing was broadcast, and the chain did not judge the transfer either: the RPC timed out, or the relayer's transaction
 * could not be built. The signatures are untouched and still good until they expire, so trying again is safe.
 */
export class TransferNotSent extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransferNotSent";
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

  // The relayer has ONE account nonce. Two sends building their transactions at the same moment read the same nonce, and
  // one of them is refused ("nonce too low", "replacement underpriced") after its authorizations were already claimed.
  // So the part that reads the nonce and broadcasts runs one send at a time. (One API process sends; the worker does not.)
  let queue: Promise<unknown> = Promise.resolve();
  const oneAtATime = <T>(job: () => Promise<T>): Promise<T> => {
    const run = queue.then(job, job);
    queue = run.catch(() => undefined);
    return run;
  };

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
        // A node that could not answer (timeout, 502, rate limit) or a relayer out of gas says nothing about the transfer: fail
        // it and its signatures are burned for nothing. Any other answer from the node is a verdict, and retrying cannot
        // change it, so it is a rejection with the node's own reason rather than an endless "try again".
        if (isRevert(err) || !isTransient(err)) throw new TransferRejected(revertReason(err));
        throw new TransferNotSent(`could not simulate: ${revertReason(err)}`);
      }

      return oneAtATime(async () => {
        // Built and signed here, on their own, so a failure up to this point is known to have broadcast nothing.
        let serialized: Hex;
        try {
          const prepared = await wallet.prepareTransactionRequest({ ...request, gas: (gas * GAS_MARGIN_PERCENT) / 100n, account, chain: monad });
          serialized = await account.signTransaction(prepared as Parameters<typeof account.signTransaction>[0]);
        } catch (err) {
          throw new TransferNotSent(`could not prepare the relayer transaction: ${revertReason(err)}`);
        }
        // From here on an error is unknown: the node may have taken the transaction before the connection broke.
        return wallet.sendRawTransaction({ serializedTransaction: serialized });
      });
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

/** Whether a simulation error is the chain refusing the call, rather than the RPC failing to answer. */
function isRevert(err: unknown): boolean {
  if (err instanceof BaseError && err.walk((e) => e instanceof ExecutionRevertedError || e instanceof ContractFunctionRevertedError)) return true;
  const e = err as { shortMessage?: string; message?: string };
  return /revert/i.test(e.shortMessage ?? e.message ?? "");
}

/**
 * The RPC failing to answer, or the relayer being unable to pay, as opposed to the node judging the transfer. Retrying
 * these can succeed; retrying a judgement cannot.
 */
function isTransient(err: unknown): boolean {
  if (err instanceof BaseError && err.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError || e instanceof InsufficientFundsError)) return true;
  if (err instanceof BaseError) {
    const rpc = err.walk((e) => e instanceof RpcRequestError) as RpcRequestError | null;
    // -32005 limit exceeded, -32603 internal error, -32000/-32004 node-side trouble reads like the messages below.
    if (rpc && (rpc.code === -32005 || rpc.code === -32603)) return true;
  }
  const e = err as { shortMessage?: string; message?: string };
  return /timed? ?out|rate.?limit|too many requests|unavailable|connection|network|fetch failed|ECONN|ENOTFOUND|header not found|try again|insufficient funds|exceeds the balance/i.test(e.shortMessage ?? e.message ?? "");
}

/** A short, readable cause from a viem simulation error. */
function revertReason(err: unknown): string {
  const e = err as { shortMessage?: string; message?: string };
  const text = (e.shortMessage ?? e.message ?? "the chain rejected the transfer").replace(/\s+/g, " ");
  return text.slice(0, 240);
}
