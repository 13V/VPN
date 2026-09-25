# MVP validation — 2026-09-19

**79 automated tests passed in the Vercel production build.** The original 63 tests also passed locally on Node.js 24.19.0, followed by the added 14 hosted-state tests and two asynchronous HTTP tests. Automated tests run offline against temporary state, a fake Blob service and test signatures.

| Check | Observed result |
| --- | --- |
| Demo browser login | New sample allowance: $3.50 |
| Create Australia one-day sample | One tunnel displayed; balance $3.00; 50 GB sample allowance |
| Extend same sample | Same tunnel; balance $2.50; expiry increased one day; sample bandwidth 100 GB |
| Reload | Balance, tunnel, expiry and both activity records retained |
| Download | Sample `.txt` download completed; UI explicitly says it cannot establish a VPN connection |
| Guide | Dialog opens, takes focus and dismisses with Escape |
| Landing page | Public introduction at `/`, portal at `/portal`; mobile menu opens and closes after navigation, FAQ expands, demo link opens the portal |
| Visual update | Bone/forest/sage design on both pages, custom glass sculpture artwork and editorial typography, readable demo boundaries and source/report links; demo creation still works after styling changes |
| Responsive layout | Desktop 1440-pixel viewport and narrow 390-pixel viewport inspected; narrow content width equals available width, no horizontal overflow |
| Browser logs | No captured warnings/errors during the demo flow |
| Authentication | HTTP test signs the exact challenge with a generated EOA key, verifies wallet session and zero unconfigured allowance; replay, expiry and wrong signer rejected |
| Spending gates | Wallet and preview sessions cannot provision; invalid `live` mode rejected |
| Persistence and retries | Restarted store retains orders; retries return original result without another debit; concurrent write blocked; ownership checks prevent another account's access |

No real browser wallet was connected during manual checking. Wallet signatures were tested using generated keys through the real HTTP handlers. No live VPN, supplier payment, on-chain fee funding or token launch occurred. Local sample state remains outside the repository; hosted sample state uses a private Vercel Blob store.

## Public deployment — 2026-09-19

Published [the website](https://vpn-one-phi.vercel.app) and [portal](https://vpn-one-phi.vercel.app/portal) to Vercel project `vpn`. Runtime source: commit `6bb2aa6`; production deployment `dpl_7KbMh3fa3Sb16Cy3C2vRSzqKutbZ`. See [deployment setup](vercel.md).

| Live hosting check | Observed result |
| --- | --- |
| Landing, portal and artwork | Public HTTP 200; landing opens first, CTA navigates to portal, bundled artwork renders |
| Demo login | Secure, HttpOnly, SameSite=Strict cookie; $3.50 sample allowance |
| Create and retry | One sample tunnel; repeated request returns the same result; sample balance $3.00 |
| Renewal | Same tunnel; expiry adds one day, bandwidth becomes 100 GB; balance $2.50 |
| Persistence | Subsequent HTTP requests retain allowance, tunnel and activity through private storage |
| Download | HTTP 200, `.txt` attachment explicitly states it cannot establish a real VPN connection |
| Logout | Persisted session invalidated; next bootstrap returns no session |
| Origin enforcement | Foreign-origin mutation rejected with HTTP 403 |
| File exposure | `/.env`, `/portal.json`, and server-source path return HTTP 404 |
| Browser journey | Landing-to-portal navigation, demo sign-in and sample creation verified in the deployed browser |

Initial deployment checking found Vercel's static `index.html` taking precedence over the root rewrite; the deployment build now publishes the landing page as that static index. Renewal checking also exposed a weak ETag on compressed Blob responses. State reads now request identity encoding and require a strong ETag before conditional writes. Both fixes were deployed; the full API smoke flow subsequently passed. A regression test rejects weak ETags without modifying saved state.

These observations validate hosting and sample provisioning only. Offline tests simulate lost responses and competing serverless instances; they are not evidence of supplier recovery or production traffic capacity. Hosting/Blob usage was incurred, but no VPN purchase was made.

The GitHub Actions template remains inactive because the available GitHub login lacks workflow-write permission. Node.js 22 support is specified, but the reported local run used Node.js 24.19.0.

## Velora clarity update — 2026-09-22

Adopted the approved Velora vector identity. Landing copy now explains community-funded VPN access directly. The portal shows a single demo-start action before revealing the plan workspace; sample funding metrics are removed from the visible dashboard. Creation and renewal use clearer plan labels with visible sample costs. All 79 tests passed before deployment. Local browser checks verified start, create, the balance change to $3.00, and 390px layouts without horizontal overflow. Real purchases remain disabled.

## Holder access presentation — 2026-09-23

The public landing and portal now explain the proposed benefit as VPN data covered by trading fees for eligible holders, without a separate VPN payment. The portal presents the fixed demo cap as seven sample plan-days instead of dollar credit; creating a one-day sample shows six days left, and extending it shows five. The underlying allowance ledger and retry protections are unchanged. Sample days are illustrative, not an announced holder allocation. Local browser checks covered creation, renewal and 320px/390px layouts without horizontal overflow. No live VPN access or token-funded eligibility was activated.

The Holder Access pass now carries the same mark, typography, palette, sample-day meter, eligibility, location and plan detail from the landing hero into the portal. The landing connection preview requires a deliberate tap and labels its simulated state. The portal uses the same editorial type and quieter card geometry at desktop and phone widths. All 79 offline tests passed; a local browser run created a sample plan and showed six days remaining. No supplier or on-chain behavior changed.

## Launch preparation — 2026-09-23

The landing page now shows separate statuses for the usable demo, token preparation and live VPN validation. An unsigned Pons V2 preflight reads Robinhood Chain mainnet, pins the official factory address, checks live code/configuration and launch fee, and refuses unset or changed launch terms. An intentionally incomplete manifest stays blocked; an offline test suite exercises fail-closed cases. A disposable manifest with placeholder addresses passed a read-only live chain check at the observed economics hash, demonstrating the checker only, not an approved Velora launch. **84 offline tests pass.** No token transaction, supplier order or VPN payment was made.
