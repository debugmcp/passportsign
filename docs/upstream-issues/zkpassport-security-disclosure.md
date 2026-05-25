# Private security disclosure — DO NOT post publicly

Send privately to a zkPassport maintainer. Suggested addresses to try, in
order:

1. `security@zkpassport.id` (convention; may or may not exist)
2. Direct email to a maintainer found via their GitHub commit history on
   [zkpassport-packages](https://github.com/zkpassport/zkpassport-packages/graphs/contributors)
3. A Discord/Twitter DM to the official zkPassport account, asking for a
   private security email
4. If none of the above bear fruit within a week, file a GitHub issue
   marked **[SECURITY]** with the *abstract* version below (gap + impact)
   and ask them to triage privately before adding details.

If they confirm receipt, allow at least 30 days before any public
discussion.

---

## Email draft

**To:** security@zkpassport.id (if it bounces, see escalation list above)
**Subject:** Security: forgeable bridge `Origin` allows phone-side
project impersonation

Hi zkPassport team,

I'm a developer integrating `@zkpassport/sdk` from a Node CLI for a
project that binds GitHub accounts to passport-holding humans. While
debugging an unrelated issue I tripped over what looks like a
verifiable gap in the phone-side trust model. Sending privately so you
can decide on triage and disclosure timing.

### The gap

The "Trusted Domain" badge on the phone is determined by comparing the
WebSocket `Origin` header sent by `@obsidion/bridge` against the `d=`
parameter in the QR URL. Both values are entirely controlled by the
request creator. There is no challenge-response against a
project-side private key, no DNS-based attestation at handshake time —
just a string-matching check between two creator-supplied values.

In a browser, the WebSocket spec forces the real page Origin, which
makes the check meaningful for browser-based integrators. In Node, the
`ws` library (and by extension `@obsidion/bridge`) lets the developer
set Origin to any string. The bridge defaults to `"nodejs"`, but a
two-line patch can set it to anything, including any registered
project's domain.

### Reproducer

```ts
// Anyone can run this from anywhere, with no DNS or dashboard
// credential for "passportsign.dev" (substitute any registered domain).
import { ZKPassport } from "@zkpassport/sdk"; // 0.15.1, patched to forward
                                              // origin to Bridge.create
import qrcode from "qrcode-terminal";

const z = new ZKPassport("passportsign.dev");  // not the attacker's
const qb = await z.request({});                // domain
const { url, onResult } = qb.policy("nationality-disclose").done();
qrcode.generate(url, { small: true }, (qr) => console.log(qr));
onResult((r) => console.log("got disclosure:", r));
```

The phone displays this request with the legitimate project's name and
logo (fetched from the dashboard API by domain) **and the green/yellow
"Trusted Domain" badge for passportsign.dev**. Confirming the slider
sends the proof to the attacker's bridge.

### Impact

1. Phishing attacker can pose as any registered zkPassport project on
   the phone, with the full Trusted Domain badge and the project's
   real branding.
2. After the victim confirms, attacker obtains:
   - A valid zkPassport disclosure proof under the victim's identity
   - The `uniqueIdentifier` scoped to the impersonated project — a
     stable, deterministic identifier for that user-passport in that
     project's namespace
   - Any disclosed attributes (in the example: nationality)
3. Replay against the legitimate project isn't trivial (per-session
   nonces), but the identifier and disclosure leak alone enable
   correlation attacks. For projects that subsequently bind external
   identifiers (e.g. GitHub accounts) to the `uniqueIdentifier`, the
   attacker now knows the binding edge that should have been private
   to the legitimate operator.

### Why I'm reporting privately

The Node SDK works "naturally" (without my patch) by setting Origin to
the literal `"nodejs"`, which puts the phone in the silent
"unrecognized" state — slider blocked. That benign-by-default behavior
masks the gap from casual developers. A public bug report describing
the "fix" (pass real-looking Origin) would arm any attacker with the
exact recipe to exploit it. So I'm splitting the disclosure: the
Node-doesn't-work usability bug as a public issue (Origin defaulting
to `"nodejs"`), and this trust-model gap privately to you.

### Suggested mitigation (sketch — your call)

- The trusted-domain check should not be purely a string match between
  two creator-supplied fields. A challenge-response using a project-
  registered Ed25519 key (issued via the dashboard at project creation,
  rotatable) would let the phone verify the request was signed by the
  legitimate project, not merely *claiming* to be from it.
- The dashboard's per-project secret would be the integration's
  responsibility to keep safe — the same model as any API key.
- For a quicker partial mitigation: the phone could downgrade the
  "Trusted Domain" badge to "Domain claimed: X (verification pending)"
  when there's no signature attached, to stop conveying false
  confidence.

### Timeline ask

Happy to align on a coordinated disclosure timeline. My default
position: 30 days from your acknowledgement before any public mention
on my end (issues, blog, etc.). Will move that out if you ask.

If you'd like to discuss, I'm at john.franklin@gmail.com.

Thanks,
JF
