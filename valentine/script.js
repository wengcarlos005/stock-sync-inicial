/* =========================================================
   PERSONALIZE AQUI! ✏️
   ========================================================= */
const CONFIG = {
  // Resposta correta para a tela inicial (sem acento/maiúsculas, é normalizado)
  requiredName: "esposa do weng",

  // Carta principal (tela do envelope). Cada item do array é exibido em sequência.
  letterParagraphs: [
    "Oi benzinho! Fiz uma surpresa :)",
    "Se você está lendo isso, significa que encontrou uma das minhas cartinhas escondidas. Eu queria deixar um pedacinho de mim aqui para te fazer sorrir, mesmo quando eu não estiver por perto.",
    "Obrigado por tornar meus dias mais leves, pelas nossas conversas, pelas risadas e por todos os momentos que compartilhamos. Você é uma das pessoas mais especiais da minha vida, e cada dia ao seu lado é uma dádiva que eu amo viver.",
    "Espero que essa pequena surpresa tenha deixado seu dia um pouquinho mais feliz e que sempre tem alguém pensando em você com muito carinho.",
    "Te amo, benzinho. ❤️"
  ],

  // Opções de personalização do personagem (Create-a-Sim)
  cas: {
    skinColors: ["#ffdbac", "#f1c27d", "#e0ac69", "#c68642", "#8d5524"],
    hairColors: ["#2c1b18", "#6b4226", "#b55239", "#d6b370", "#7c5cff", "#ff7aa8"],
    outfitColors: ["#7c5cff", "#4cd9b0", "#ff7aa8", "#4f8ff7", "#ffce54", "#2f2a4a"],
    accessories: [
      { emoji: "", label: "Nenhum" },
      { emoji: "😎", label: "Óculos" },
      { emoji: "🎀", label: "Laço" },
      { emoji: "👑", label: "Coroa" },
      { emoji: "🌸", label: "Flor" },
      { emoji: "🎩", label: "Chapéu" }
    ]
  },

  // Caça às cartinhas: objetos escondidos no quarto.
  // "top"/"left" são porcentagens dentro do quarto.
  hiddenCards: [
    {
      id: "chick",
      emoji: "🐥",
      name: "Pintinho de pelúcia",
      top: "62%",
      left: "10%",
      title: "Cartinha do Pintinho",
      message: "Você é fofa(o) que nem esse pintinho! Esse bichinho me lembra você toda vez que olho pra ele na estante."
    },
    {
      id: "hat",
      emoji: "👒",
      name: "Chapéu Mexicano",
      top: "12%",
      left: "68%",
      title: "Cartinha do Chapéu",
      message: "Lembra desse chapéu? Quero viver muitas aventuras e viagens novas com você, igual aquele dia."
    },
    {
      id: "dvd",
      emoji: "💿",
      name: "DVD do Coldplay",
      top: "52%",
      left: "78%",
      title: "Cartinha do Coldplay",
      message: "Toda vez que ouço Coldplay penso em você. Quero que a gente tenha muitas trilhas sonoras pra nossa história."
    },
    {
      id: "cat",
      emoji: "🐱",
      name: "Gatinho",
      top: "70%",
      left: "42%",
      title: "Cartinha do Gatinho",
      message: "Fiu fiu! 😻 Essa gatinha aqui é a coisa mais linda que existe... assim como você."
    }
  ]
};
/* =========================================================
   Fim das personalizações — o código abaixo cuida da mágica ✨
   ========================================================= */

document.addEventListener("DOMContentLoaded", () => {
  startFloaters();
  setupNameScreen();
  setupCAS();
  setupReaction();
  setupLetter();
  setupRoom();
  setupFinal();
});

/* ---------- Navegação entre telas ---------- */
function goToScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- Itens flutuando no fundo ---------- */
function startFloaters() {
  const container = document.getElementById("floaters-bg");
  const emojis = ["💎", "❤️", "✨", "🐱", "💚"];

  function spawn() {
    const item = document.createElement("span");
    item.className = "floating-item";
    item.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    item.style.left = `${Math.random() * 100}vw`;
    item.style.fontSize = `${1 + Math.random() * 1.5}rem`;
    const duration = 6 + Math.random() * 6;
    item.style.animationDuration = `${duration}s`;
    container.appendChild(item);
    setTimeout(() => item.remove(), duration * 1000);
  }

  for (let i = 0; i < 6; i++) setTimeout(spawn, i * 400);
  setInterval(spawn, 1200);
}

/* ---------- Tela 1: Nome ---------- */
function normalizeName(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function setupNameScreen() {
  const form = document.getElementById("name-form");
  const input = document.getElementById("name-input");
  const error = document.getElementById("name-error");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = normalizeName(input.value);

    if (value === CONFIG.requiredName) {
      goToScreen("screen-cas");
      return;
    }

    error.classList.remove("hidden");
    const card = form.closest(".card");
    card.classList.remove("shake");
    requestAnimationFrame(() => card.classList.add("shake"));
  });
}

/* ---------- Tela 2: Create-a-Sim ---------- */
let currentAvatar = {
  skin: CONFIG.cas.skinColors[0],
  hair: CONFIG.cas.hairColors[0],
  outfit: CONFIG.cas.outfitColors[0],
  accessory: CONFIG.cas.accessories[0].emoji
};

function applyAvatarVars(stage) {
  stage.style.setProperty("--skin-color", currentAvatar.skin);
  stage.style.setProperty("--hair-color", currentAvatar.hair);
  stage.style.setProperty("--outfit-color", currentAvatar.outfit);
  const accessoryEl = stage.querySelector(".sim-accessory");
  if (accessoryEl) accessoryEl.textContent = currentAvatar.accessory;
}

function setupCAS() {
  const stage = document.getElementById("avatar-stage");

  buildColorSwatches("swatches-skin", CONFIG.cas.skinColors, (color) => {
    currentAvatar.skin = color;
    applyAvatarVars(stage);
  });

  buildColorSwatches("swatches-hair", CONFIG.cas.hairColors, (color) => {
    currentAvatar.hair = color;
    applyAvatarVars(stage);
  });

  buildColorSwatches("swatches-outfit", CONFIG.cas.outfitColors, (color) => {
    currentAvatar.outfit = color;
    applyAvatarVars(stage);
  });

  buildAccessorySwatches("swatches-accessory", CONFIG.cas.accessories, (emoji) => {
    currentAvatar.accessory = emoji;
    applyAvatarVars(stage);
  });

  applyAvatarVars(stage);

  document.getElementById("btn-cas-done").addEventListener("click", () => {
    goToScreen("screen-reaction");
  });
}

function buildColorSwatches(containerId, colors, onSelect) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  colors.forEach((color, i) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch";
    swatch.style.background = color;
    if (i === 0) swatch.classList.add("selected");

    swatch.addEventListener("click", () => {
      container.querySelectorAll(".swatch").forEach((el) => el.classList.remove("selected"));
      swatch.classList.add("selected");
      onSelect(color);
    });

    container.appendChild(swatch);
  });
}

function buildAccessorySwatches(containerId, accessories, onSelect) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";

  accessories.forEach((acc, i) => {
    const swatch = document.createElement("button");
    swatch.type = "button";
    swatch.className = "swatch-accessory";
    swatch.textContent = acc.emoji || "✖️";
    swatch.title = acc.label;
    if (i === 0) swatch.classList.add("selected");

    swatch.addEventListener("click", () => {
      container.querySelectorAll(".swatch-accessory").forEach((el) => el.classList.remove("selected"));
      swatch.classList.add("selected");
      onSelect(acc.emoji);
    });

    container.appendChild(swatch);
  });
}

/* ---------- Tela 3: Reação ---------- */
function setupReaction() {
  document.getElementById("btn-go-letter").addEventListener("click", () => {
    const casStage = document.getElementById("avatar-stage");
    const reactionStage = document.getElementById("avatar-stage-reaction");
    reactionStage.innerHTML = casStage.innerHTML;
    reactionStage.style.cssText = casStage.style.cssText;

    goToScreen("screen-letter");
  });
}

/* ---------- Tela 4: Cartinha principal ---------- */
function setupLetter() {
  const envelope = document.getElementById("envelope");
  const paper = document.getElementById("letter-paper");
  const hint = document.getElementById("letter-hint");
  const title = document.getElementById("letter-title");
  const textEl = document.getElementById("letter-text");
  const nextBtn = document.getElementById("btn-letter-next");

  let paragraphIndex = 0;
  let typingTimeout;

  function typeParagraph() {
    const text = CONFIG.letterParagraphs[paragraphIndex];
    textEl.textContent = "";
    textEl.classList.add("typing-cursor");
    nextBtn.classList.add("hidden");

    let i = 0;
    clearTimeout(typingTimeout);
    function typeChar() {
      if (i < text.length) {
        textEl.textContent += text.charAt(i);
        i++;
        typingTimeout = setTimeout(typeChar, 22);
      } else {
        textEl.classList.remove("typing-cursor");
        nextBtn.textContent = paragraphIndex === CONFIG.letterParagraphs.length - 1
          ? "Ir para o quarto"
          : "Continuar";
        nextBtn.classList.remove("hidden");
      }
    }
    typeChar();
  }

  envelope.addEventListener("click", () => {
    if (!paper.classList.contains("hidden")) return;
    paper.classList.remove("hidden");
    hint.classList.add("hidden");
    title.textContent = "Sua cartinha 💌";
    typeParagraph();
  });

  nextBtn.addEventListener("click", () => {
    if (paragraphIndex < CONFIG.letterParagraphs.length - 1) {
      paragraphIndex++;
      typeParagraph();
    } else {
      goToScreen("screen-room");
    }
  });
}

/* ---------- Tela 5: Caça às cartinhas ---------- */
function setupRoom() {
  const room = document.getElementById("room");
  const counter = document.getElementById("found-counter");
  const modal = document.getElementById("card-modal");
  const modalEmoji = document.getElementById("modal-emoji");
  const modalTitle = document.getElementById("modal-title");
  const modalText = document.getElementById("modal-text");
  const modalClose = document.getElementById("btn-modal-close");

  let foundCount = 0;
  const total = CONFIG.hiddenCards.length;

  CONFIG.hiddenCards.forEach((card) => {
    const el = document.createElement("span");
    el.className = "hidden-object";
    el.textContent = card.emoji;
    el.style.top = card.top;
    el.style.left = card.left;
    el.title = card.name;
    el.dataset.id = card.id;

    el.addEventListener("click", () => {
      if (el.classList.contains("found")) return;

      el.classList.add("found");
      foundCount++;
      counter.textContent = `${foundCount} de ${total} encontradas`;

      modalEmoji.textContent = card.emoji;
      modalTitle.textContent = card.title;
      modalText.textContent = card.message;
      modal.classList.remove("hidden");
      modal.dataset.lastCard = foundCount === total ? "last" : "";
    });

    room.appendChild(el);
  });

  counter.textContent = `0 de ${total} encontradas`;

  modalClose.addEventListener("click", () => {
    modal.classList.add("hidden");
    if (modal.dataset.lastCard === "last") {
      goToScreen("screen-final");
    }
  });
}

/* ---------- Tela 6: Final ---------- */
function setupFinal() {
  document.getElementById("btn-replay").addEventListener("click", () => {
    location.reload();
  });
}
