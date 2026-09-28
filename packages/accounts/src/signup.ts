import { z } from "zod";
import type { EmployerAccount, SignupReceiptEvidence } from "../../contracts/src/account.js";
import { signupReceiptEvidenceSchema } from "../../contracts/src/account.js";
import { DomainError } from "../../contracts/src/index.js";

export type SignupRequest = (input: string, init: RequestInit) => Promise<Response>;

export class SignupDefinitiveRejection extends Error {
  constructor() {
    super("Employer definitively rejected account signup.");
    this.name = "SignupDefinitiveRejection";
  }
}

const responseSchema = z
  .object({
    accountId: z.string().min(1).max(180),
    identityEmailHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export async function commitSignup(
  account: EmployerAccount,
  identityEmail: string,
  credential: Buffer,
  authorizeDispatch: () => Promise<{ expiresAt: string }>,
  request: SignupRequest = fetch,
  clock: () => Date = () => new Date(),
): Promise<SignupReceiptEvidence> {
  const url = new URL("/signup", account.employerOrigin).toString();
  try {
    const permit = await authorizeDispatch();
    if (Date.parse(permit.expiresAt) <= clock().getTime())
      throw new DomainError("LEASE_STALE", "Signup dispatch permit expired.");
    let response: Response;
    try {
      response = await request(url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: identityEmail, password: credential.toString("utf8") }),
      });
    } catch {
      throw new DomainError("COMMIT_UNKNOWN", "Signup response was lost.");
    }
    if (response.status === 422) throw new SignupDefinitiveRejection();
    if (response.status !== 201)
      throw new DomainError(
        "COMMIT_UNKNOWN",
        `Signup outcome is unknown after ${response.status}.`,
      );
    const body = responseSchema.parse(await response.json());
    if (body.identityEmailHash !== account.identityEmailHash)
      throw new DomainError("RECEIPT_UNCORRELATED", "Signup response identity does not match.");
    return signupReceiptEvidenceSchema.parse({
      providerAccountId: body.accountId,
      employerOrigin: account.employerOrigin,
      adapterId: account.adapterId,
      identityEmailHash: body.identityEmailHash,
      receivedAt: clock().toISOString(),
    });
  } finally {
    credential.fill(0);
  }
}
