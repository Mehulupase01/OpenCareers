import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { commitSignup, SignupDefinitiveRejection } from "../../packages/accounts/src/signup.js";
import type { EmployerAccount } from "../../packages/contracts/src/account.js";

const email = "candidate@example.test";
const hash = createHash("sha256").update(email).digest("hex");
const account: EmployerAccount = {
  id: randomUUID(),
  candidateId: randomUUID(),
  employerOrigin: "https://careers.synthetic.example",
  adapterId: "synthetic-signup",
  identityEmailHash: hash,
  state: "prepared",
  hasCredential: true,
  createdAt: "2026-09-28T12:00:00.000Z",
  updatedAt: "2026-09-28T12:00:00.000Z",
};
const clock = () => new Date("2026-09-28T12:00:00.000Z");

describe("one-action account signup", () => {
  it("authorizes immediately before one exact-origin POST and correlates the receipt", async () => {
    let permits = 0;
    let posts = 0;
    const evidence = await commitSignup(
      account,
      email,
      Buffer.from("synthetic-password"),
      async () => {
        permits++;
        return { expiresAt: "2026-09-28T12:00:10.000Z" };
      },
      async (url, init) => {
        posts++;
        expect(url).toBe("https://careers.synthetic.example/signup");
        expect(init.method).toBe("POST");
        return new Response(JSON.stringify({ accountId: "external-1", identityEmailHash: hash }), {
          status: 201,
          headers: { "content-type": "application/json" },
        });
      },
      clock,
    );
    expect(evidence).toMatchObject({ providerAccountId: "external-1", identityEmailHash: hash });
    expect({ permits, posts }).toEqual({ permits: 1, posts: 1 });
  });

  it("separates definitive rejection, lost response and uncorrelated success", async () => {
    const permit = async () => ({ expiresAt: "2026-09-28T12:00:10.000Z" });
    await expect(
      commitSignup(
        account,
        email,
        Buffer.from("one"),
        permit,
        async () => new Response("", { status: 422 }),
        clock,
      ),
    ).rejects.toBeInstanceOf(SignupDefinitiveRejection);
    await expect(
      commitSignup(
        account,
        email,
        Buffer.from("two"),
        permit,
        async () => {
          throw new Error("lost");
        },
        clock,
      ),
    ).rejects.toMatchObject({ code: "COMMIT_UNKNOWN" });
    await expect(
      commitSignup(
        account,
        email,
        Buffer.from("three"),
        permit,
        async () =>
          new Response(
            JSON.stringify({ accountId: "external-2", identityEmailHash: "0".repeat(64) }),
            { status: 201, headers: { "content-type": "application/json" } },
          ),
        clock,
      ),
    ).rejects.toMatchObject({ code: "RECEIPT_UNCORRELATED" });
  });

  it("zeroes decrypted credential bytes when dispatch authorization fails", async () => {
    const credential = Buffer.from("must-be-zeroed");
    await expect(
      commitSignup(
        account,
        email,
        credential,
        async () => {
          throw new Error("revoked");
        },
        async () => {
          throw new Error("must not post");
        },
        clock,
      ),
    ).rejects.toThrow("revoked");
    expect(credential.every((byte) => byte === 0)).toBe(true);
  });
});
