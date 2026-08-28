# Changelog

## [Unreleased]

## [2.3.0] - 2026-08-28

- ci: the runner script joins the repo it tests
- release: the changelog rot had a cause, and it was not the one I named
- docs(sdk): the READMEs say static wallets, not payment channels
- feat(sdk): payment-channel webhooks and the flow in every README
- feat(typescript-sdk): payment channels, and a feed reader that cannot stop early
- feat(sdk-conformance): declare the payment-channel operations
- docs(api): pin the empty-body signing rule and fix the published POST vector
- ci(dependabot): track SDK dependencies at source

## [2.2.0] - 2026-08-28

- ci: the runner script joins the repo it tests
- release: the changelog rot had a cause, and it was not the one I named
- docs(sdk): the READMEs say static wallets, not payment channels
- feat(sdk): payment-channel webhooks and the flow in every README
- feat(typescript-sdk): payment channels, and a feed reader that cannot stop early
- feat(sdk-conformance): declare the payment-channel operations
- docs(api): pin the empty-body signing rule and fix the published POST vector
- ci(dependabot): track SDK dependencies at source

## [2.1.1] - 2026-08-02

- fix(ecosystem): recover SDK releases

## [2.1.0] - 2026-07-21

- feat(docs): make the developer surface consumable by LLM agents

## [2.0.3] - 2026-07-19

- fix: align SDK problem details semantics

## [2.0.2] - 2026-07-12

- fix(typescript-sdk): retry trusted npm publication

## [2.0.1] - 2026-07-12

- fix(release): align Ruby metadata and retry npm publication

## [2.0.0] - 2026-07-12

- feat(sdk): harden official package release gates
- feat(typescript-sdk): harden typed merchant contracts
- test(sdks): align webhook conformance envelope
- refactor(sdk): expose idiomatic camelCase contracts
- feat(sdk): add official Merchant API clients
- feat(ecosystem): automate SDK and plugin releases

## 1.0.0

- Initial official TypeScript and JavaScript SDK.
- Invoice create, get, list, iterate, cancel, confirm, and sandbox simulation.
- Withdrawal create, get, list, iterate, cancel, and sandbox simulation.
- Balance retrieval.
- HMAC-SHA256 request signing, typed RFC 9457 errors, bounded retries, and webhook verification.
