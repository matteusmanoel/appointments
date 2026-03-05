#!/usr/bin/env bash
# NavalhIA - Deploy API + worker Lambdas to AWS (Lambda + API Gateway + EventBridge)
# Deploys HTTP API Lambda and worker Lambdas (ai-worker every 1 min, scheduled-messages every 5 min).
# Same zip is used for all three functions. Optional: OPENAI_API_KEY, N8N_EVENTS_WEBHOOK_URL, N8N_EVENTS_SECRET for workers.
# Requires: ARTIFACT_BUCKET, DATABASE_URL, JWT_SECRET; optional: CORS_ORIGIN, AWS_REGION

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AWS_REGION="${AWS_REGION:-us-east-1}"
STAGE="${STAGE:-prod}"
STACK_NAME="${STACK_NAME:-navalhia-api-${STAGE}}"
ARTIFACT_KEY="${ARTIFACT_KEY:-api/latest.zip}"

ENV_FILE="$REPO_ROOT/.env"
if [ -f "$REPO_ROOT/.env.${STAGE}" ]; then
  ENV_FILE="$REPO_ROOT/.env.${STAGE}"
fi
if [ -f "$ENV_FILE" ]; then
  echo "Loading env: $ENV_FILE"
  set -a
  source "$ENV_FILE"
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

ZIP_PATH="$REPO_ROOT/dist.zip"
if [ ! -f "$ZIP_PATH" ]; then
  echo "Error: deployment package not created at $ZIP_PATH"
  exit 1
fi

echo "Uploading to s3://${ARTIFACT_BUCKET}/${ARTIFACT_KEY}..."
UPLOAD_ATTEMPTS=3
UPLOAD_DELAY=15
for attempt in $(seq 1 "$UPLOAD_ATTEMPTS"); do
  if aws s3 cp "$ZIP_PATH" "s3://${ARTIFACT_BUCKET}/${ARTIFACT_KEY}" --region "$AWS_REGION" --cli-connect-timeout 60 --cli-read-timeout 120; then
    break
  fi
  if [ "$attempt" -eq "$UPLOAD_ATTEMPTS" ]; then
    echo "Error: S3 upload failed after $UPLOAD_ATTEMPTS attempts. Check network and AWS credentials."
    exit 1
  fi
  echo "Upload attempt $attempt failed. Retrying in ${UPLOAD_DELAY}s..."
  sleep "$UPLOAD_DELAY"
done
rm -f "$ZIP_PATH"

EXTRA_PARAMS=""
[ -n "${STRIPE_WEBHOOK_SECRET:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS StripeWebhookSecret=$STRIPE_WEBHOOK_SECRET"
[ -n "${STRIPE_SECRET_KEY:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS StripeSecretKey=$STRIPE_SECRET_KEY"
[ -n "${STRIPE_PRICE_ID:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS StripePriceId=$STRIPE_PRICE_ID"
[ -n "${STRIPE_PRICE_ID_ESSENTIAL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS StripePriceIdEssential=$STRIPE_PRICE_ID_ESSENTIAL"
[ -n "${STRIPE_PRICE_ID_PRO:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS StripePriceIdPro=$STRIPE_PRICE_ID_PRO"
[ -n "${STRIPE_PRICE_ID_PREMIUM:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS StripePriceIdPremium=$STRIPE_PRICE_ID_PREMIUM"
[ -n "${STRIPE_PRICE_ID_EXTRA_NUMBER:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS StripePriceIdExtraNumber=$STRIPE_PRICE_ID_EXTRA_NUMBER"
[ -n "${FROM_EMAIL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS FromEmail=$FROM_EMAIL"
[ -n "${APP_URL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS AppUrl=$APP_URL"
[ -n "${ALARM_EMAIL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS AlarmEmail=$ALARM_EMAIL"
[ -n "${UAZAPI_BASE_URL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS UazapiBaseUrl=$UAZAPI_BASE_URL"
[ -n "${UAZAPI_ADMIN_TOKEN:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS UazapiAdminToken=$UAZAPI_ADMIN_TOKEN"
[ -n "${UAZAPI_WEBHOOK_PUBLIC_URL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS UazapiWebhookPublicUrl=$UAZAPI_WEBHOOK_PUBLIC_URL"
[ -n "${APP_ENCRYPTION_KEY:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS AppEncryptionKey=$APP_ENCRYPTION_KEY"
[ -n "${N8N_CHAT_TRIGGER_URL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS N8nChatTriggerUrl=$N8N_CHAT_TRIGGER_URL"
[ -n "${OPENAI_API_KEY:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS OpenAiApiKey=$OPENAI_API_KEY"
[ -n "${N8N_EVENTS_WEBHOOK_URL:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS N8nEventsWebhookUrl=$N8N_EVENTS_WEBHOOK_URL"
[ -n "${N8N_EVENTS_SECRET:-}" ] && EXTRA_PARAMS="$EXTRA_PARAMS N8nEventsSecret=$N8N_EVENTS_SECRET"

echo "Deploying CloudFormation stack: $STACK_NAME..."
aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$REPO_ROOT/infra/api/stack.yaml" \
  --capabilities CAPABILITY_NAMED_IAM \
  --region "$AWS_REGION" \
  --parameter-overrides \
    Stage="$STAGE" \
    ArtifactBucket="$ARTIFACT_BUCKET" \
    ArtifactKey="$ARTIFACT_KEY" \
    DatabaseUrl="$DATABASE_URL" \
    JwtSecret="$JWT_SECRET" \
    CorsOrigin="$CORS_ORIGIN" \
    JwtExpiresIn="$JWT_EXPIRES_IN" \
    $EXTRA_PARAMS

# CloudFormation only updates Lambda code when it detects a change in the Function's Code properties.
# If you keep the same S3 key (default: api/latest.zip), the stack can be "up to date" while code changed.
# To avoid stale code in prod, force-update function code from the uploaded artifact.
echo "Updating Lambda function code from S3 artifact..."
aws lambda update-function-code \
  --function-name "navalhia-api-${STAGE}" \
  --s3-bucket "$ARTIFACT_BUCKET" \
  --s3-key "$ARTIFACT_KEY" \
  --region "$AWS_REGION" >/dev/null
aws lambda update-function-code \
  --function-name "navalhia-worker-ai-${STAGE}" \
  --s3-bucket "$ARTIFACT_BUCKET" \
  --s3-key "$ARTIFACT_KEY" \
  --region "$AWS_REGION" >/dev/null || true
aws lambda update-function-code \
  --function-name "navalhia-worker-scheduled-${STAGE}" \
  --s3-bucket "$ARTIFACT_BUCKET" \
  --s3-key "$ARTIFACT_KEY" \
  --region "$AWS_REGION" >/dev/null || true
echo "Waiting for Lambda code update to complete..."
aws lambda wait function-updated --function-name "navalhia-api-${STAGE}" --region "$AWS_REGION"

API_URL=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)
echo ""
echo "API + workers deployed. Base URL: $API_URL"
echo "  Health: $API_URL/health"
echo "  API:    $API_URL/api"
echo "  Workers: navalhia-worker-ai-prod (rate 1 min), navalhia-worker-scheduled-prod (rate 5 min)"
