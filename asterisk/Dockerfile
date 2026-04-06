FROM andrius/asterisk:20

# Bake default config into the image
COPY pjsip.conf /etc/asterisk/pjsip.conf
COPY extensions.conf /etc/asterisk/extensions.conf
COPY asterisk.conf /etc/asterisk/asterisk.conf
COPY http.conf /etc/asterisk/http.conf
COPY ari.conf /etc/asterisk/ari.conf
COPY modules.conf /etc/asterisk/modules.conf
COPY rtp.conf /etc/asterisk/rtp.conf
COPY manager.conf /etc/asterisk/manager.conf

# Entrypoint that templates pjsip.conf from env vars before starting Asterisk
COPY --chmod=755 docker-entrypoint.sh /docker-entrypoint.sh

ENTRYPOINT ["/docker-entrypoint.sh"]
