# rtpengine built from source on Debian
FROM debian:bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    git build-essential pkg-config gperf pandoc \
    libglib2.0-dev libavcodec-dev libavformat-dev libavutil-dev libswresample-dev libavfilter-dev \
    libpcre3-dev libssl-dev libcurl4-openssl-dev libevent-dev libhiredis-dev \
    libiptc-dev libmariadb-dev default-libmysqlclient-dev libxmlrpc-core-c3-dev markdown \
    iptables libip6tc-dev libxt-dev libspandsp-dev libwebsockets-dev \
    libjson-glib-dev libopus-dev libpcap-dev libmnl-dev libnftnl-dev libncurses-dev libcap-dev \
    ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src

# Clone rtpengine (use mr12.5 branch for stability)
RUN git clone --depth 1 --branch mr12.5.1 https://github.com/sipwise/rtpengine.git

WORKDIR /usr/src/rtpengine/daemon

RUN make && make install

EXPOSE 2223/udp
EXPOSE 12000-12100/udp

CMD ["rtpengine", "--foreground", "--interface=0.0.0.0", "--listen-ng=0.0.0.0:2223", "--port-min=12000", "--port-max=12100", "--log-level=6"]
