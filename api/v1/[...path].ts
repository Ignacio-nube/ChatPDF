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
  const path = url.pathname.replace('/api/v1', '');
  const targetUrl = `https://api.openai.com/v1${path}`;

  const headers = new Headers();
  // Copiamos solo los headers necesarios para evitar conflictos
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

    // Si OpenAI devuelve un error, intentamos capturarlo para el log
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
