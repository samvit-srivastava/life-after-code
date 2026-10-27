#!/usr/bin/env bash
# ==============================================================================
# Project Sentinel — Automated GCP & Cloud Run Setup Script
# Run from Google Cloud Shell at the repository root.
# ==============================================================================

set -euo pipefail

echo "================================================================="
echo "   Project Sentinel — Automated GCP & Cloud Run Setup"
echo "================================================================="

# 1. Determine & Set Project ID
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || true)
if [ -n "${1:-}" ]; then
  PROJECT_ID="$1"
elif [ -n "$CURRENT_PROJECT" ] && [ "$CURRENT_PROJECT" != "(unset)" ]; then
  read -r -p "Use current GCP Project [$CURRENT_PROJECT]? (Y/n): " CONFIRM
  if [[ "$CONFIRM" =~ ^[Nn] ]]; then
    read -r -p "Enter your GCP Project ID: " PROJECT_ID
  else
    PROJECT_ID="$CURRENT_PROJECT"
  fi
else
  read -r -p "Enter your GCP Project ID: " PROJECT_ID
fi

if [ -z "$PROJECT_ID" ]; then
  echo "[-] Error: Project ID is required." >&2
  exit 1
fi

echo "[*] Setting active project to: $PROJECT_ID"
gcloud config set project "$PROJECT_ID" --quiet

REGION="us-central1"
SA_NAME="sentinel-sa"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
KEY_FILE="sentinel-sa-key.json"

# 2. Enable Required APIs
echo "[*] Enabling required GCP APIs (run, cloudbuild, artifactregistry, secretmanager)..."
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  --quiet

# 3. Create Artifact Registry repository if not exists
echo "[*] Ensuring Artifact Registry repository 'sentinel' exists in $REGION..."
gcloud artifacts repositories describe sentinel --location="$REGION" >/dev/null 2>&1 || \
  gcloud artifacts repositories create sentinel \
    --repository-format=docker \
    --location="$REGION" \
    --description="Docker repository for Project Sentinel" \
    --quiet

# 4. Create Service Account & Assign Roles
echo "[*] Configuring Service Account: $SA_EMAIL..."
if ! gcloud iam service-accounts describe "$SA_EMAIL" >/dev/null 2>&1; then
  gcloud iam service-accounts create "$SA_NAME" \
    --display-name="Sentinel CI/CD Deployer SA" \
    --quiet
  echo "[*] Waiting 10 seconds for Google IAM propagation..."
  sleep 10
fi

ROLES=(
  "roles/run.admin"
  "roles/cloudbuild.builds.editor"
  "roles/artifactregistry.admin"
  "roles/iam.serviceAccountUser"
  "roles/storage.admin"
)

echo "[*] Granting IAM roles to $SA_EMAIL..."
for ROLE in "${ROLES[@]}"; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:${SA_EMAIL}" \
    --role="$ROLE" \
    --quiet >/dev/null
done

# 5. Create Service Account JSON Key
if [ -f "$KEY_FILE" ]; then
  echo "[+] Service Account key '$KEY_FILE' already exists locally, reusing existing key."
else
  echo "[*] Generating Service Account Key: $KEY_FILE..."
  gcloud iam service-accounts keys create "$KEY_FILE" \
    --iam-account="$SA_EMAIL" \
    --quiet
fi

# 6. Fetch or Generate Secrets in Secret Manager
get_or_create_secret() {
  local NAME="$1"
  if gcloud secrets describe "$NAME" >/dev/null 2>&1; then
    echo "[+] Secret '$NAME' exists in Secret Manager, reusing active version." >&2
    gcloud secrets versions access latest --secret="$NAME"
  else
    local VAL
    VAL=$(openssl rand -hex 24)
    printf "%s" "$VAL" | gcloud secrets create "$NAME" --data-file=- --replication-policy="automatic" --quiet >/dev/null
    echo "[+] Created new secret '$NAME' in Secret Manager." >&2
    printf "%s" "$VAL"
  fi
}

echo "[*] Checking / generating cryptographically secure secrets..."
HMAC_SECRET=$(get_or_create_secret "SENTINEL_HMAC_SECRET")
WEBHOOK_SECRET=$(get_or_create_secret "GITLAB_WEBHOOK_SECRET")


# Grant Secret Accessor to Default Compute & Service Account
PROJECT_NUM=$(gcloud projects describe "$PROJECT_ID" --format="value(projectNumber)")
COMPUTE_SA="${PROJECT_NUM}-compute@developer.gserviceaccount.com"

echo "[*] Granting Secret Manager Accessor to Compute Service Account ($COMPUTE_SA)..."
gcloud secrets add-iam-policy-binding SENTINEL_HMAC_SECRET \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

gcloud secrets add-iam-policy-binding GITLAB_WEBHOOK_SECRET \
  --member="serviceAccount:${COMPUTE_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

# 7. Deploy Backend to Cloud Run
echo "[*] Preparing Dockerfile for backend deployment..."
cp backend/Dockerfile Dockerfile

echo "[*] Deploying sentinel-backend to Cloud Run (min-instances 1, max-instances 1)..."
gcloud run deploy sentinel-backend \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances 1 \
  --max-instances 1 \
  --set-secrets SENTINEL_HMAC_SECRET=SENTINEL_HMAC_SECRET:latest,GITLAB_WEBHOOK_SECRET=GITLAB_WEBHOOK_SECRET:latest \
  --quiet

rm -f Dockerfile

BACKEND_URL=$(gcloud run services describe sentinel-backend --region "$REGION" --format="value(status.url)")
echo "[+] sentinel-backend deployed at: $BACKEND_URL"

# 8. Deploy Demo Target App to Cloud Run (initial baseline)
echo "[*] Deploying sentinel-target-app to Cloud Run (baseline release)..."
gcloud run deploy sentinel-target-app \
  --source app/ \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 1 \
  --max-instances 2 \
  --quiet

TARGET_APP_URL=$(gcloud run services describe sentinel-target-app --region "$REGION" --format="value(status.url)")
echo "[+] sentinel-target-app deployed at: $TARGET_APP_URL"

# 9. Deploy Mission Control Frontend to Cloud Run
echo "[*] Building & Deploying sentinel-frontend to Cloud Run (pointing to $BACKEND_URL)..."
echo "VITE_API_BASE=${BACKEND_URL}" > frontend/.env.production
gcloud run deploy sentinel-frontend \
  --source frontend/ \
  --region "$REGION" \
  --allow-unauthenticated \
  --port 8080 \
  --min-instances 0 \
  --max-instances 2 \
  --quiet
rm -f frontend/.env.production

FRONTEND_URL=$(gcloud run services describe sentinel-frontend --region "$REGION" --format="value(status.url)")
echo "[+] sentinel-frontend deployed at: $FRONTEND_URL"

# 10. Configure Backend CORS for Mission Control
echo "[*] Updating sentinel-backend CORS to allow $FRONTEND_URL..."
gcloud run services update sentinel-backend \
  --region "$REGION" \
  --update-env-vars "CORS_ORIGINS=${FRONTEND_URL},http://localhost:5173,http://localhost:3000" \
  --quiet

echo ""
echo "================================================================="
echo "   DEPLOYMENT SUCCEEDED! ALL 3 SERVICES ARE RUNNING ON GCP"
echo "================================================================="
echo ""
echo "--- Live Cloud Run Endpoints ---"
echo "Mission Control UI : $FRONTEND_URL"
echo "Sentinel Backend   : $BACKEND_URL"
echo "Demo Target App    : $TARGET_APP_URL"
echo ""
echo "--- 1. GitLab -> Settings -> CI/CD -> Variables (Masked & Protected) ---"
echo "SENTINEL_DEPLOY_MODE : cloudrun"
echo "GCP_PROJECT_ID       : $PROJECT_ID"
echo "GCP_REGION           : $REGION"
echo "GCP_SA_KEY           : [Type: File] Upload / Paste contents of $(pwd)/$KEY_FILE"
echo "SENTINEL_BACKEND_URL : $BACKEND_URL"
echo "SENTINEL_HMAC_SECRET : $HMAC_SECRET"
echo "GITLAB_PROJECT_TOKEN : [Create in Project Access Tokens -> Role: Maintainer, Scope: api]"
echo ""
echo "--- 2. GitLab -> Settings -> Webhooks ---"
echo "URL                  : ${BACKEND_URL}/api/v1/webhooks/gitlab"
echo "Secret token         : $WEBHOOK_SECRET"
echo "Trigger Events       : [x] Merge request events, [x] Pipeline events, [x] Job events"
echo ""
echo "--- 3. Service Account Key ---"
echo "Key file saved at: $(pwd)/$KEY_FILE"
echo "Run this to view key content to copy into GCP_SA_KEY in GitLab:"
echo "cat $(pwd)/$KEY_FILE"
echo "================================================================="

