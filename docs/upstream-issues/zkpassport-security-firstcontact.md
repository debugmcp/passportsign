# First contact — request a private disclosure channel

Goal: ask zkPassport for the right private address *before* sending any
technical detail. Use both channels in parallel:

- **Channel A (form):** [zkpassport.id](https://zkpassport.id) → "Get in
  touch" form (or "Contact us"). Brief and label clearly as security.
- **Channel B (email):** `saleel@saleel.xyz` (confirmed contributor
  email — on his GitHub profile and personal site). Cc'ing him directly
  is reasonable; he can route internally.

If neither responds within ~5 business days, escalate by opening a public
GitHub issue on `zkpassport/zkpassport-packages` titled
`Request: please enable private vulnerability reporting and/or publish a security contact`
— that's a known tactic that gets fast attention without leaking detail.

---

## Form/email body (same text works for both)

**Subject:** Private security disclosure on `@zkpassport/sdk` — requesting
a private channel

Hi zkPassport team,

I'm an integrator building on `@zkpassport/sdk`. While debugging a
Node-CLI issue I tripped over what looks like a non-trivial gap in the
phone-side trust model. I'd like to disclose privately and align on a
coordinated timeline.

I didn't see a `SECURITY.md`, a published security contact, or
GitHub's private vulnerability reporting enabled on
`zkpassport-packages` — so I wanted to ask you directly: where should I
send the details?

Happy to share a description over any channel you prefer (encrypted
email, Signal, a private GitHub Security Advisory if you enable it,
etc.). To set expectations: my default disclosure window is 30 days
from your acknowledgement, willing to extend if you ask.

Reply to john.franklin@gmail.com whenever convenient.

Thanks,
JF (https://github.com/[your-username])
