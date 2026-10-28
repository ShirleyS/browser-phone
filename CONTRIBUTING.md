# Contributing

Thanks for helping improve Browser Phone.

1. `npm install`, then `npm run demo` for the offline app.
2. `npm test` runs unit tests. Tests that need the database run only when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` point at a **test** database.
3. Keep the offline demo free of network calls. `src/test/engine.test.ts` checks this.
4. If you change the API, update `public/openapi.json`, the Docs tab and the README in the same pull request.
5. Never commit secrets. `.env` is git-ignored. Document new variables in `.env.example`.
6. New voice providers go behind the `VoiceAdapter` interface.

By contributing you agree your work is released under the MIT License.
