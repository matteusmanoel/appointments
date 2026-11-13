// Placeholder só para `terraform plan/validate` e primeira criação de conta vazia.
// NUNCA deve chegar a uma Lambda em produção: ver var.allow_placeholder_deploy.
exports.handler = async () => ({ statusCode: 503, body: "placeholder: deploy o zip real (backend: npm run bundle:lambdas)" });
