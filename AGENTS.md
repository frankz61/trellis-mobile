# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Trellis Mobile

- Read `docs/mobile-rebuild-guide.md` and `docs/implementation-status.md` before changing architecture.
- Android first. Business logic and SQLite graph live on the device; models remain remote.
- Keep domain and application modules independent of React Native and native dependencies.
- UI calls application services/repositories. Do not embed Python, FastAPI or a local HTTP server.
- Store API keys only through the secure-storage adapter. Never log or commit credentials.
- Schema changes require new numbered migrations; never rewrite a released migration.
- Pending features must be shown honestly. Never insert fake learning records or fake AI replies.
- Run `npm run check` and `npm run export:android` for relevant changes. Native behavior needs device testing.
- Preserve the upstream Expo license notice when changing project metadata.
