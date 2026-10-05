FROM ubuntu:26.04

# Asterisk from Ubuntu's own package (no third-party image; Debian does not ship it). openssl: self-signed cert for the TLS
# transport (Asterisk wants one even though this relay only makes outbound TLS calls to Azure).
RUN apt-get update \
 && apt-get install -y --no-install-recommends asterisk asterisk-modules ca-certificates openssl \
 && rm -rf /var/lib/apt/lists/* \
 && mkdir -p /etc/asterisk/keys \
 && openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=recepto-relay" \
      -keyout /etc/asterisk/keys/relay.key -out /etc/asterisk/keys/relay.crt \
 && chown -R asterisk:asterisk /etc/asterisk/keys

COPY conf/ /etc/asterisk/
RUN chown -R asterisk:asterisk /etc/asterisk

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD asterisk -rx "core show uptime" >/dev/null || exit 1

CMD ["asterisk", "-f", "-U", "asterisk", "-G", "asterisk", "-vvv"]
