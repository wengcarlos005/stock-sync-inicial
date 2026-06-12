/* =========================================================
   PERSONALIZE AQUI! ✏️
   Edite os textos abaixo para deixar o presente com a sua história.
   ========================================================= */
const CONFIG = {
  // Nome de quem vai receber o presente
  herName: "Amor",

  // Quem está enviando (assinatura da carta)
  yourName: "Weng",

  // Perguntas do quiz sobre o relacionamento de vocês.
  // "correct" é o índice (0, 1, 2 ou 3) da opção correta no array "options".
  // Troque pelas suas perguntas e respostas reais! 💕
  quizQuestions: [
    {
      question: "Onde a gente se conheceu?",
      options: ["Na escola/faculdade", "Em um aplicativo", "Por amigos em comum", "Em uma festa"],
      correct: 1,
      correctFeedback: "Isso! Foi ali que tudo começou. 🥹",
      incorrectFeedback: "Quase! Mas o importante é que a gente se encontrou. 💞"
    },
    {
      question: "Qual foi o nosso primeiro encontro?",
      options: ["Cinema", "Um café", "Um passeio no parque", "Um jantar"],
      correct: 2,
      correctFeedback: "Perfeito! Lembro de cada detalhe daquele dia. 🌷",
      incorrectFeedback: "Foi um momento tão especial que merece estar na memória pra sempre. 💗"
    },
    {
      question: "Qual é a nossa música do casal?",
      options: ["Aquela que toca sempre no carro", "A que tocou no nosso encontro", "Uma que cantamos juntos", "Surpresa! Eu escolhi uma nova"],
      correct: 0,
      correctFeedback: "Com certeza! Essa música é a nossa trilha sonora. 🎶",
      incorrectFeedback: "Toda música boa vira 'a nossa música' quando é com você. 🎵"
    },
    {
      question: "O que mais me encanta em você?",
      options: ["Seu sorriso", "Seu jeito de cuidar de mim", "Sua risada", "Tudo isso e muito mais"],
      correct: 3,
      correctFeedback: "Exatamente, é tudo isso e muito mais! 😍",
      incorrectFeedback: "Pode até ser, mas a verdade é: é tudo isso e muito mais! 😍"
    },
    {
      question: "Qual é o nosso próximo sonho juntos?",
      options: ["Viajar para um lugar novo", "Morar juntos", "Realizar um grande projeto", "Viver muitas surpresas como essa"],
      correct: 0,
      correctFeedback: "Sim! Esse é o próximo destino da nossa lista. ✈️",
      incorrectFeedback: "Seja qual for, quero viver com você. 🌍"
    }
  ],

  // Galeria de momentos. Troque o "icon" por uma foto real adicionando:
  // "image": "photos/foto1.jpg"  (coloque o arquivo dentro da pasta /valentine/photos)
  gallery: [
    { icon: "📍", caption: "Onde nos conhecemos" },
    { icon: "💌", caption: "Nosso primeiro encontro" },
    { icon: "🎶", caption: "Nossa música" },
    { icon: "🌅", caption: "Aquela viagem inesquecível" },
    { icon: "🥳", caption: "Uma data especial" },
    { icon: "💍", caption: "O futuro que sonhamos" }
  ],

  // Carta final — escreva do fundo do coração 💕
  letter: `Meu amor,

Hoje eu quis fazer algo diferente para te mostrar o quanto você é especial pra mim.
Cada pergunta desse jogo, cada foto, cada palavra... são só uma pequena parte de tudo que sinto.

Obrigado por estar comigo, por rir comigo, por sonhar comigo.
Você faz os meus dias mais bonitos e a minha vida mais leve.

Feliz Dia dos Namorados! Te amo muito. 🐼💖`
};
/* =========================================================
   Fim das personalizações — o código abaixo cuida da mágica ✨
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  // Personaliza nomes
  document.getElementById("cover-name").textContent = CONFIG.herName;

  startFloatingHearts();
  setupCover();
  setupQuiz();
  setupGallery();
  setupLetter();
});

/* ---------- Navegação entre telas ---------- */
function goToScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- Corações flutuando no fundo ---------- */
function startFloatingHearts() {
  const container = document.getElementById("hearts-bg");
  const emojis = ["❤️", "💕", "💖", "💗", "💝"];

  function spawnHeart() {
    const heart = document.createElement("span");
    heart.className = "floating-heart";
    heart.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    heart.style.left = `${Math.random() * 100}vw`;
    heart.style.fontSize = `${1 + Math.random() * 1.5}rem`;
    const duration = 6 + Math.random() * 6;
    heart.style.animationDuration = `${duration}s`;
    container.appendChild(heart);
    setTimeout(() => heart.remove(), duration * 1000);
  }

  for (let i = 0; i < 6; i++) setTimeout(spawnHeart, i * 400);
  setInterval(spawnHeart, 1200);
}

/* ---------- Tela 1: Capa ---------- */
function setupCover() {
  const open = () => goToScreen("screen-quiz");
  document.getElementById("btn-open").addEventListener("click", open);
  document.getElementById("envelope").addEventListener("click", open);
}

/* ---------- Tela 2: Quiz ---------- */
function setupQuiz() {
  let currentIndex = 0;
  let score = 0;

  const questionEl = document.getElementById("quiz-question");
  const optionsEl = document.getElementById("quiz-options");
  const feedbackBox = document.getElementById("quiz-feedback");
  const feedbackText = document.getElementById("quiz-feedback-text");
  const progressFill = document.getElementById("progress-fill");
  const progressLabel = document.getElementById("progress-label");
  const nextBtn = document.getElementById("btn-next-question");
  const questionBox = document.getElementById("quiz-question-box");
  const resultCard = document.getElementById("quiz-result");

  function renderQuestion() {
    const q = CONFIG.quizQuestions[currentIndex];
    questionEl.textContent = q.question;
    optionsEl.innerHTML = "";
    feedbackBox.classList.add("hidden");
    questionBox.classList.remove("hidden");

    const total = CONFIG.quizQuestions.length;
    progressFill.style.width = `${((currentIndex) / total) * 100 + (100 / total)}%`;
    progressLabel.textContent = `Pergunta ${currentIndex + 1} de ${total}`;

    q.options.forEach((optionText, i) => {
      const btn = document.createElement("button");
      btn.className = "quiz-option";
      btn.textContent = optionText;
      btn.addEventListener("click", () => selectAnswer(i));
      optionsEl.appendChild(btn);
    });
  }

  function selectAnswer(selectedIndex) {
    const q = CONFIG.quizQuestions[currentIndex];
    const buttons = optionsEl.querySelectorAll(".quiz-option");
    buttons.forEach((btn, i) => {
      btn.disabled = true;
      if (i === q.correct) btn.classList.add("correct");
      if (i === selectedIndex && selectedIndex !== q.correct) btn.classList.add("incorrect");
    });

    const isCorrect = selectedIndex === q.correct;
    if (isCorrect) score++;

    feedbackText.textContent = isCorrect ? q.correctFeedback : q.incorrectFeedback;
    feedbackBox.classList.remove("hidden");

    nextBtn.textContent = currentIndex === CONFIG.quizQuestions.length - 1 ? "Ver resultado" : "Próxima";
  }

  nextBtn.addEventListener("click", () => {
    currentIndex++;
    if (currentIndex < CONFIG.quizQuestions.length) {
      renderQuestion();
    } else {
      showResult();
    }
  });

  function showResult() {
    questionBox.classList.add("hidden");
    feedbackBox.classList.add("hidden");
    progressFill.style.width = "100%";
    progressLabel.textContent = "Quiz completo!";
    resultCard.classList.remove("hidden");

    document.getElementById("quiz-score").textContent = "100";
    requestAnimationFrame(() => {
      setTimeout(() => {
        document.getElementById("heart-meter-fill").style.height = "100%";
      }, 200);
    });
  }

  document.getElementById("btn-go-gallery").addEventListener("click", () => {
    goToScreen("screen-gallery");
  });

  renderQuestion();
}

/* ---------- Tela 3: Galeria ---------- */
function setupGallery() {
  const grid = document.getElementById("gallery-grid");
  grid.innerHTML = "";

  CONFIG.gallery.forEach((item) => {
    const div = document.createElement("div");
    div.className = "gallery-item";

    if (item.image) {
      div.style.backgroundImage = `url('${item.image}')`;
    } else {
      const icon = document.createElement("span");
      icon.className = "icon";
      icon.textContent = item.icon;
      div.appendChild(icon);
    }

    const caption = document.createElement("span");
    caption.textContent = item.caption;
    div.appendChild(caption);

    grid.appendChild(div);
  });

  document.getElementById("btn-go-letter").addEventListener("click", () => {
    goToScreen("screen-letter");
  });
}

/* ---------- Tela 4: Carta com efeito de digitação ---------- */
function setupLetter() {
  const textEl = document.getElementById("letter-text");
  const signatureEl = document.getElementById("letter-signature");
  signatureEl.textContent = `Com amor, ${CONFIG.yourName} 💌`;

  let typingTimeout;

  function typeLetter() {
    textEl.textContent = "";
    textEl.classList.add("typing-cursor");
    signatureEl.style.opacity = "0";

    const fullText = CONFIG.letter;
    let i = 0;

    clearTimeout(typingTimeout);
    function typeChar() {
      if (i < fullText.length) {
        textEl.textContent += fullText.charAt(i);
        i++;
        typingTimeout = setTimeout(typeChar, 22);
      } else {
        textEl.classList.remove("typing-cursor");
        signatureEl.style.transition = "opacity 0.6s ease";
        signatureEl.style.opacity = "1";
      }
    }
    typeChar();
  }

  // Inicia a digitação quando a tela da carta fica visível
  const observer = new MutationObserver(() => {
    if (document.getElementById("screen-letter").classList.contains("active")) {
      typeLetter();
    }
  });
  observer.observe(document.getElementById("screen-letter"), { attributes: true, attributeFilter: ["class"] });

  document.getElementById("btn-replay").addEventListener("click", () => {
    goToScreen("screen-cover");
  });
}
