# First contact — use the channel their (pending) SECURITY.md designates

zkPassport has an **open** PR ([zkpassport/zkpassport-packages#202 — chore: Create SECURITY.md](https://github.com/zkpassport/zkpassport-packages/pull/202))
that defines a security disclosure policy. It's not merged yet, but the
intent is clear and the contact addresses are real. The policy says:

> Use [GitHub Private Vulnerability Reporting](https://github.com/zkpassport/zkpassport-packages/security/advisories/new).
> Or email **security@aztec-labs.com** — but **don't include details**;
> use GitHub for the actual submission.

Current state (checked 2026-05-25): **Private Vulnerability Reporting is
not yet enabled** on the repo (`security_and_analysis: null`). The
endpoint exists but is gated. Likely flips on when #202 merges.

## Recommended path

1. **Try [the GitHub PVR endpoint](https://github.com/zkpassport/zkpassport-packages/security/advisories/new)
   first** — sign in to GitHub, navigate there. If it lets you submit,
   use the full report content from
   `zkpassport-security-disclosure.md`. Done.
2. **If PVR is gated**, send a *content-light* email to
   `security@aztec-labs.com` per the proposed policy. Body below.
3. If neither bears fruit in ~5 business days, follow up by commenting
   on PR #202 itself asking when PVR will be enabled.

## Email draft (use only if PVR is gated)

**To:** security@aztec-labs.com
**Subject:** Security: requesting private channel for `@zkpassport/sdk`
trust-model finding

Hi,

I'm an integrator building on `@zkpassport/sdk` and have a non-trivial
security finding regarding the SDK's trust model. Following the proposed
policy in [zkpassport/zkpassport-packages#202](https://github.com/zkpassport/zkpassport-packages/pull/202),
which says to use GitHub Private Vulnerability Reporting at
https://github.com/zkpassport/zkpassport-packages/security/advisories/new
— I tried that endpoint but PVR isn't enabled on the repository yet.

Per the proposed policy I'm omitting details from this email. Could you
either:

- Enable Private Vulnerability Reporting on `zkpassport-packages` so I
  can submit there, or
- Confirm an alternate private channel (encrypted email, Signal, etc.)

To set expectations: my default disclosure window is 30 days from your
acknowledgement, willing to extend.

Reply to john.franklin@sycamore.llc.

Thanks,
JF
