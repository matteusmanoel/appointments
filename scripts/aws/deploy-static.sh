#!/usr/bin/env bash
# NavalhIA - Deploy static frontend + docs to S3 + CloudFront
# Requires: STATIC_BUCKET or CloudFormation stack navalhia-static-prod; VITE_API_URL for build
# Creates stack if missing; syncs dist + docs, invalidates CloudFront.

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${STACK_NAME:-navalhia-static-prod}"

if [ -f "$REPO_ROOT/.env" ]; then
  set -a
  source "$REPO_ROOT/.env"
  set +a
fi

# Resolve bucket and distribution from stack if not set (ignore \"None\" from empty outputs)
if [ -z "${STATIC_BUCKET}" ] || [ "${STATIC_BUCKET}" = "None" ]; then
  if aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" &>/dev/null; then
    STATIC_BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
      --query "Stacks[0].Outputs[?OutputKey=='StaticBucketName'].OutputValue" --output text 2>/dev/null || true)
    DISTRIBUTION_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
      --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" --output text 2>/dev/null || true)
  fi
fi

if [ -z "${STATIC_BUCKET}" ] || [ "${STATIC_BUCKET}" = "None" ]; then
  echo "Creating CloudFormation stack: $STACK_NAME..."
  aws cloudformation deploy \
    --stack-name "$STACK_NAME" \
    --template-file "$REPO_ROOT/infra/static/stack.yaml" \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "$AWS_REGION" \
    --parameter-overrides Stage=prod
  STATIC_BUCKET=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='StaticBucketName'].OutputValue" --output text)
  DISTRIBUTION_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" --output text)
fi

if [ -z "${DISTRIBUTION_ID}" ]; then
  DISTRIBUTION_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" --output text)
fi

VITE_API_URL="${VITE_API_URL:-}"
VITE_STRIPE_PUBLISHABLE_KEY="${VITE_STRIPE_PUBLISHABLE_KEY:-}"
VITE_SALES_WHATSAPP_NUMBER="${VITE_SALES_WHATSAPP_NUMBER:-}"
VITE_SALES_WHATSAPP_MESSAGE="${VITE_SALES_WHATSAPP_MESSAGE:-}"
if [ -z "$VITE_API_URL" ]; then
  echo "Warning: VITE_API_URL not set. Build will use empty API base (relative or env at runtime)."
fi

echo "Building frontend..."
cd "$REPO_ROOT"
npm ci --silent
# Use npx so vite is resolved from node_modules even when PATH omits .bin (e.g. CI)
VITE_API_URL="$VITE_API_URL" \
VITE_STRIPE_PUBLISHABLE_KEY="$VITE_STRIPE_PUBLISHABLE_KEY" \
VITE_SALES_WHATSAPP_NUMBER="$VITE_SALES_WHATSAPP_NUMBER" \
VITE_SALES_WHATSAPP_MESSAGE="$VITE_SALES_WHATSAPP_MESSAGE" \
npx vite build

echo "Uploading app to s3://${STATIC_BUCKET}..."
aws s3 sync "$REPO_ROOT/dist" "s3://${STATIC_BUCKET}" --delete --region "$AWS_REGION"

# Docs: openapi.yaml + redoc.html under /docs
DOCS_DIR="$REPO_ROOT/dist-docs"
rm -rf "$DOCS_DIR"
mkdir -p "$DOCS_DIR/docs"
if [ -f "$REPO_ROOT/openapi.yaml" ]; then
  cp "$REPO_ROOT/openapi.yaml" "$DOCS_DIR/docs/"
elif [ -f "$REPO_ROOT/openapi.json" ]; then
  cp "$REPO_ROOT/openapi.json" "$DOCS_DIR/docs/"
fi
if [ -f "$REPO_ROOT/docs/redoc.html" ]; then
  cp "$REPO_ROOT/docs/redoc.html" "$DOCS_DIR/docs/index.html"
else
  cat > "$DOCS_DIR/docs/index.html" << 'REDOC'
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <link href="https://cdn.jsdelivr.net/npm/redoc@2.1.3/bundles/redoc.standalone.css" rel="stylesheet">
  <title>NavalhIA API</title>
</head>
<body>
  <div id="redoc"></div>
  <script src="https://cdn.jsdelivr.net/npm/redoc@2.1.3/bundles/redoc.standalone.js"></script>
  <script>
    Redoc.init('openapi.yaml', {}, document.getElementById('redoc'));
  </script>
</body>
</html>
REDOC
fi
if [ -f "$DOCS_DIR/docs/openapi.yaml" ] || [ -f "$DOCS_DIR/docs/openapi.json" ]; then
  echo "Uploading docs to s3://${STATIC_BUCKET}/docs..."
  aws s3 sync "$DOCS_DIR/docs" "s3://${STATIC_BUCKET}/docs" --delete --region "$AWS_REGION"
fi
rm -rf "$DOCS_DIR"

echo "Invalidating CloudFront..."
aws cloudfront create-invalidation --distribution-id "$DISTRIBUTION_ID" --paths "/*" --region "$AWS_REGION" || true

CF_URL=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" --output text 2>/dev/null || echo "https://<distribution>.cloudfront.net")
echo ""
echo "Static deploy done."
echo "  App:  $CF_URL"
echo "  Docs: $CF_URL/docs/"
