#!/usr/bin/env bash
# NavalhIA - Configura domínio customizado app.navalhia.com.br (CloudFront) e api.navalhia.com.br (API Gateway)
# Pré-requisito: certificado ACM validado (status ISSUED). Veja docs/CUSTOM_DOMAIN_NAVALHIA.md
# Usa as stacks navalhia-static-prod e navalhia-api-prod (mesmas do deploy).

set -e
AWS_REGION="${AWS_REGION:-us-east-1}"
CERT_ARN="arn:aws:acm:us-east-1:321225686266:certificate/57a83321-eb8e-4506-9263-e7a69845979d"
STACK_STATIC="${STACK_STATIC:-navalhia-static-prod}"
STACK_API="${STACK_API:-navalhia-api-prod}"

# Resolve CloudFront distribution ID from static stack (obrigatório)
CF_DISTRIBUTION_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_STATIC" --region "$AWS_REGION" \
  --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" --output text 2>/dev/null || true)
if [ -z "$CF_DISTRIBUTION_ID" ] || [ "$CF_DISTRIBUTION_ID" = "None" ]; then
  echo "Error: Stack $STACK_STATIC not found or has no CloudFrontDistributionId. Deploy static first: ./scripts/aws/deploy-static.sh"
  exit 1
fi

# Resolve API Gateway API ID from API stack (obrigatório)
API_ID=$(aws cloudformation describe-stack-resources --stack-name "$STACK_API" --region "$AWS_REGION" \
  --query "StackResources[?ResourceType=='AWS::ApiGatewayV2::Api'].PhysicalResourceId" --output text 2>/dev/null || true)
if [ -z "$API_ID" ] || [ "$API_ID" = "None" ]; then
  echo "Error: Stack $STACK_API not found or has no API. Deploy API first: ./scripts/aws/deploy-api.sh"
  exit 1
fi

echo "Using CloudFront distribution: $CF_DISTRIBUTION_ID (stack: $STACK_STATIC)"
echo "Using API Gateway API: $API_ID (stack: $STACK_API)"

echo "Checking ACM certificate status..."
CERT_STATUS=$(aws acm describe-certificate --certificate-arn "$CERT_ARN" --region "$AWS_REGION" \
  --query "Certificate.Status" --output text 2>/dev/null || echo "NOT_FOUND")
if [ "$CERT_STATUS" != "ISSUED" ]; then
  echo "Error: Certificate is not issued (current: $CERT_STATUS). Add the 3 validation CNAMEs from docs/CUSTOM_DOMAIN_NAVALHIA.md and wait until status is ISSUED."
  exit 1
fi

echo "Certificate OK. Updating CloudFront distribution $CF_DISTRIBUTION_ID..."
TMP_CF="/tmp/cf-config-$$.json"
TMP_CF_NEW="/tmp/cf-config-new-$$.json"
trap "rm -f $TMP_CF $TMP_CF_NEW" EXIT

aws cloudfront get-distribution-config --id "$CF_DISTRIBUTION_ID" --query "{ ETag: ETag, Config: DistributionConfig }" --output json > "$TMP_CF"
ETAG=$(jq -r '.ETag' "$TMP_CF")
jq --arg arn "$CERT_ARN" '.Config | .Aliases = {"Quantity": 1, "Items": ["app.navalhia.com.br"]} | .ViewerCertificate = {"ACMCertificateArn": $arn, "SSLSupportMethod": "sni-only", "MinimumProtocolVersion": "TLSv1.2_2021", "CertificateSource": "acm"}' "$TMP_CF" > "$TMP_CF_NEW"
aws cloudfront update-distribution --id "$CF_DISTRIBUTION_ID" --if-match "$ETAG" --distribution-config file://"$TMP_CF_NEW" --output text --query "Distribution.Id"
CF_DOMAIN=$(aws cloudfront get-distribution --id "$CF_DISTRIBUTION_ID" --query "Distribution.DomainName" --output text 2>/dev/null || true)
echo "CloudFront updated. app.navalhia.com.br will work after you add CNAME: app -> $CF_DOMAIN"

echo ""
echo "Creating API Gateway custom domain api.navalhia.com.br..."
DOMAIN_CFG="[{\"CertificateArn\":\"$CERT_ARN\",\"EndpointType\":\"REGIONAL\",\"SecurityPolicy\":\"TLS_1_2\"}]"
if ! aws apigatewayv2 get-domain-name --domain-name "api.navalhia.com.br" --region "$AWS_REGION" &>/dev/null; then
  aws apigatewayv2 create-domain-name \
    --domain-name "api.navalhia.com.br" \
    --domain-name-configurations "$DOMAIN_CFG" \
    --region "$AWS_REGION" --output json >/dev/null
  echo "API Gateway domain created."
else
  echo "API Gateway domain api.navalhia.com.br already exists."
fi

# Create API mapping (map domain to our API default stage)
echo "Creating API mapping (api.navalhia.com.br -> API $API_ID)..."
aws apigatewayv2 create-api-mapping \
  --domain-name "api.navalhia.com.br" \
  --api-id "$API_ID" \
  --stage "\$default" \
  --region "$AWS_REGION" 2>/dev/null && echo "API mapping created." || echo "Mapping may already exist."

# Show targets for CNAMEs (CloudFront domain + API Gateway custom domain)
[ -z "$CF_DOMAIN" ] && CF_DOMAIN=$(aws cloudfront get-distribution --id "$CF_DISTRIBUTION_ID" --query "Distribution.DomainName" --output text 2>/dev/null || true)
API_GW_TARGET=$(aws apigatewayv2 get-domain-name --domain-name "api.navalhia.com.br" --region "$AWS_REGION" --query "DomainNameConfigurations[0].ApiGatewayDomainName" --output text 2>/dev/null || true)
echo ""
echo "=== Domínios (não confunda) ==="
echo "  app.navalhia.com.br = frontend (SPA no CloudFront). O usuário acessa esse."
echo "  api.navalhia.com.br = API (API Gateway). O app chama esse domínio para dados."
echo ""
echo "=== Adicione estes CNAMEs na Hostinger (DNS de navalhia.com.br) ==="
echo "  Nome: app    Tipo: CNAME    Conteúdo: $CF_DOMAIN"
echo "  Nome: api    Tipo: CNAME    Conteúdo: $API_GW_TARGET"
echo ""
echo "=== Depois de propagar o DNS, redeploy para o app usar a API no domínio correto ==="
echo "  VITE_API_URL=https://api.navalhia.com.br ./scripts/aws/deploy-static.sh"
echo "  ./scripts/aws/deploy-api.sh"
echo ""
echo "=== Verificar (após CNAMEs propagados) ==="
echo "  Frontend:  curl -sI https://app.navalhia.com.br  | head -1"
echo "  API/health: curl -s https://api.navalhia.com.br/health"
