#!/usr/bin/env bash
# Barber Harmony - AWS bootstrap (run once per account/region)
# Creates S3 bucket for Lambda artifacts. Requires AWS CLI configured.

set -e
AWS_REGION="${AWS_REGION:-us-east-1}"
PROJECT="${PROJECT:-barber-harmony}"
SUFFIX="${SUFFIX:-$(openssl rand -hex 4)}"
ARTIFACT_BUCKET="${ARTIFACT_BUCKET:-${PROJECT}-artifacts-${SUFFIX}}"

echo "Region: $AWS_REGION"
echo "Artifact bucket: $ARTIFACT_BUCKET"

aws s3 mb "s3://${ARTIFACT_BUCKET}" --region "$AWS_REGION" 2>/dev/null || true
aws s3api head-bucket --bucket "$ARTIFACT_BUCKET" 2>/dev/null && echo "Bucket exists: $ARTIFACT_BUCKET"

echo ""
echo "Next: set and run deploy-api with these env vars (or .env):"
echo "  export ARTIFACT_BUCKET=$ARTIFACT_BUCKET"
echo "  export AWS_REGION=$AWS_REGION"
echo "  export DATABASE_URL=\"<your-supabase-connection-string>\""
echo "  export JWT_SECRET=\"<your-jwt-secret>\""
echo "  export CORS_ORIGIN=\"*\""
