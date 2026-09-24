# Velora holder portal

A Node.js 22+ launch website for Velora, a proposed holder-funded VPN. The landing page explains the idea; `/portal` shows the current access status and the checks required before service opens.

**[Open the website](https://vpn-one-phi.vercel.app)** · [View access status](https://vpn-one-phi.vercel.app/portal). Hosted on Vercel; real VPN purchasing remains disabled.

```sh
npm ci
npm start
```

Open [the local website](http://127.0.0.1:4173) to read the introduction, proposed funding model and FAQ. [Access status](http://127.0.0.1:4173/portal) clearly states that no VPN plan or holder benefit can be activated yet. The public launch mode serves no account, wallet or plan-creation API. The earlier interactive prototype remains in the repository for offline development tests but is not part of the hosted website. See [MVP history and remaining work](docs/mvp.md).

The original supplier-validation CLI remains available for testing nadanada purchase, renewal and interrupted delivery through Bitcoin Lightning. No token launch or treasury bridge is implemented. See [Vercel deployment instructions](docs/vercel.md) for hosting the public information pages.

For a first, **operator-assisted nadanada tunnel**, use the separate [manual Lightning pilot](docs/manual-pilot.md). It can create and validate one invoice, save a paid WireGuard configuration, verify status and request an extension. It never sends a payment, and the public holder access page remains informational. This route does not satisfy the original unattended-payment or lost-response recovery acceptance criteria.

For the token and service release sequence, required decisions, Pons fee mechanics and stop conditions, use the [dated launch-readiness checklist](docs/launch-readiness.md).

`npm run launch:preflight -- --manifest launch/manifest.example.json` performs a **read-only**, deliberately blocked Pons V2 check against Robinhood Chain. Copy and fill a private manifest only after choosing the immutable launch terms; the checker never holds a signer or sends a transaction. See the launch checklist for its scope and required human review.

**Live spending is blocked.** Blink's inspected payment input has no enforceable maximum fee or total-debit parameter. Adding credentials does not remove this gate. Offline simulations work; paid supplier validation remains outstanding. See the [dated evidence report](docs/validation-report.md).

## Setup

Install Node.js 22 or later, clone this repository, then run:

```sh
npm test
npm run catalogue
npm run preflight
npm run vpn -- purchase
npm run report
```

Run `npm ci` first to install the pinned dependencies. Tests use local fixtures and temporary directories, never real payments. Catalogue and preflight access public supplier/Blink endpoints. All supplier CLI commands default to read-only behaviour. The hosted website does not create orders or accept payments.

`docs/offline-tests.workflow.yml` is an optional GitHub Actions template for Node.js 22/24. It is inactive; a login with workflow-write permission can place it at `.github/workflows/test.yml` to enable CI.

For eventual authenticated reconciliation, supply `BLINK_API_KEY` and `BLINK_WALLET_ID` through local environment variables for a **separately funded BTC test wallet**. Never use a production treasury wallet. `.env.example` contains variable names only; Node does not load it automatically. If using an environment file, keep it outside the repository and invoke `node --env-file=/private/path/test.env src/cli.js preflight`. Never commit its contents.

## Commands

| Command after `npm run vpn --` | Purpose |
| --- | --- |
| `catalogue` | Read catalogue; require AU and the $0.50 one-day plan |
| `preflight` | Read catalogue, exchange rate and payer cap capability |
| `purchase [--live]` | Start the fixed `primary` scenario |
| `renew [--live]` | Extend the primary public key by one day |
| `recovery [--live]` | Separate public key; discard the first completion response |
| `resume primary\|renewal\|recovery [--live]` | Reconcile an existing order and continue |
| `status [primary\|renewal\|recovery]` | Read local summary or supplier subscription status |
| `replay primary\|renewal\|recovery [--live]` | Repeat completion without another payment |
| `export primary\|renewal\|recovery [--live]` | Save secret configuration locally; never print it |
| `report` | Print a redacted local evidence summary |

`--live` authorizes mutation, not a bypass of the cap. The current Blink adapter always refuses payment. A future adapter must prove server-enforced **maximum total debit**, including fees, before enabling the live path. A fee probe is insufficient. Its implementation must also verify the invoice signature before payment; the bundled BOLT11 decoder checks encoding and fields but does not authenticate its signature.

After that prerequisite is resolved, run purchase and then resume to reconcile the wallet before configuration retrieval. Complete primary before renewal, then complete renewal before recovery. Resume recovery to test redelivery after the deliberately discarded response. Run replay on a completed order to record repeated completion behaviour. Each invocation advances the persisted state; unresolved results must be investigated, never replaced with another purchase.

## Spending and recovery rules

The campaign freezes a timestamped Blink USD-per-satoshi quote and floors `$2 / rate` to set a satoshi ceiling. Each invoice must match the catalogue and independent current rate within 5% (or two sats for rounding). The plan selector `duration: 0.5` means the catalogue's one-day $0.50 product, not half a day. Country/price changes stop execution.

Only three fixed scenarios exist, targeting $1.50 of service. Each payment reserves its invoice plus at most $0.10 of routing fees at the recorded campaign rate, subject to the remaining campaign ceiling. Confirmed debit replaces the reservation; unresolved or failed sends retain it conservatively. The dollar ceiling is measured at the recorded quote, not guaranteed against later BTC price movements.

Invoices and send intent are saved before payment. Every continuation queries payment status first. Pending/ambiguous sends are never automatically resent. Lost invoice requests are terminal because no documented request-idempotency mechanism is assumed. Lost completion responses retry only the same paid completion endpoint; `409` becomes `config_unrecoverable`, never a new invoice.

## Secret local state

The journal includes private keys, invoices, payment references and configurations. It must stay private and out of Git and cloud sync. Default directory on Windows: `%LOCALAPPDATA%/13V/VPN-validation`; elsewhere: `~/.local/state/13V/VPN-validation`. Set `VPN_STATE_DIR` only to a private local directory outside the checkout. Git ignore rules are a secondary defence, not encryption.

Keys are generated locally using X25519; only the public key and preshared key are sent to the supplier. Returned configuration is restricted to expected WireGuard directives, and the private key is inserted locally. Export refuses to overwrite an existing file.

Journal writes use a flushed temporary file and atomic rename. A filesystem lock excludes other mutating processes. A crash leaves the lock in place: verify that its recorded process is no longer running before manually removing **only `campaign.lock`**. Never delete the journal to retry an uncertain payment. File permissions request owner-only access on POSIX; on Windows the directory inherits local Windows ACLs, which you must keep private. The journal is not encrypted, and full power-loss durability across filesystems is not claimed.

## Acceptance

Offline tests cover purchase, renewal, invalid/expired invoices, pending and ambiguous payment, restart, duplicate requests, process locking, supplier errors, catalogue changes, lost configuration responses and budget enforcement. They are not evidence of real supplier recovery. Live connection, DNS behaviour, throughput, redistribution permission and privacy claims remain unverified. No supplier messages are sent by this project.

MIT; see [NOTICE.md](NOTICE.md) for OTT attribution.
