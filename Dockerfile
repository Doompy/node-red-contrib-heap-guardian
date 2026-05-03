FROM nodered/node-red:latest

USER root
COPY --chown=node-red:root . /tmp/node-red-heap-guardian

USER node-red
WORKDIR /tmp/node-red-heap-guardian
RUN npm pack --pack-destination /tmp

WORKDIR /data
RUN npm install --no-update-notifier --no-fund --omit=dev /tmp/node-red-contrib-heap-guardian-*.tgz && \
    rm -rf /tmp/node-red-heap-guardian /tmp/node-red-contrib-heap-guardian-*.tgz

WORKDIR /usr/src/node-red
