# Spookywatch 🎃

Site de inscrição do torneio 5v5 de Overwatch, com times ao vivo.

## Como funciona

- Quem quer inscrever um time "entra" com o **nome** e o **@ do Discord**. Não há senha nem ligação com o Discord: é só uma identificação. Essa pessoa vira o **capitão**, e a organização a chama por esse @.
- Um @ só pode ser capitão de um time.
- O time aparece na página de todo mundo em poucos segundos (a página consulta a API a cada 4 s).
- O capitão edita ou cancela o time até o início do torneio, pelo mesmo navegador em que se inscreveu.

## Variável de ambiente (Netlify)

Em **Site configuration → Environment variables**, crie:

| Nome | Para que serve |
| --- | --- |
| `ADMIN_TOKEN` | Senha da organização, com 8 ou mais caracteres. Use uma senha longa |

Depois de salvar, faça um novo deploy (**Deploys → Trigger deploy**) para ela valer.

## Publicar

Use **GitHub** (recomendado) ou a **Netlify CLI**. Arrastar a pasta no painel pode publicar o site sem instalar as dependências da API.

GitHub: suba esta pasta em um repositório, em Netlify clique em **Add new site → Import from Git** e escolha o repositório. As configurações já estão em `netlify.toml`.

CLI:

```
npm install
npx netlify-cli deploy --prod
```

## Acesso da organização

No rodapé do site, **Acesso da organização**, entre com o `ADMIN_TOKEN`. Aparecem os botões **Confirmar** e **Remover** nos cartões e o painel para trocar número de vagas, data de início e abrir ou fechar inscrições.

Valores padrão: 16 vagas, início em 31/10/2026 às 20h (horário de Brasília), inscrições abertas.

## Arquivos

- `public/index.html`: o site inteiro.
- `netlify/functions/api.mjs`: API em `/api/*`. Guarda tudo no Netlify Blobs e valida de novo no servidor.
- Cada time recebe uma chave secreta guardada no navegador de quem se inscreveu. Só quem tem essa chave edita ou cancela o time. A organização edita qualquer um com o token.
