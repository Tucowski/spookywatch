// Completa as tags de prévia (Discord, WhatsApp...) com o endereço real do site.
// O HTML traz caminhos relativos ("/og.png"); aqui eles viram endereços completos,
// então funciona em qualquer domínio sem precisar configurar nada.
export default async (request, context) => {
  const res = await context.next();
  if (!(res.headers.get("content-type") || "").includes("text/html")) return res;
  const origin = new URL(request.url).origin;
  const html = (await res.text())
    .replaceAll('content="/og.png"', `content="${origin}/og.png"`)
    .replaceAll('content="/"', `content="${origin}/"`);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(html, { status: res.status, headers });
};

export const config = { path: "/" };
