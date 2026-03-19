# Contributing to openclae-webchat

Thanks for helping improve this project! 🎉

## Ground rules

- Keep changes focused and small when possible.
- Open an issue first for large changes.
- Do not commit secrets or personal data.
- Keep docs updated when behavior changes.

## Development setup

```bash
npm install
npm start
```

App runs at `http://127.0.0.1:8080` by default.

## Before opening a PR

Please run:

```bash
node --check server.js
bash -n scripts/start-chat-stack.sh
bash -n scripts/chatctl.sh
bash -n scripts/gateway-watchdog.sh
```

Then verify core flow manually:

- open UI
- send a message
- receive response stream
- stop/retry once

## Commit style

Recommended prefixes:

- `feat:` new features
- `fix:` bug fixes
- `docs:` documentation
- `chore:` tooling/maintenance
- `refactor:` internal cleanup

## Pull request process

1. Fork + create a feature branch.
2. Keep PR description clear: what changed and why.
3. Add screenshots for UI changes.
4. Link related issues.
5. Wait for review and CI checks.
