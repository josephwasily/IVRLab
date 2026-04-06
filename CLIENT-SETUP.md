# IVR-Lab Client Deployment

## 1. Prepare the server

```bash
# Install Docker if not already installed
curl -fsSL https://get.docker.com | sh

# Allow pulling from Harbor (HTTP registry)
cat > /etc/docker/daemon.json << 'EOF'
{ "insecure-registries": ["185.163.125.167:8888"] }
EOF
systemctl restart docker
```

## 2. Create project directory

```bash
mkdir -p /opt/ivr-lab && cd /opt/ivr-lab
```

## 3. Download docker-compose.yml

```bash
curl -fSL https://raw.githubusercontent.com/josephwasily/IVRLab/main/docker-compose.prod.yml -o docker-compose.yml
```

## 4. Create .env file

```bash
cat > .env << 'EOF'
EXTERNAL_IP=CHANGE_ME
SIP_TRUNK_IP=CHANGE_ME
SIP_TRUNK_PORT=5060
JWT_SECRET=change-this-in-production-use-strong-secret
IVR_LANGUAGE=ar
EOF
```

Edit the file and replace `CHANGE_ME`:

| Variable | Description | Example |
|----------|-------------|---------|
| `EXTERNAL_IP` | This server's LAN IP | `10.0.1.50` |
| `SIP_TRUNK_IP` | Client's PBX / contact center IP | `10.0.1.100` |

```bash
nano .env
```

## 5. Copy prompts

Copy the `prompts/` folder to the server:

```bash
scp -r prompts/ user@client-server:/opt/ivr-lab/prompts/
```

## 6. Pull and start

```bash
cd /opt/ivr-lab
docker compose pull
docker compose up -d
```

## 7. Initialize database (first run only)

```bash
docker compose exec platform-api node src/db/migrate.js
docker compose exec platform-api node src/db/seed.js
```

## 8. Verify

```bash
docker compose ps
docker compose exec asterisk asterisk -rx "pjsip show endpoints"
docker compose logs -f
```

- Admin Portal: `http://<server-ip>:8082`
- Login: `admin@demo.com` / `admin123`

## Updating

```bash
cd /opt/ivr-lab
docker compose pull
docker compose up -d
docker compose exec platform-api node src/db/migrate.js
```
