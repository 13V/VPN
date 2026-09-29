# Vercel deployment

The public site contains a landing page and an access-status page. Vercel publishes the landing page as the static root and runs `api/index.js` for `/portal` and API requests. The hosted handler is fixed to `launch` mode: `/api/bootstrap` reports `serviceAvailable: false`, and wallet, account and plan endpoints return 404. The earlier interactive prototype and private Blob state are not used by the hosted site. No supplier or payment credential is needed in Vercel.

## Reproduce

1. Install Node.js 22+; run `npm ci`, `npm test` and `node scripts/build-vercel.js`.
2. Link the checkout to the intended Vercel project with `vercel link`. Keep `.vercel` and credentials out of Git.
3. Set `VPN_ORIGIN` to the exact public HTTPS origin and `NODEJS_HELPERS=0` in production. The current origin is [vpn-one-phi.vercel.app](https://vpn-one-phi.vercel.app). The old `VPN_PORTAL_MODE` and Blob variables are ignored by the public handler and can be retired after confirming no other deployment uses them.
4. Run `vercel deploy --prod`. The build executes the offline test suite. Never place a Vercel token in source, documentation or a committed environment file.
5. Check `/` and `/portal` on desktop and phone, then check `/api/bootstrap` reports launch mode and `/api/auth/demo`, `/api/tunnels`, `/app.js` all return 404. Verify the site displays no live token address, holder allowance or working VPN connection.

The supplier validation CLI remains a separate local operator tool. It is not exposed as an HTTP route. Real VPN provisioning still needs the live acceptance in [validation-report.md](validation-report.md), a funded holder policy and production infrastructure before a service can be opened.
