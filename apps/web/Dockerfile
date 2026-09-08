# Agent X-Ray web —— Next.js 15 standalone,运行时统一为 bun(R-BUN)
#
# 构建入口是 `dev.ps1 build`(本机构建后传输,CLAUDE.md 规则 10),不在服务器上构建。
# 依赖安装仍走 npm ci / package-lock.json:bun 在此只作运行时与脚本执行器,
# 不接管依赖解析(理由见 rounds/round-bun/round-bun.md「包管理器为何不切」)。

# ---------- builder ----------
FROM oven/bun:1.4.0-slim AS builder
WORKDIR /app

# 构建期需要 npm(装依赖)与 node(Next 构建器自身仍以 node 运行更稳)
RUN apt-get update \
 && apt-get install -y --no-install-recommends nodejs npm ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# next.config.ts 已设 output: "standalone"
RUN npx next build

# ---------- runner ----------
FROM oven/bun:1.4.0-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# compose 以 user: "10001:10001" 运行;这里建同 uid 账户并交出产物所有权,
# 配合 read_only 根文件系统(仅 /tmp 为 tmpfs)
RUN groupadd -g 10001 app && useradd -u 10001 -g 10001 -m -s /usr/sbin/nologin app

COPY --from=builder --chown=10001:10001 /app/.next/standalone ./
COPY --from=builder --chown=10001:10001 /app/.next/static ./.next/static
# public/ 的历史,别再踩一次:R5 时它装着 notes 正文配图;R6 按所有者裁定把图片搬进
# Postgres 并**删掉了整个目录**,这行 COPY 从此指向不存在的路径、`docker build` 直接失败
# (R9 开工构建时实测,是那轮第一个卡点),于是被删掉。
# **R-MOBILE 又把它加了回来**:manifest 要的三张位图图标(`app/manifest.ts` 引的
# /icon-{192,512}.png 与 /icon-maskable-512.png)只能走 public/。它们由
# `scripts/generate-icons.mjs` 生成并**入库**,所以目录一定存在、这行一定有东西可拷。
# 判据:删掉这行的表现不是构建失败,而是**装到主屏幕后图标变默认灰块** —— 静默的。
# 自托管字体不经 public/(next/font/local 的产物在 .next/static/media,由上一行带进来)。
COPY --from=builder --chown=10001:10001 /app/public ./public

USER 10001:10001
EXPOSE 3000

# --bun 强制用 bun 解释器执行:不加时 bun 会尊重脚本 shebang 回落到 node
# (同一个坑在 apps/api 的 test 脚本上踩过,见 CLAUDE.md 规则 11)
CMD ["bun", "--bun", "server.js"]
