# MVP validation — 2026-09-19

**62 automated tests passed locally on Node.js 24.19.0.** This includes the original 37 supplier-validation tests, 13 wallet-authentication tests and 12 portal/model/HTTP tests. Automated tests run offline against temporary state and test signatures.

| Check | Observed result |
| --- | --- |
| Demo browser login | New sample allowance: $3.50 |
| Create Australia one-day sample | One tunnel displayed; balance $3.00; 50 GB sample allowance |
| Extend same sample | Same tunnel; balance $2.50; expiry increased one day; sample bandwidth 100 GB |
| Reload | Balance, tunnel, expiry and both activity records retained |
| Download | Sample `.txt` download completed; UI explicitly says it cannot establish a VPN connection |
| Guide | Dialog opens, takes focus and dismisses with Escape |
| Responsive layout | Desktop 1440-pixel viewport and narrow 390-pixel viewport inspected; narrow content width equals available width, no horizontal overflow |
| Browser logs | No captured warnings/errors during the demo flow |
| Authentication | HTTP test signs the exact challenge with a generated EOA key, verifies wallet session and zero unconfigured allowance; replay, expiry and wrong signer rejected |
| Spending gates | Wallet and preview sessions cannot provision; invalid `live` mode rejected |
| Persistence and retries | Restarted store retains orders; retries return original result without another debit; concurrent write blocked; ownership checks prevent another account's access |

No real browser wallet was connected during manual checking. Wallet signatures were tested using generated keys through the real HTTP handlers. No live VPN, supplier payment, on-chain fee funding, token launch or public deployment occurred. Sample session data stays in the private local portal directory, outside this repository.

The GitHub Actions template remains inactive because the available GitHub login lacks workflow-write permission. Node.js 22 support is specified, but the reported local run used Node.js 24.19.0.
