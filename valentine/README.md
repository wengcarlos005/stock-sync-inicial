# 💎 Presente Digital - Dia dos Namorados (tema The Sims)

Um site único (uma página, sem dependências externas) com:

1. **Tela de nome**: ela digita o nome e só avança escrevendo "Esposa do Weng" 😏
2. **Create-a-Sim**: criação de personagem (tom de pele, cabelo, roupa e acessório)
3. **Reação**: "Nossa... que gatinha! Fiu fiu 🎶"
4. **Cartinha principal**: envelope que revela uma mensagem em sequência, com efeito de digitação
5. **Caça às cartinhas**: um quarto com 4 objetos clicáveis (pintinho, chapéu mexicano, DVD do Coldplay e gatinho), cada um revela uma cartinha extra
6. **Tela final** de celebração

## Como personalizar

Tudo o que você precisa editar está no topo do arquivo [`script.js`](./script.js), dentro do objeto `CONFIG`:

- `requiredName`: resposta exigida na tela inicial (normalizada: sem acento e minúsculo)
- `letterParagraphs`: parágrafos da carta principal, exibidos em sequência
- `cas`: cores/opções disponíveis na criação do personagem (pele, cabelo, roupa, acessórios)
- `hiddenCards`: os 4 objetos do quarto — `emoji`, posição (`top`/`left` em %), `title` e `message` de cada cartinha encontrada

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
