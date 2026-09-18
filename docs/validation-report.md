# nadanada validation — 2026-09-18

**Decision: suitability for unattended integration is not established.** No paid live scenario has run. No invoices were requested, funds spent or supplier messages sent during this implementation.

The harness and offline tests are implemented. Public read-only catalogue and Blink schema checks succeeded. Paid validation is blocked because Blink has no verified maximum-total-debit control in the inspected payment operation, and no test-wallet credentials are present. WireGuard is not installed here; provisioning would not establish connection quality even if paid tests succeeded.

Local validation: **37 tests passed** on Node.js 24.19.0. An explicit `purchase --live` returned `LIVE_PAYMENT_BLOCKED` before requesting an invoice. A Node.js 22/24 CI template is provided as `docs/offline-tests.workflow.yml`; it is inactive because the current GitHub login lacks workflow-write permission. No remote CI run is claimed.

## Redacted evidence

| Area | Documented behaviour | Observed evidence | Result |
| --- | --- | --- | --- |
| Catalogue | `/vpn/countries` supplies countries and duration selectors | Public GET on 2026-09-18: AU code `19`; one day, selector `0.5`, USD `0.50` | Read-only verified |
| Payment | Request/extend returns Lightning invoice; completion requires payment | No live invoice/payment; offline successful, rejected, expired, pending, mismatched and ambiguous cases pass | Paid behaviour unverified |
| Payer cap | Blink `LnInvoicePaymentInput` defines payment fields | Public schema: `memo`, `paymentRequest`, `walletId`; no maximum fee/debit field | Live spending blocked |
| Exchange rate | Blink public `realtimePrice` quote | At 2026-09-18T13:45:24.235Z: USD 0.00079180148438/sat; proposed ceiling 2,525 sats | Example only; campaign records a fresh quote |
| Delivery | `/vpn/config` completes a paid order and returns configuration | Offline success and restart simulations pass; no live configuration | Unverified live |
| Renewal | `/vpn/extend` uses the existing public key; completion activates extension | Offline expiry increase and bandwidth snapshots recorded; unchanged expiry stays unresolved | Unverified live |
| Lost delivery | `/vpn/config` documents one-time generation and `409 CONFIG_ALREADY_GENERATED`; status reports subscription metadata | Fixture tests demonstrate both recoverable repeat delivery and unrecoverable 409; neither is a live observation | Critical acceptance outstanding |
| Repeated completion | Documented 409 possibility | Replay command records same/different configuration, refused 409, or unresolved; not run live | Outstanding |
| Costs | Three $0.50 plans proposed, $2 including fees maximum | Actual spend: 0 sats; no live purchases | Within allowance |
| Permissions/privacy/quality | Supplier publishes terms/privacy statements | No redistribution agreement, independent privacy evidence or tunnel test obtained | Explicitly unverified |

Public observations can be reproduced with `npm run catalogue` and `npm run preflight`. These commands disclose no wallet identifiers, payment references, keys or configurations. Prices and API behaviour may subsequently change.

## Required live acceptance

1. Resolve the payment cap with a verified payer capability, then supply a separately funded test wallet through local environment variables. Do not weaken the ceiling to proceed.
2. Buy AU one day, save configuration and verify active status.
3. Extend the same public key; compare expiry and all returned bandwidth counters.
4. Buy a separate one-day tunnel, deliberately discard the first completion response and recover a usable configuration through documented endpoints without another payment.
5. Repeat completion and record whether the original configuration, HTTP 409 or another response occurs. Keep raw evidence private; add only redacted outcomes/cost totals here.

The precise supplier capability needed is **authenticated, repeatable retrieval of the original usable WireGuard peer configuration for an already-paid order**, or documented idempotent completion returning that configuration. Subscription status alone does not provide the server public key, endpoint, assigned addresses and other peer settings needed to reconstruct a tunnel. Until automatic recovery is demonstrated, do not mark the supplier suitable for unattended integration. A 409 after fulfilment cannot justify another purchase.

## Sources and evidence limits

- [nadanada OpenAPI](https://nadanada.me/api/v2/openapi.json): request, extend, config and status contracts, including completion conflict response.
- [Live catalogue](https://nadanada.me/api/v2/vpn/countries): publicly observed AU and one-day pricing.
- [nadanada terms](https://nadanada.me/terms) and [privacy policy](https://nadanada.me/privacy): supplier statements only, not independently validated claims or commercial redistribution permission.
- [Blink GraphQL endpoint](https://api.blink.sv/graphql): public introspection of `LnInvoicePaymentInput` and `realtimePrice(currency: "USD")`; inspected by the shipped adapter.

Offline fixtures test our state machine, not supplier availability, Lightning routing, invoice signatures, real bandwidth accounting or actual tunnel connectivity. The configuration recovery verdict must be updated from paid observations, not inferred from those fixtures.
