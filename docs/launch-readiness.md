# Velora launch readiness — 2026-09-23

This is a decision record and release checklist, not authorization to issue a token, move treasury funds, or enable paid VPN provisioning. Recheck external facts immediately before signing a launch transaction. The project is independent of Robinhood.

## Current decision

| Release | Current status | What can be said publicly |
| --- | --- | --- |
| Website and sample portal | **Ready as a prototype.** Deployed at https://vpn-one-phi.vercel.app; 84 offline tests pass. | Visitors can explore sample plans and simulated connection states. No VPN or payment is activated. |
| Token on Pons | **Not ready to sign.** Token terms, fee recipient, funding policy, legal review and final launch configuration are unset. | The project intends to explore token-funded access. No token address, allocation or launch date is final. |
| VPN benefit for holders | **Blocked.** No paid supplier delivery/recovery test, enforceable Lightning debit cap, redistribution permission or tunnel quality evidence. | Access is proposed, not available or guaranteed. Wallet sign-in alone grants no VPN service. |

The preferred sequence is a transparent prototype, then a separately reviewed token release, then a closed live-service pilot after the supplier and funding gates pass. If the token releases before the VPN benefit, the launch page and social copy must say that the benefit is **in development**, with no date or guaranteed amount.

## Facts checked on 2026-09-23

- Robinhood Chain mainnet is chain ID **4663**; testnet is **46630**. ETH pays gas. The public RPC is rate-limited and Robinhood recommends a provider for production reads. [Robinhood Chain connection guide](https://docs.robinhood.com/chain/connecting/).
- Pons has materially different V1 and V2 launch mechanisms. V2 uses a bonding curve that later graduates to a locked Uniswap V4 pool; its creator revenue is a share of the standard trading fee plus any creator tax fixed at launch. It is paid in the quote asset, accrues before being swept and claimed from escrow, and does **not** flow directly to a VPN supplier. Quote asset, creator tax, buyback choice and fee recipient need explicit review before launch. [Pons V2 documentation](https://docs.ponsfamily.com/v2), [Pons contract repository](https://github.com/ponsdotdev/pons-labs).
- The read-only Pons V2 check on 2026-09-23 reached the factory published by Pons on chain 4663. It found deployed code, one enabled launch config, a 0.0005 ETH launch fee and a 1,000-basis-point creator-tax cap. These can change; the selected config and economics hash must be reread at signing time.
- A read-only nadanada catalogue check found Australia and a one-day **$0.50** entry. The Blink preflight found no verified server-enforced maximum total debit, so this repository still blocks live spending. These are point-in-time observations, not a price or availability guarantee. Run `npm run catalogue` and `npm run preflight` again before any paid pilot. [Supplier validation evidence](validation-report.md).
- `npm audit --omit=dev --audit-level=high` found no known vulnerabilities in the current installed dependency tree. This is a point-in-time dependency check, not an audit of the app or Pons contracts.
- Australian regulators say token fundraising and future benefit claims can carry legal obligations; the exact treatment depends on the token and offer. Obtain advice on the actual launch structure and final copy. [ASIC crypto-assets guidance](https://asic.gov.au/regulatory-resources/digital-transformation/crypto-assets/), [ACCC future-claims guidance](https://www.accc.gov.au/consumers/advertising-and-promotions/false-or-misleading-claims).

## Decisions required before a token transaction

Record each decision with an owner and date. Do not infer a value from the current demo.

| Decision | Required evidence |
| --- | --- |
| Scope and audience | Token-only prototype release or live benefit; countries where token and service will be offered; legal review of that exact offer. |
| Pons generation and immutable terms | V1 or V2; verified active factory; launch config; pair/quote asset; supply; creator tax; base-fee split; buybacks; any opening-buy/exemption settings; launch fee and gas. Read the live contract and simulate the exact transaction before signing. |
| Identity | Final token name/symbol, artwork, description and social URLs; one canonical domain; official token-address publication procedure. Names and symbols can be copied, so the address must be the identifier. |
| Funds and custody | Separate launch wallet and creator-fee recipient; access control, recovery and signers; fee-sweep/claim ownership; conversion from quote asset to a separately funded Lightning payment wallet; accounting and reserve policy. Never put keys or wallet secrets in Git or Vercel. |
| Benefit policy | Verified holder snapshot method, threshold, eligibility cadence, per-holder cap, treatment when fees are insufficient, pilot size and stop rule. Publish only after it can be funded and enforced. |
| Public operations | Terms, privacy notice, risk/limitations, support channel, incident contact, domain ownership and monitoring. Review privacy claims against the actual supplier and data flows. |

Avoid assuming trading volume. A service budget should use **received, claimable, converted funds**, less fees and a reserve. At the currently observed $0.50 one-day price, 100 one-day supplier orders would cost at least $50 before routing fees and support; this is an illustration, not the proposed holder allocation. Pons creator earnings depend on the exact launch terms and real trades. Never allocate more benefit than settled spendable funds.

## Unsigned Pons V2 preflight

The repository includes a [manifest example](../launch/manifest.example.json) and a read-only checker. Keep the filled manifest private at `launch/manifest.json` (ignored by Git), or at another local path. The manifest contains public launch terms and wallet addresses, never seed phrases, private keys or API credentials.

```sh
cp launch/manifest.example.json launch/manifest.json
npm run launch:preflight -- --manifest launch/manifest.json
```

The example deliberately fails. Fill the final name/symbol/metadata, signing and fee-recipient addresses, direct `launchToken` method, fresh one-use salt, explicit exemption list, live config ID, ETH quote address, creator tax, buyback decision and maximum launch fee. The checker prints the current factory bytecode hash and `previewLaunchEconomics` pin once a config and quote asset are selected; **independently verify the factory, then record those exact hashes** in the manifest and rerun. It rejects a changed chain, factory bytecode, fee cap, disabled config, ineligible wallet or changed economics. It currently supports a direct Pons V2 launch priced in native ETH with no opening buy; a V1, custom-pair or bundled-buy path needs its own reviewed preflight. A technical `PASS` does not sign, simulate or authorize a transaction and does not substitute for the human and legal checks below. Use a trusted RPC via `ROBINHOOD_RPC_URL` for final reads rather than relying on the rate-limited public endpoint.

## Live-benefit gates

All must be evidenced before changing the website from “in development” to “available” or allowing real orders:

1. **Supplier delivery:** Pay for an Australia one-day test, save its usable WireGuard configuration, verify status, extend the same key, and repeat completion. Deliberately lose a configuration response and recover the original usable configuration without paying again. A status response or `409` without the configuration is not recovery.
2. **Payer safety:** Use a separately funded test wallet and an adapter that proves a server-enforced maximum **total debit including fees**. Verify invoice signature, amount, hash, expiry and catalogue price; reconcile ambiguous sends before retrying. Keep the current live-spending block until this is demonstrated.
3. **Commercial and network quality:** Obtain explicit commercial redistribution permission. Test a real tunnel, DNS/leak behaviour, throughput, outages, renewal and revocation from each supported client platform. Do not claim “no logs,” anonymity or quality without evidence.
4. **Funding and eligibility:** Derive snapshots from the correct deployed token and a documented finality rule; reconcile actual creator fees through sweep, claim and conversion; set funded caps; prevent double allocation and stale snapshots. Publish the policy and what happens when funding runs out.
5. **Production operations:** Keep Blink/test-wallet credentials out of the public Vercel portal environment; a separate, restricted worker should hold any future payer secret. Move live configurations into encrypted storage, use a transactional database and recoverable order worker, establish backups, retention, alerting, rate limits, a manual pause and an incident process. Vercel Blob currently holds demo state only.

## Release rehearsal

- **Before the public announcement:** Run `npm ci`, `npm test`, `node scripts/build-vercel.js`, the catalogue/preflight commands, and a desktop/mobile browser journey. Check HTTPS, the canonical domain, `/portal`, CSP, sample-only copy, broken links, and an unauthenticated session. Verify that the site never displays a token address before it is confirmed on chain.
- **Before signing a Pons launch:** Have a second person compare the exact transaction preview against the recorded terms and verified contract addresses. Confirm chain ID 4663, signer, recipient, quote asset, tax, buyback setting, launch fee, gas and any optional buy. Use a test or simulation for the selected Pons generation. Do not use an unreviewed automation or a copied token name as confirmation.
- **After confirmation:** Record the transaction hash, block, token and curve/pool address from the explorer. Confirm source/bytecode and on-chain metadata; then publish the token address on the canonical site and link to the explorer. Reconcile Pons fee accrual, sweep and claim paths with a small amount before relying on them for the budget.
- **During the first day:** Watch the site, login errors, Blob capacity, RPC/indexer results, fee accounting, support requests and misleading-copy reports. If any gate fails, pause the feature or announcement and keep the demo available with its limitations visible.

## Stop conditions

Do not sign the token transaction if the recorded Pons terms differ from the live preview, the legal/copy review is incomplete, the fee recipient is unverified, or the official domain and address-publication process are not controlled. Do not enable live VPN orders if any live-benefit gate above is incomplete. A successful demo, a token launch, or a growing trading-fee balance does not by itself validate supplier recovery or fund a specific holder allowance.
