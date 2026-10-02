# Wrynch for iPhone and iPad

A native SwiftUI app for technicians: sign in, today's inspections, new inspection from a VIN, vehicle setup, stages
and points, checks and measurements, findings, "nothing found", the burst camera with corners, AI photo sorting and
review, notes and automatic notes, and Finish → send to advisor. Advisor review, customer reports and shop settings
stay on the web app (wrynch.app).

## How it fits together

- **Same rules as the web app.** Ratings, point progress, the finish gate and every count come from `src/domain`,
  bundled by `npm run ios:domain` into `Wrynch/Resources/wrynch-domain.js` and run in JavaScriptCore. Each screen
  asks one function in `ios/bridge/bridge.ts` for what it shows. So the phone can never rate a part differently from
  the web, and a rule change ships to both.
- **Same server.** The app calls the same Supabase database functions (each checks the user's shop role) and the
  same `/api` routes on wrynch.app. Nothing AI-generated counts until a technician confirms it; the database enforces
  that, not the app.
- **No keys in the app.** It reads the public database address from `https://wrynch.app/api/app-config`
  (`WrynchAppURL` in `project.yml`). Sign-in tokens are kept in the Keychain.

## Building

GitHub builds it and runs the tests on an iPhone simulator for every change (`.github/workflows/ios.yml`), so no Mac
is needed for that. On a Mac with Xcode 16:

```
npm install && npm run ios:domain
brew install xcodegen && (cd ios && xcodegen generate)
open ios/Wrynch.xcodeproj
```

## Putting it on phones (TestFlight, then the App Store)

Needs an Apple Developer account ($99/year). Then: create the app in App Store Connect with the bundle id
`app.wrynch.ios`, set `DEVELOPMENT_TEAM` in `project.yml`, and add signing to the GitHub workflow (an App Store
Connect API key and a distribution certificate as repository secrets) so each build can upload to TestFlight.
