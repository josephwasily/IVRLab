# Kamailio 5.8 with rtpengine module (better rtpengine package support than OpenSIPS)
FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    gnupg2 ca-certificates curl \
 && curl -fsSL https://deb.kamailio.org/kamailiodebkey.gpg | gpg --dearmor -o /usr/share/keyrings/kamailio.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/kamailio.gpg] http://deb.kamailio.org/kamailio58 bookworm main" \
      > /etc/apt/sources.list.d/kamailio.list \
 && apt-get update && apt-get install -y --no-install-recommends \
    kamailio \
 && rm -rf /var/lib/apt/lists/*

# Copy config
COPY kamailio.cfg /etc/kamailio/kamailio.cfg

EXPOSE 5060/udp 5060/tcp

CMD ["kamailio", "-DD", "-E"]
