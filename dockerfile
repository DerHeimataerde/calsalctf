# Combined Node + CTFd + nginx + supervisord with automatic admin token & seeding
FROM node:20-bookworm

# ---- OS deps ----
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv python3-pip git nginx supervisor ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# ---- Node app ----
WORKDIR /app
COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm \
    set -eux; \
    node -v; npm -v; \
    npm config set fund false; \
    npm config set audit false; \
    npm config set engine-strict false; \
    if [ -f package-lock.json ]; then \
      echo ">> running npm ci"; \
      npm ci --omit=dev --no-audit --no-fund --loglevel=verbose \
      || (echo "!! npm ci failed, falling back to npm install" >&2; \
          npm install --omit=dev --no-audit --no-fund --loglevel=verbose); \
    else \
      echo ">> no lockfile, running npm install"; \
      npm install --omit=dev --no-audit --no-fund --loglevel=verbose; \
    fi

# Copy Node app code
COPY public ./public
COPY app.js ./app.js

# ---- CTFd (source + venv) ----
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libffi-dev libssl-dev python3-dev \
 && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /opt/ctfd && useradd -m ctfd
WORKDIR /opt/ctfd

# Clone CTFd
RUN git clone https://github.com/CTFd/CTFd.git .

# Create venv, patch bad pins, install deps with a robust fallback
RUN python3 -m venv .venv \
 && sed -i -E 's/^(click\s*==\s*)8\.2\.1/\18.1.7/' requirements.txt \
 && if [ -f constraints.txt ]; then sed -i -E 's/^(click\s*==\s*)8\.2\.1/\18.1.7/' constraints.txt; fi \
 && . .venv/bin/activate \
 && pip install --upgrade pip setuptools wheel \
 && ( \
      pip install --no-cache-dir -r requirements.txt \
      || ( \
          echo "pip failed on full set; retrying without optional AWS deps (boto3/botocore/s3transfer)..." >&2; \
          sed -i '/^boto3[<=>]/d; /^botocore[<=>]/d; /^s3transfer[<=>]/d' requirements.txt; \
          pip install --no-cache-dir -r requirements.txt \
         ) \
    )

# ---- Bootstrap plugin (creates admin + access token) ----
RUN mkdir -p /opt/ctfd/CTFd/plugins/bootstrap_token
COPY docker/plugins/bootstrap_token/__init__.py /opt/ctfd/CTFd/plugins/bootstrap_token/__init__.py
RUN sed -i 's/\r$//' /opt/ctfd/CTFd/plugins/bootstrap_token/__init__.py

# ---- Persistence area ----
RUN mkdir -p /data && chown -R ctfd:ctfd /opt/ctfd /data

# ---- nginx configs ----
COPY docker/nginx.conf /etc/nginx/nginx.conf

# ---- CTFd env ----
COPY docker/ctfd.env /opt/ctfd/.env
RUN sed -i 's/\r$//' /opt/ctfd/.env

# ---- Supervisor configs ----
COPY docker/supervisord-main.conf /etc/supervisor/supervisord.conf
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

# ---- Seeder (runtime) ----
COPY scripts/seed-ctfd-once.sh /usr/local/bin/seed-ctfd-once.sh
RUN sed -i 's/\r$//' /usr/local/bin/seed-ctfd-once.sh && chmod +x /usr/local/bin/seed-ctfd-once.sh

# seed input + script (ESM .js)
WORKDIR /app
COPY ctfd-seed.json /app/ctfd-seed.json
COPY seed-ctfd.js    /app/seed-ctfd.js

# --- normalize line endings ---
RUN set -eux; \
  for f in \
    /opt/ctfd/.env \
    /etc/supervisor/conf.d/supervisord.conf \
    /etc/supervisor/supervisord.conf \
    /etc/nginx/nginx.conf \
    /opt/ctfd/CTFd/plugins/bootstrap_token/__init__.py \
    /usr/local/bin/seed-ctfd-once.sh \
  ; do [ -f "$f" ] && sed -i 's/\r$//' "$f" || true; done; \
  find /app -type f \( -name '*.sh' -o -name '*.env' -o -name '*.py' -o -name '*.conf' \) -exec sed -i 's/\r$//' {} +

# ---- Runtime user(s) ----
RUN useradd -m nodeuser && chown -R nodeuser:nodeuser /app

# ---- Ports & health ----
# EXPOSE is just documentation; Render ignores it. We'll expose the $PORT anyway.
EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/ctf/ || exit 1

# launch supervisor
CMD ["/usr/bin/supervisord","-c","/etc/supervisor/supervisord.conf"]
