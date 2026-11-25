# rouvix-api: rules for agents and contributors

The GraphQL API of rouvix, a lost & found app for documents and objects, Cameroon
first: Bun, alxia, GraphQL Yoga, `@softistx/mongo`, `@softistx/redis`, `@softistx/s3`,
`@softistx/janus` and the house AI SDK `@softistx/ai-*`. The specification is
[docs/spec.md](docs/spec.md), the roadmap [docs/roadmap.md](docs/roadmap.md).

The owner's rules for every repository are in `~/.claude/CLAUDE.md`; this file states
only what is rouvix-api's own. The stack's conventions are the `alxia-graphql-api`
plugin's (`build-an-alxia-graphql-api`, `add-a-module`, its `conventions-reviewer`).

- **Coordination**: the rouvix session in `~/workspace/dev/rouvix/` coordinates; send it
  status, merges, blockers and owner questions with a recommended option.
- **Branches**: `develop` is the default branch and there is no `main`. v1 is built on
  `feat/v1`: each slice is `feat/v1-<slice>` off it, PR'd with `--base feat/v1`.
- **Public repository**: no secret, no real phone number, no real ID document, no
  private app name in code, fixtures or docs. Fixtures use fake numbers (`+237 6 00 00 00 xx`)
  and drawn documents.
- **Tenancy**: the platform space plus one janus tenant per organisation; every
  organisation collection is read through `scoped()`, and a spec per module proves
  another organisation gets `not-found`.
- **ID documents never leave the VPS**: their photos go to the local OCR and blur only,
  never to Claude or any other remote service; a guard refuses the call and a spec
  proves it. The original photo is private and deleted when the listing closes.
- **Masked by default**: no resolver returns a full ID number, a holder's full name, a
  phone number or an original ID photo to anyone but the person entitled to it (see
  spec §8); a leak spec per module guards it.
- **AI through `@softistx/ai-*` only**: no provider SDK, no app-side embeddings client.
  OCR and blur sit behind their ports. A gap is filed upstream and the slice waits.
- **CI**: Actions are disabled during the CI freeze; the local green bar is the proof
  until the monitoring session enables CI.
