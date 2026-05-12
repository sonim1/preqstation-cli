# Publishing

Pushes to `main` run `.github/workflows/publish.yml`, test the package, and publish to npm automatically.

Release behavior:

- if the current `package.json` version is not on npm yet, the workflow publishes it as-is
- if that version already exists on npm, the workflow automatically bumps a patch version, syncs [VERSION](../VERSION), commits the bump back to `main`, and publishes the new version
- the follow-up run triggered by that bump commit is skipped because the actor is `github-actions[bot]`

One-time setup before the first release:

- add an `NPM_TOKEN` repository secret, or
- configure npm trusted publishing for this publishing repository and package

The workflow is ready for both: it grants `id-token: write` for trusted publishing and also passes `NODE_AUTH_TOKEN` when `NPM_TOKEN` is configured.
