FROM alpine:3.20
COPY . /data/
RUN rm -f /data/Dockerfile
COPY <<-'SCRIPT' /copy.sh
#!/bin/sh
mkdir -p /out/custom /out/ar
cp -a /data/ar/. /out/ar/ 2>/dev/null || true
for f in /data/*; do
  name=$(basename "$f")
  [ "$name" = "ar" ] && continue
  cp -a "$f" /out/custom/
done
echo "[prompts-init] Done"
SCRIPT
RUN chmod +x /copy.sh
CMD ["/copy.sh"]
