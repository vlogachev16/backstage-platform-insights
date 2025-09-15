# Backstage Platform Insights

Backstage running **in a local Kubernetes cluster (minikube)** with a custom backend plugin: **`platform-insights`**.

## Exposed backend routes

- `GET /api/platform-insights/healthz` -> `{"status":"ok"}`
- `GET /api/platform-insights/v1/summary` -> **Option B (offline CI health)**  
  Reads `GHA_RUNS_PATH` (mounted JSON) and returns:
  ```json
  { "window":10, "success_rate":<float>, "mean_duration_ms":<int>, "counts":{"success":<int>,"failure":<int>} }
  ```

---

## Prerequisites

- Node.js **20+**, Yarn  
- Docker with BuildKit / buildx  
- kubectl  
- minikube  

---

## Repo structure

```
.
├─ packages/backend/
├─ plugins/platform-insights-backend/
├─ sample-data/gha-runs.json
├─ k8s/
│  ├─ namespace.yaml
│  ├─ backstage-configmap.yaml               
│  ├─ configmap-platform-insights.yaml       
│  ├─ backstage-depl.yaml
│  └─ backstage-serv.yaml
└─ README.md
```

---

## 1) Create local cluster (minikube)

Please follow the official docs: https://minikube.sigs.k8s.io/docs/start/

Example (Ubuntu/Debian):
```bash
curl -LO https://storage.googleapis.com/minikube/releases/latest/minikube_latest_amd64.deb
sudo dpkg -i minikube_latest_amd64.deb
minikube start
```

---

## 2) Build the Backstage backend bundle (required by Dockerfile)

```bash
yarn install
yarn build:backend

# quick check
ls -lh packages/backend/dist/*.tar.gz   # expect: skeleton.tar.gz, bundle.tar.gz
```

---

## 3) Build the image & load it into minikube

```bash
# from repo root
docker buildx build --load -t backstage:platform-insights -f packages/backend/Dockerfile .

# copy the image into the minikube node
minikube image load backstage:platform-insights
```

---

## 4) Deploy Backstage in-cluster

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/backstage-configmap.yaml
kubectl apply -f k8s/configmap-platform-insights.yaml
kubectl apply -f k8s/backstage-depl.yaml
kubectl apply -f k8s/backstage-serv.yaml
```

**Notes**
- We overwrite `app-config.production.yaml` (the file the container loads) and **omit** `backend.database` to avoid Postgres/SQLite. The custom plugin needs no DB.
- We mount `gha-runs.json` via ConfigMap at `/data/gha-runs.json` and set `GHA_RUNS_PATH` accordingly.

---

## 5) Access & test with `curl`

Port-forward:
```bash
kubectl -n backstage port-forward svc/backstage 7007:7007
```

Health:
```bash
curl -s localhost:7007/api/platform-insights/healthz | jq .
```

Summary:
```bash
curl -s localhost:7007/api/platform-insights/v1/summary | jq .
```

---

## 6) Dev loop: rebuild & redeploy

```bash
# rebuild image locally
docker buildx build --load -t backstage:platform-insights -f packages/backend/Dockerfile .

# load into the cluster node
minikube image load backstage:platform-insights

# restart deployment to pick up the new image
kubectl -n backstage rollout restart deploy/backstage
kubectl -n backstage rollout status deploy/backstage
```

---

## 7) Tests (run locally)

Only the backend plugin tests:
```bash
yarn workspace @internal/plugin-platform-insights-backend test
```

**Included tests**
- **Happy path:** `/v1/summary` returns computed stats from a temp JSON file.
- **Unhappy path:** `/v1/summary` with `GHA_RUNS_PATH` pointing to a missing file → **500**.

---


## Assumptions & limitations

- **Local-only**: no ingress/TLS; use `kubectl port-forward`.
- **No database**: `app-config.production.yaml` intentionally omits `backend.database`.  
  (If you enable DB-dependent Backstage features later, add SQLite or Postgres.)
- Single replica; minimal configuration to satisfy the exercise.

---

## What I’d do next (if time allowed)

- Add minimal RBAC & implement Option A (Kubernetes deployments summary).
- Container hardening: run as non-root; `securityContext`; resource requests/limits.
- GitHub Actions: lint/test/build.
- Observability: basic timing logs or `/metrics`.
- (Stretch) Small frontend plugin to render the summary.