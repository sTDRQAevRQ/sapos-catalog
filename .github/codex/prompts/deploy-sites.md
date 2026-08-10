Deploy this repository to OpenAI Sites using the existing local project linkage.

Requirements:

1. Do not edit source files.
2. Reuse the exact `project_id` from `.openai/hosting.json`.
3. Confirm the build artifact `site-dist-auto.tar.gz` exists at the repository root.
4. Confirm the repository is on the intended commit and use that current `HEAD` commit for the deployment provenance.
5. Save a new Sites version from this source state and the provided archive.
6. Deploy that saved version to production.
7. If the deployment succeeds, report:
   - the saved Sites version number
   - the production URL
   - whether the deployment used a newly rebuilt catalog or a no-change manual validation run
8. If anything blocks the deployment, stop and report the exact blocker without making unrelated changes.

Context:

- This workflow is manual-only for now.
- The deployable build artifact is `site-dist-auto.tar.gz`.
- The local project already contains `.openai/hosting.json` with the linked Sites project ID.
