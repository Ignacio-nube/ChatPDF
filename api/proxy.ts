export const config = {
  runtime: 'edge',
};

export default async function handler(req: Request) {
  if (!process.env.OPENAI_API_KEY) {
    return new Response(JSON.stringify({ 
      error: 'La variable OPENAI_API_KEY no está configurada en Vercel.' 
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(req.url);
  // Buscamos la parte de la ruta que sigue a /api/v1
  const pathMatch = url.pathname.match(/\/api\/v1\/(.*)/);
  const path = pathMatch ? pathMatch[1] : '';
  
  if (!path) {
    // Si no hay match por regex, intentamos por búsqueda simple
    const index = url.pathname.indexOf('/api/v1/');
    if (index !== -1) {
      const extractedPath = url.pathname.substring(index + 8);
      if (extractedPath) {
        return await proxyRequest(req, extractedPath);
      }
    }
    return new Response(JSON.stringify({ error: 'Ruta no válida', pathname: url.pathname }), { status: 400 });
  }

  return await proxyRequest(req, path);
}

async function proxyRequest(req: Request, path: string) {
  const targetUrl = `https://api.openai.com/v1/${path}`;

  const headers = new Headers();
  const headersToCopy = ['content-type', 'accept', 'user-agent'];
  headersToCopy.forEach(h => {
    const val = req.headers.get(h);
    if (val) headers.set(h, val);
  });
  
  headers.set('Authorization', `Bearer ${process.env.OPENAI_API_KEY}`);

  try {
    const fetchOptions: RequestInit = {
      method: req.method,
      headers: headers,
    };

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      fetchOptions.body = await req.arrayBuffer();
    }

    const response = await fetch(targetUrl, fetchOptions);

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`OpenAI Error (${response.status}):`, errorData);
      return new Response(errorData, {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(response.body, {
      status: response.status,
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'application/json',
      },
    });
  } catch (error: any) {
    console.error('Proxy Error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
