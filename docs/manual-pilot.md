# Operator-assisted nadanada pilot — 2026-09-29

This is a narrow path to provision the first real Australia tunnel while the Blink debit cap and nadanada redelivery gaps remain unresolved. The CLI talks directly to nadanada, but **does not pay**. An operator must use a separate Lightning wallet with a deliberately limited balance and fee setting. The software cannot enforce the original $2 including-fees ceiling on that external wallet. Do not use a treasury wallet.

The public Velora site and access-status page remain informational, with no active VPN service. This pilot has no holder eligibility check, free allowance, token fees, automated payment, commercial redistribution permission or production secret storage. Keep the pilot journal and exported WireGuard configuration local, private and outside Git or cloud sync. Do not share the invoice or configuration in screenshots, issues or chat.

## First tunnel

Install Node.js 22+, then `npm ci` and `npm test`. `VPN_STATE_DIR` can point to a private local directory outside the checkout; the pilot uses its `manual-pilot` subdirectory. With no option, commands are read-only. `--live` authorizes a supplier mutation or local secret-file write, but never a wallet payment.

```sh
npm run catalogue
npm run pilot -- status
npm run pilot -- prepare primary --live
npm run pilot -- invoice primary
```

`prepare` checks the current catalogue for AU and the one-day $0.50 selector, generates WireGuard keys locally, requests one Lightning invoice, validates its amount/hash/expiry against the catalogue and an independent public Blink rate, and saves it before showing it. If the request or validation is uncertain, it stops without generating a replacement. `invoice` reveals the saved BOLT11 invoice in your local terminal. Inspect the amount and fee in your own wallet before paying. If it has expired, stop; there is no automatic reissue.

After paying the *same* invoice in the external wallet:

```sh
npm run pilot -- collect primary --live
npm run pilot -- status
npm run pilot -- export primary --live
npm run pilot -- replay primary --live
```

`collect` asks nadanada to complete the saved payment. A `402` means payment is still pending; retry `collect` later. A network error is uncertain; retry `collect` for the **same** order only. A `409` means nadanada reports the configuration was already generated and no usable response was saved locally; stop and investigate manually. No retry creates another invoice or payment. A successful response is saved before parsing, validated, combined with the locally held private key, and checked against the subscription status. `export` writes `primary.conf` in the protected pilot directory and refuses to overwrite it. Import that file into the official WireGuard client and perform the separate connection, DNS and throughput acceptance checks; the CLI cannot establish a tunnel on this machine.

`replay` makes one more completion request for the saved paid order. It records `same_configuration`, `different_configuration`, `refused_409`, or `unresolved` without creating an invoice or paying again. Preserve the wallet's actual debit and fee receipt privately for the evidence report.

For an extension of the same public key after a verified first tunnel:

```sh
npm run pilot -- prepare renewal --live
npm run pilot -- invoice renewal
npm run pilot -- collect renewal --live
npm run pilot -- replay renewal --live
```

The extension records status before and after and requires expiry to advance. It reuses the primary private/public key. The renewal configuration can be exported with `npm run pilot -- export renewal --live` if needed.

Only after primary and renewal are complete, test an interrupted delivery on a **separate, third one-day purchase**:

```sh
npm run pilot -- prepare recovery --live
npm run pilot -- invoice recovery
# Pay that exact saved invoice once in the limited external test wallet.
npm run pilot -- collect recovery --live
npm run pilot -- status
npm run pilot -- collect recovery --live
```

The first successful `collect recovery` deliberately discards the supplier's configuration response. The next `collect recovery` repeats completion for the **same paid order** and tests whether the original usable configuration can be recovered. A `402` before payment does not use up the deliberate discard. A `409` after fulfilment is recorded as `config_unrecoverable`; stop without requesting a replacement order. If the second call succeeds, export the recovered configuration and run the same WireGuard connection checks. `npm run pilot -- replay recovery --live` then records repeated-completion behaviour.

The intended pilot budget is three $0.50 supplier plans with a $2 total ceiling including Lightning routing fees, measured at the recorded exchange-rate quote. This manual path cannot enforce that cap in the external wallet: limit the separate wallet's available balance and verify each fee before paying. If the wallet cannot keep the total within the ceiling, stop. Do not disclose invoices, payment hashes or configurations in chat or Git.

The supplier's [current OpenAPI](https://nadanada.me/api/v2/openapi.json) says each payment can generate one configuration and documents `409 CONFIG_ALREADY_GENERATED` on repeat completion. It does not document a retrieve-original-config endpoint. Thus even a successful initial tunnel would not establish unattended reliability. The [validation report](validation-report.md) remains the acceptance record.
