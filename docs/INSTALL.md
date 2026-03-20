# WebChat Installer (OpenClaw/OpenFang)

## 1) Plug-and-play via .env template

Copy template:

```bash
cp scripts/webchat.env.example .env.webchat
```

Edit `.env.webchat` lalu jalankan wrapper:

```bash
bash scripts/install-webchat-from-env.sh .env.webchat
```

(Opsional manual mode tetap tersedia via `scripts/install-webchat.sh`)

## 2) What auto-detect does

If `--mode auto`:
- detects `openfang-gateway.service` or `~/.openfang/bin/openfang` => mode `openfang`
- else detects OpenClaw service/binary => mode `openclaw`

## 3) Model auto-migration

If `--migrate-models true` and provider base URL + key are set, installer calls:
- `GET <provider_base_url>/models`

Then writes model list into `~/chat-ui/openclaw.json` so model selector is populated automatically.

## 4) Uninstall

```bash
bash scripts/uninstall-webchat.sh <chat-domain>
```

## 5) Doctor

```bash
bash scripts/webchat-doctor.sh <chat-domain>
```
