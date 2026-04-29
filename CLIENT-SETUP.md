# IVR-Lab Client Deployment

Run each block as-is. All commands are single-line / paste-safe (no heredocs).

## 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

## 2. Allow the HTTP Harbor registry

```bash
echo '{ "insecure-registries": ["185.163.125.167:8888"] }' | sudo tee /etc/docker/daemon.json
```

```bash
sudo systemctl restart docker
```

## 3. Login to Harbor

```bash
docker login 185.163.125.167:8888
```

## 4. Project directory

```bash
sudo mkdir -p /opt/ivr-lab && sudo chown $USER /opt/ivr-lab && cd /opt/ivr-lab
```

## 5. Get docker-compose

```bash
curl -fSL https://raw.githubusercontent.com/josephwasily/IVRLab/main/docker-compose.prod.yml -o docker-compose.yml
```

## 6. Create .env

```bash
printf 'EXTERNAL_IP=CHANGE_ME\nSIP_TRUNK_IP=CHANGE_ME\nSIP_TRUNK_PORT=5060\nJWT_SECRET=change-this-in-production-use-strong-secret\nIVR_LANGUAGE=ar\n' > .env
```

Then edit the two IPs:

```bash
nano .env
```

| Variable | Description | Example |
|----------|-------------|---------|
| `EXTERNAL_IP` | This server's LAN IP | `10.0.1.50` |
| `SIP_TRUNK_IP` | Client's PBX / contact center IP | `10.0.1.100` |

## 7. Copy prompts (from your dev machine)

```bash
scp -r prompts/ user@client-server:/opt/ivr-lab/prompts/
```

## 8. Pull and start

```bash
docker compose pull
```

```bash
docker compose up -d
```

## 9. First-run DB init (only the first time)

```bash
docker compose exec platform-api node src/db/migrate.js
```

```bash
docker compose exec platform-api node src/db/seed.js
```

## 10. Verify

```bash
docker compose ps
```

```bash
docker compose exec asterisk asterisk -rx "pjsip show endpoints"
```

```bash
docker compose logs -f
```

- Admin Portal: `http://<server-ip>:8082`
- Login: `admin@demo.com` / `admin123`

---

## Updating

```bash
cd /opt/ivr-lab && docker compose pull && docker compose up -d
```

> **WARNING: NEVER use `docker compose down -v`** — the `-v` flag deletes all data volumes including the database. Backups are created automatically on each startup in the `platform-data` volume under `backups/`.

## Restore from backup (if needed)

```bash
docker compose exec platform-api ls /app/data/backups/
```

```bash
docker compose exec platform-api cp /app/data/backups/platform-YYYYMMDD-HHMMSS.db /app/data/platform.db
```

```bash
docker compose restart platform-api
```

---

## Troubleshooting

- **A command hangs after pasting** — likely a stray heredoc terminator. Press **Ctrl+C** to abort.
- **`docker login` fails** — confirm the registry is reachable: `curl -v http://185.163.125.167:8888/v2/` should return `HTTP/1.1 401`.
- **Pull fails with `http: server gave HTTP response to HTTPS client`** — step 2 wasn't applied; re-run it and `sudo systemctl restart docker`.
