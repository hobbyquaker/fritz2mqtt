FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
# --ignore-scripts: no native add-ons are needed
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY index.js config.js ./
COPY lib/ ./lib/

# Config only via environment (FRITZ2MQTT_* variables, see README), e.g.
#   -e FRITZ2MQTT_ADDRESS=fritz.box -e FRITZ2MQTT_USERNAME=... -e FRITZ2MQTT_PASSWORD=...
#   -e FRITZ2MQTT_MQTT_URL=mqtt://broker
ENV NODE_ENV=production \
    FRITZ2MQTT_MQTT_URL=mqtt://localhost \
    FRITZ2MQTT_NAME=fritz \
    FRITZ2MQTT_VERBOSITY=info

USER node

ENTRYPOINT ["node", "index.js"]
