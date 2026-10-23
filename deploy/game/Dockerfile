ARG NODE_IMAGE=node:22.18.0-bookworm-slim
FROM ${NODE_IMAGE}

WORKDIR /srv/tianxu
COPY --chown=node:node . .

RUN install -d -o node -g node /var/lib/tianxu /var/log/tianxu /var/backups/tianxu

ENV NODE_ENV=production \
    TIANXU_CONTENT_DIR=/srv/tianxu/cocos-client/assets/resources/recovered \
    TIANXU_WEB_DIR=/srv/tianxu/.local/web \
    TIANXU_UI_DIR=/srv/tianxu/cocos-client/assets/resources/ui-revision-a \
    TIANXU_LOCALIZATION_DIR=/srv/tianxu/cocos-client/assets/resources/localization \
    TIANXU_DATABASE=/var/lib/tianxu/tianxu.sqlite \
    TIANXU_PORT=7400 \
    TIANXU_HOST=0.0.0.0 \
    TIANXU_LOG_DIR=/var/log/tianxu

USER node
EXPOSE 7400
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.TIANXU_PORT||'7400')+'/api/health').then(r=>{if(!r.ok)throw Error(String(r.status))}).catch(e=>{console.error(e.message);process.exit(1)})"
CMD ["node", "scripts/start-game.mjs"]
