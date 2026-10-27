---
title: Sentinel Backend
emoji: 🛡️
colorFrom: indigo
colorTo: gray
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# Project Sentinel backend

The incident record for [Project Sentinel](https://gitlab.com/gitlab-ai-hackathon/transcend-october-2026/43057900/showcase).
GitLab CI jobs send HMAC-signed events here; Mission Control (https://showcase-46f803.gitlab.io) reads them.

- `GET /api/v1/healthz`, `GET /api/v1/status`, `GET /api/v1/incidents`, API docs at `/docs`.
- Writes need the CI HMAC signature or the GitLab webhook token; the browser can only read.
- Storage is SQLite in `/tmp`: a Space restart clears the record.
