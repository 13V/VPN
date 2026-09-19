# Holder portal MVP — September 2026

This is the first working product slice. The name, token address, holder allocation policy and launch are still undecided. The existing supplier-validation harness is preserved alongside the portal.

## What works

- Responsive dashboard with demo and wallet sessions, server-backed allowance display, tunnel list and activity.
- Demo tunnel creation, one-day extension and a clearly labelled sample setup download. Australia is the only initial location.
- Atomic local persistence, exclusive write locking, per-account ownership and request idempotency. Repeating the same request returns the saved original result without another allowance debit; changing its payload returns a conflict.
- EOA wallet ownership verified with an exact server-generated sign-in message. Short-lived, single-use nonces bind the signature to the configured domain, URI and chain. Opaque sessions use HttpOnly, SameSite=Strict cookies; HTTPS adds Secure.
- Optional operator-supplied weekly holder snapshot display, with funded-pool bounds and expired-snapshot rejection. This file is trusted operator input, not cryptographic proof of funding or ownership.

The demo is fully usable without a wallet. All credits, bandwidth and tunnel expiry shown in a demo session are samples. No network is connected, no traffic is measured and the sample download deliberately contains no usable keys or configuration. The demo's $3.50 allowance and $1,000 sample pool are interface fixtures, not an agreed token economy.

## Run locally

Node.js 22 or later:

```sh
npm ci
npm test
npm start
```

The website binds to `127.0.0.1:4173`. The public introduction, illustrated product explanation and FAQ are at `/`; the holder portal is at `/portal`. Use that exact hostname; request host and origin checks intentionally reject a different hostname. `npm start` does not call the supplier or Blink. It does not start recurring jobs or bridge any funds.

Configuration is read from process environment variables, not automatically from `.env`:

| Variable | Default / purpose |
| --- | --- |
| `VPN_PORTAL_MODE` | `demo`; use `preview` to disable demo sign-in. There is no live mode. |
| `HOST` / `PORT` | `127.0.0.1` / `4173` |
| `VPN_ORIGIN` | Exact browser origin, including port; domain used in sign-in messages and origin enforcement |
| `VPN_PORTAL_STATE_DIR` | Windows `%LOCALAPPDATA%/13V/VPN-portal`; otherwise `~/.local/state/13V/VPN-portal` |
| `VPN_ALLOWANCES_FILE` | Optional absolute private path to a funded weekly snapshot |

Keep portal state outside the checkout and outside cloud-synced folders. Sessions and login challenges are held in memory; server restart signs users out. Demo accounts are random per login, so a fresh demo login starts a new sample account. Persisted demo records are not a production customer database. Wallet addresses are personal identifiers: do not commit snapshots or portal state. POSIX files request owner-only permissions; Windows uses inherited ACLs.

Mutating API calls require the exact configured `Origin`, JSON content type, a bounded body and an authenticated session where applicable. Rate limiting uses the socket peer, not forwarded client headers. The app serves an explicit allowlist of page and asset paths and applies no-store, CSP and MIME-sniffing protection. The globe is a local SVG; neither page loads third-party images, fonts or trackers. Behind a reverse proxy, preserve the configured Host and use HTTPS; single-process sessions and peer-based throttling require adaptation before scaling.

## Weekly snapshots

The portal displays a local operator-produced snapshot for a real wallet if configured. An illustrative schema (not a launched token or real funding record):

```json
{
  "version": 1,
  "chainId": 4663,
  "tokenAddress": "0x1111111111111111111111111111111111111111",
  "blockNumber": 123,
  "startsAt": "2026-09-14T00:00:00Z",
  "endsAt": "2026-09-21T00:00:00Z",
  "fundedBudgetCents": 1000,
  "allocations": {
    "0x2222222222222222222222222222222222222222": 50
  }
}
```

Allocation keys must be lowercase wallet addresses. Amounts use integer USD cents, not floating-point dollars. The period must span exactly seven days and currently be active. Total allocations cannot exceed the declared funded budget. This importer does not query a chain or independently verify the operator's declaration of funding. Missing token/snapshot configuration grants zero allowance. Real provisioning remains blocked even with a valid snapshot.

Demo allowances reset at Monday 00:00 UTC without carryover. Purchases and renewals debit the same weekly balance. Previously used request IDs remain idempotent across week boundaries, preventing a response retry from spending again in a new week.

## Before real holders can use it

1. Select branding and token configuration, define the funded weekly allocation policy and generate snapshots from verified fee receipts and holder balances. Adapt OTT's snapshot process only after these inputs are known.
2. Finish the existing [supplier validation](validation-report.md): demonstrate recovery of a paid configuration after a lost response and obtain an enforceable payer debit cap. Adding Blink credentials alone cannot unlock purchases.
3. Connect an asynchronous, recoverable provisioning worker to allowance reservations. Persist and reconcile supplier orders before settling a holder's credit. The portal currently imports no payer and cannot spend.
4. Establish permission to redistribute service and substantiate privacy statements. Test an actual WireGuard connection, DNS behaviour and throughput.
5. Add deployment infrastructure, encrypted customer configuration storage, durable sessions, backup/retention rules and operational controls. No service has been deployed or scheduled by this MVP.

The intended chain ID is `4663`, checked against [Robinhood's network documentation](https://docs.robinhood.com/chain/connecting/). Wallet signatures use [ethers verifyMessage](https://docs.ethers.org/v6/api/hashing/) with a server-generated [EIP-4361-style message](https://eips.ethereum.org/EIPS/eip-4361); contract-wallet verification is outside this slice.
