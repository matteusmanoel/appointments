#!/usr/bin/env bash
# NavalhIA - Deploy API to AWS (Lambda + API Gateway)
# Deploys only the HTTP API (single Lambda). Docker Compose services worker-ai and
# worker-scheduled are not deployed here; run them separately (e.g. ECS/EC2) if needed.
# Requires: ARTIFACT_BUCKET, DATABASE_URL, JWT_SECRET; optional: CORS_ORIGIN, AWS_REGION

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-navalhia-api-prod}"
ARTIFACT_KEY="${ARTIFACT_KEY:-api/latest.zip}"

if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  source "$REPO_ROOT/.env"
  set +a
fi

for key in ARTIFACT_BUCKET DATABASE_URL JWT_SECRET; do
  if [ -z "${!key}" ]; then
    echo "Missing env: $key (set in .env or export)"
    exit 1
  fi
done

CORS_ORIGIN="${CORS_ORIGIN:-*}"
JWT_EXPIRES_IN="${JWT_EXPIRES_IN:-7d}"

echo "Building backend..."
cd "$REPO_ROOT/backend"
npm ci --silent
# Use npx so tsc is resolved from node_modules (robust in CI/slim PATH)
npx tsc

echo "Creating deployment package..."
(cd "$REPO_ROOT/backend" && zip -r -q "$REPO_ROOT/dist.zip" dist package.json package-lock.json node_modules -x "*.map")

echo "Uploading to s3://${ARTIFACT_BUCKET}/${ARTIFACT_KEY}..."
aws s3 cp "$REPO_ROOT/dist.zip" "s3://${ARTIFACT_BUCKET}/${ARTIFACT_KEY}" --region "$AWS_REGION"
rm -f "$REPO_ROOT/dist.zip"

EXTRA_PARAMS=""
[ -n "${STRIPE_WEBHOOK_SECRET:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS StripeWebhookSecret=$STRIPE_WEBHOOK_SECRET"
[ -n "${STRIPE_SECRET_KEY:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS StripeSecretKey=$STRIPE_SECRET_KEY"
[ -n "${STRIPE_PRICE_ID:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS StripePriceId=$STRIPE_PRICE_ID"
[ -n "${STRIPE_PRICE_ID_ESSENTIAL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS StripePriceIdEssential=$STRIPE_PRICE_ID_ESSENTIAL"
[ -n "${STRIPE_PRICE_ID_PRO:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS StripePriceIdPro=$STRIPE_PRICE_ID_PRO"
[ -n "${STRIPE_PRICE_ID_PREMIUM:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS StripePriceIdPremium=$STRIPE_PRICE_ID_PREMIUM"
[ -n "${FROM_EMAIL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS FromEmail=$FROM_EMAIL"
[ -n "${APP_URL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS AppUrl=$APP_URL"
[ -n "${ALARM_EMAIL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS AlarmEmail=$ALARM_EMAIL"
[ -n "${UAZAPI_BASE_URL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS UazapiBaseUrl=$UAZAPI_BASE_URL"
[ -n "${UAZAPI_ADMIN_TOKEN:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS UazapiAdminToken=$UAZAPI_ADMIN_TOKEN"
[ -n "${UAZAPI_WEBHOOK_PUBLIC_URL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS UazapiWebhookPublicUrl=$UAZAPI_WEBHOOK_PUBLIC_URL"
[ -n "${APP_ENCRYPTION_KEY:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS AppEncryptionKey=$APP_ENCRYPTION_KEY"
[ -n "${N8N_CHAT_TRIGGER_URL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS N8nChatTriggerUrl=$N8N_CHAT_TRIGGER_URL"

echo "Deploying CloudFormation stack: $STACK_NAME..."
aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$REPO_ROOT/infra/api/stack.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$AWS_REGION" \
  --parameter-overrides \
    Stage=prod \
    ArtifactBucket="$ARTIFACT_BUCKET" \
    ArtifactKey="$ARTIFACT_KEY" \
    DatabaseUrl="$DATABASE_URL" \
    JwtSecret="$JWT_SECRET" \
    CorsOrigin="$CORS_ORIGIN" \
    JwtExpiresIn="$JWT_EXPIRES_IN" \
    $EXTRA_PARAMS

API_URL=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
echo ""
echo "API deployed. Base URL: $API_URL"
echo "  Health: $API_URL/health"
echo "  API:    $API_URL/api"
