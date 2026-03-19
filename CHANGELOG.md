# Changelog

All notable changes to this project will be documented in this file.


## [0.1.1] - 2026-03-20

### Added
- `CONTRIBUTING.md` with local validation and PR workflow.
- `CODE_OF_CONDUCT.md` for community behavior expectations.
- GitHub Actions CI workflow (`.github/workflows/ci.yml`) for dependency install, JS syntax check, shell syntax checks, and basic startup smoke check.
- README screenshots/demo section and demo assets folder guidance (`docs/assets/README.md`).
- Generated initial mock screenshots and demo GIF:
  - `docs/assets/home.png`
  - `docs/assets/streaming.png`
  - `docs/assets/mobile-view.png`
  - `docs/assets/demo.gif`.

## [0.1.0] - 2026-03-20

### Added
- Initial public release of `openclae-webchat`.
- Web chat UI for OpenClaw Gateway with session-based chat experience.
- Streaming responses via SSE.
- Stop generation, regenerate last answer, edit-and-resend, branch-from-message, and per-message delete features.
- File/image upload support path in the chat flow.
- Helper scripts for operational stability:
  - `scripts/start-chat-stack.sh`
  - `scripts/chatctl.sh`
  - `scripts/gateway-watchdog.sh`
- Reusable setup docs (`README.md`, `.env.example`).
- Contribution scaffolding:
  - Issue templates (bug report, feature request)
  - Pull request template

### Changed
- Generalized hardcoded local paths for portability.
- Removed personal branding/content and replaced with generic copy.
- Excluded runtime user data/history from repository tracking.
