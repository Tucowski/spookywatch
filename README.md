# Spookywatch 🎃

Site de inscrição do torneio 5v5 de Overwatch, com times ao vivo.

## Como funciona

- Quem quer inscrever um time **cria uma conta de capitão**: nome, **@ do Discord** e **senha** (6 a 72 caracteres). A senha é guardada só como hash (scrypt). Depois é só entrar com o @ e a senha, em qualquer aparelho.
- Um @ só pode ser capitão de um time.
- O time aparece na página de todo mundo em poucos segundos (a página consulta a API a cada 4 s).
- O capitão edita ou cancela o time até o início do torneio. Só ele (logado) ou a organização pode mexer no time. Cinco senhas erradas seguidas bloqueiam o @ por 10 minutos.
- Não há verificação com o Discord: quem criar a conta primeiro com um @ fica com ele. Se alguém esquecer a senha ou usarem o @ de outra pessoa, a organização clica em **Resetar senha** no cartão do time e o capitão cria a conta de novo.

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

No rodapé do site, **Acesso da organização**, entre com o `ADMIN_TOKEN`. Aparecem os botões **Confirmar** e **Remover** nos cartões e o painel para trocar número de vagas, data de início, prazo das inscrições e abrir ou fechar inscrições.

Valores padrão: 16 vagas, inscrições até 24/10/2026 às 23h59 (horário de Brasília), início em 31/10/2026 às 20h, inscrições abertas. Depois do prazo ninguém novo se inscreve, mas quem já está dentro ainda pode editar o time.

A faixa de datas do site mostra: inscrições até o prazo, resultados dos grupos em 26/10 (segunda) e o torneio na data de início. Prazo e início mudam sozinhos conforme o painel; o dia 26/10 está escrito direto em `public/index.html`.

## Arquivos

- `public/index.html`: o site inteiro.
- `netlify/functions/api.mjs`: API em `/api/*`. Guarda tudo no Netlify Blobs e valida de novo no servidor.
- Contas de capitão ficam em `cap/*` e sessões (30 dias) em `sess/*` no Netlify Blobs. Times criados antes das senhas passam a ser do capitão que criar conta com o mesmo @.

## Chaveamento e combate ao vivo

- Com o acesso da organização, na seção **Chaveamento** aparece **Gerar chaveamento**. Ele sorteia os times **confirmados** em eliminação simples (potência de 2; quando falta time, os "byes" avançam sozinhos). **Sortear de novo** refaz tudo; **Apagar chaveamento** limpa.
- Em cada confronto pronto, a organização tem **Colocar ao vivo** / **Encerrar ao vivo** e **Venceu: TAG** (toque duas vezes para confirmar). O vencedor avança sozinho; corrigir um resultado limpa o que dependia dele.
- Enquanto há confronto ao vivo, todo mundo vê uma faixa vermelha "Combate ao vivo" no topo e o selo AO VIVO no confronto.
- O chaveamento guarda uma cópia de tag, nome e cor dos times: remover um time depois do sorteio não quebra a chave.

## Botão do Discord

O convite do servidor (`https://discord.gg/Zu63wCXgyM`) está em dois botões em `public/index.html`: no topo e ao lado de "Inscrever meu time". O símbolo usado é um balão de conversa genérico. Para mostrar o logo oficial, baixe-o da página de marca do Discord, salve como `public/discord-logo.svg` e publique: ele substitui o balão sozinho. Para trocar o link, procure `discord.gg` no arquivo e troque nos dois lugares.

## Transmissão, FAQ e tema

- Cada confronto tem a sua própria transmissão: com o acesso da organização, o botão **Link da live** no confronto salva o link (https da Twitch, do YouTube ou da Kick; qualquer outro é recusado). Vários confrontos podem estar ao vivo ao mesmo tempo, cada um com o seu botão **Assistir** na faixa vermelha e no cartão do confronto.
- O campo **Link da transmissão geral** do painel é só reserva: vale para confrontos ao vivo que não têm link próprio. Deixe vazio se não usar.
- A seção **Perguntas frequentes** é HTML simples em `public/index.html` (`<section class="faq">`); edite os textos ali.
- O tema de Halloween (neblina, morcegos e fantasmas, brilho no título) usa só animações de `transform` e é desligado para quem pede menos movimento no sistema. Em telas pequenas aparecem menos elementos.

## Prévia ao compartilhar

- Ao colar o link do site no Discord, no WhatsApp ou no X, aparece um cartão com a imagem `public/og.png` (1200×630) e o título de Halloween. Os textos estão nas tags `og:` e `twitter:` no começo de `public/index.html`.
- `netlify/edge-functions/og.js` troca os caminhos relativos pelo endereço completo do site, então não é preciso configurar domínio.
- Discord e WhatsApp guardam a prévia em cache. Se mudar a imagem ou o texto e o cartão antigo continuar aparecendo, gere uma prévia nova (no Facebook, a ferramenta "Depurador de Compartilhamento") ou espere o cache expirar.
