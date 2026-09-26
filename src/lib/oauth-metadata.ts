import { oauthConfig, oauthResourceUrl } from './auth';

export function protectedResourceMetadata(request: Request): Response {
  const config = oauthConfig();
  if (!config) return Response.json({ error: 'OAuth リソースサーバーが未設定です。' }, { status: 503 });
  const resource = oauthResourceUrl(request);
  if (!resource) return Response.json({ error: 'ODIN_PUBLIC_URL に公開 HTTPS URL を設定してください。' }, { status: 503 });
  return Response.json({ resource: resource.toString(), authorization_servers: [config.issuer], bearer_methods_supported: ['header'] }, { headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } });
}
