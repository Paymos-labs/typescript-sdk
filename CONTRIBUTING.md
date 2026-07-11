# Contributing

1. Create a focused branch and keep each pull request to one coherent change.
2. Run `npm ci`, `npm run check`, `npm test`, `npm run build`, and `npm pack --dry-run`.
3. Add tests for every wire-contract, signing, retry, pagination, or webhook behavior change.
4. Do not commit credentials, `.env` files, recorded production payloads, or customer data.

Public API changes require a changelog entry and must remain compatible within a major version.
