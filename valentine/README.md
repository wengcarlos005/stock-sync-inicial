# 💎 Presente Digital - Dia dos Namorados (tema The Sims · estilo jornal vintage)

Um site único (uma página, sem dependências externas), com estética pastel
e de jornal antigo ("O Diário do Amor"):

1. **Capa de jornal + nome**: ela digita o nome e só avança escrevendo "Esposa do Weng" 😏
2. **Create-a-Sim**: criação de personagem em SVG (pele, cor e estilo do cabelo
   — cacheado/ondulado/liso/coque —, olhos, roupa e acessório). Padrões já
   ajustados para se parecer com ela (cacheada, castanho-escuro, pele clara, blusa branca)
3. **Reação**: "Nossa... que gatinha! Fiu fiu 🎶" mostrando o personagem criado
4. **Cartinha principal**: envelope com selo de cera que revela a mensagem em sequência, com efeito de digitação
5. **Caça às cartinhas**: um quarto completo e ilustrado com 4 objetos clicáveis
   (pintinho de pelúcia, chapéu mexicano, DVD do Coldplay e gatinho), cada um revela uma cartinha
6. **Tela final** de celebração

## Como personalizar

Tudo o que você precisa editar está no topo do arquivo [`script.js`](./script.js), dentro do objeto `CONFIG`:

- `requiredName`: resposta exigida na tela inicial (normalizada: sem acento e minúsculo)
- `signature`: assinatura usada na carta e na tela final
- `letterParagraphs`: parágrafos da carta principal, exibidos em sequência
- `hiddenCards`: as 4 cartinhas do quarto (chave = id do objeto no SVG:
  `obj-chick`, `obj-hat`, `obj-dvd`, `obj-cat`), cada uma com `title` e `message`
- `cas`: cores/opções e padrões da criação do personagem (pele, cabelo, estilo, olhos, roupa, acessórios)

Depois de editar, é só salvar o arquivo — não precisa instalar nada.

## Como ver localmente

Basta abrir o arquivo `index.html` em qualquer navegador.

## Como publicar com link (GitHub Pages)

Este repositório já inclui um workflow (`.github/workflows/valentine-pages.yml`) que publica
automaticamente a pasta `valentine/` no GitHub Pages sempre que houver um push na branch `main`.

Para ativar (uma vez só):

1. No GitHub, vá em **Settings > Pages**
2. Em **Source**, selecione **GitHub Actions**
3. Faça merge/push das alterações para a branch `main`
4. Após o workflow rodar, o link ficará disponível em algo como:
   `https://<seu-usuario>.github.io/<nome-do-repositorio>/`

## Dica

Envie o link pelo WhatsApp acompanhado de uma mensagem fofa antes da pessoa abrir 💌
