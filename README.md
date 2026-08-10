# Pi Work

Pi Work is a local-first desktop workspace for turning approved local research into reviewable artifacts.

The first delivered vertical slice supports:

1. Select an authorized workspace.
2. Create a task and submit a structured plan.
3. Approve that plan before any artifact write.
4. Create a staged Markdown artifact.
5. Review its content and publish it into `Pi Work/<task>/`.

All renderer-to-main communication is schema-validated. The renderer cannot access Node APIs, writes are path-boundary checked, and the utility process hosting the Pi runtime is isolated from Electron main.

## Development

```bash
pnpm install --frozen-lockfile
pnpm dev
pnpm check
```

`pnpm evals` writes test evidence to `evals/.evidence/tape.jsonl`.
