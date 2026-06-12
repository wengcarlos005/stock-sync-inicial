# 💕 Presente Digital - Dia dos Namorados

Um site único (uma página, sem dependências externas) com:

1. **Capa/envelope** animado para abrir o presente
2. **Quiz** romântico sobre a relação de vocês
3. **Galeria** de momentos especiais
4. **Carta final** com efeito de digitação

## Como personalizar

Tudo o que você precisa editar está no topo do arquivo [`script.js`](./script.js), dentro do objeto `CONFIG`:

- `herName`: nome de quem vai receber
- `yourName`: usado na assinatura da carta
- `quizQuestions`: array com 5 perguntas (pergunta, opções, índice da opção correta e mensagens de feedback)
- `gallery`: 6 itens da galeria. Para usar fotos reais:
  1. Coloque os arquivos de imagem dentro da pasta `valentine/photos/`
  2. No item correspondente, adicione `image: "photos/sua-foto.jpg"` (substitui o ícone)
- `letter`: texto da carta final (use `\n` para quebras de linha)

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
