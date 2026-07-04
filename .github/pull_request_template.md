## Summary

<!-- Describe what this PR changes and why. -->

## Checklist

- [ ] I have read and followed the contribution guidelines.
- [ ] Tests pass locally (`npm test` and/or `npm run test:e2e`).
- [ ] TypeScript type-check passes (`npm run check`).

### If you touched `.github/workflows/smoke-test.yml` or `server/index.ts` (secret validation)

- [ ] I ran `bash scripts/check-ci-secrets-sync.sh` and it exits 0.
- [ ] If I added or removed a required secret in `smoke-test.yml`, I updated the `## Required secrets` table in `CI_SETUP.md` (all four columns: Secret name, Description, Example value, Where to obtain).
- [ ] If I added a secret to the server's startup check (`server/index.ts` / `validateEnv`), I also added it to the `secrets=(...)` array in the `validate-secrets` job of `smoke-test.yml` **and** to `CI_SETUP.md`.
- [ ] I verified the count in the "requires **N** GitHub repository secrets" sentence at the top of `CI_SETUP.md` still matches the table.
- [ ] I verified the "All **N** required secrets are present" echo in the `validate-secrets` job still matches the count.
