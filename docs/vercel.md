# Vercel deployment

The landing page and demo portal run on Vercel from this repository. Vercel runs `api/index.js` as a Node.js function. `scripts/build-vercel.js` copies the public assets into `dist/public` and makes the landing page its static `index.html`; the function serves `/portal` and API requests. The CLI supplier-validation engine is not exposed as an HTTP route. Live VPN purchasing remains blocked, including when Blink credentials exist in the hosting project.

## Reproduce

1. Install Node.js 22+ and run `npm ci` and `npm test`.
2. Link the checkout to the intended Vercel project with `vercel link`. Keep the generated `.vercel` directory and environment files out of Git.
3. Connect a **private** Vercel Blob store in Sydney to production. For example: `vercel blob create-store vpn-demo-state --access private --region syd1 --environment production --yes`. The connected store supplies `BLOB_READ_WRITE_TOKEN` as a server environment variable.
4. Set production environment variables: `VPN_ORIGIN` to the exact public HTTPS origin, `VPN_PORTAL_MODE=demo`, `NODEJS_HELPERS=0`, and `VERCEL_BLOB_RETRIES=0`. Raw Node request handling requires helpers disabled. Disabling SDK transport retries avoids spending a function's lifetime on an ambiguous write; callers retry their original action ID instead.
5. Run `vercel deploy --prod`. Authenticate through the CLI's login or a locally supplied token; never put a token in a script, this document or Git. The build runs the offline tests.
6. Check `/` serves the landing page and `/portal` opens the portal. Sign into the demo, create and extend a sample, refresh, and download its explicitly nonfunctional `.txt` setup preview. Confirm a retry does not debit twice.

The configured production origin is [vpn-one-phi.vercel.app](https://vpn-one-phi.vercel.app). Additional domains must be coordinated with `VPN_ORIGIN`, which binds signatures, cookies and mutation origin checks. GET requests reaching the function on another host redirect to the canonical origin. Preview deployments need their own environment settings and private store; production storage is connected to production only.

## State and limits

`portal/hosted-state.js` persists hashed session tokens, expiring login challenges and sample accounts in one private Blob document. Reads bypass the Blob cache and request identity encoding to preserve a strong ETag. Each mutation conditionally writes against that ETag, so concurrent requests cannot silently overwrite another request. Only explicit version conflicts are retried automatically. Unknown storage failures return an error without claiming success or resetting state. Retries of a sample provisioning request use its original idempotency key.

Sessions expire after eight hours. Expired or signed-out demo accounts and their action history are pruned on the next state transaction. Capacity is bounded by 1,000 sessions, 1,000 demo accounts, 20 actions per account and a 4 MiB document. This is a small demonstration store: a real launch needs a transactional database, backup and retention policy, monitored capacity, and an independently validated supplier/payment workflow.

The Node handler has a per-instance request throttle. On Vercel its key uses Vercel's `x-real-ip`; local servers use the socket peer. This does not provide a global distributed rate limit. Vercel's edge protections and account usage controls remain separate. Private Blob storage and function calls use the hosting account's normal usage allowance and billing; the deployment does not enable VPN spending or buy a domain.

## References

- [Vercel private Blob storage](https://vercel.com/docs/vercel-blob/private-storage)
- [Blob SDK and conditional writes](https://vercel.com/docs/vercel-blob/using-blob-sdk)
- [Node.js functions and request helpers](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration)
- [Vercel request headers](https://vercel.com/docs/headers/request-headers)
