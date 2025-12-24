export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  const url = new URL(req.url);
  // Extraer la ruta después de /api/v1/
  const path = url.pathname.replace('/api/v1/', '');
  
  const targetUrl = `https://api.openai.com/v1/${path}`;

  const headers = new Headers(req.headers);
  headers.set('Authorization', `Bearer ${process.env.OPENAI_API_KEY}`);
  headers.delete('host');

  try {
    const response = await fetch(targetUrl, {
      method: req.method,
      headers: headers,
      body: req.method !== 'GET' && req.method !== 'HEAD' ? await req.blob() : null,
    });

    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('content-encoding');

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
