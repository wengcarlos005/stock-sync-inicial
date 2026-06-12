/* =========================================================
   PERSONALIZE AQUI! ✏️
   ========================================================= */
const CONFIG = {
  // Resposta exigida na tela inicial (normalizada: sem acento e minúscula)
  requiredName: "esposa do weng",

  // Assinatura usada na carta
  signature: "Com todo o meu amor, Weng 💌",

  // Carta principal — cada item é exibido em sequência, com efeito de digitação
  letterParagraphs: [
    "Oi benzinho! Fiz uma surpresa :)",
    "Se você está lendo isso, significa que encontrou uma das minhas cartinhas escondidas. Eu queria deixar um pedacinho de mim aqui para te fazer sorrir, mesmo quando eu não estiver por perto.",
    "Obrigado por tornar meus dias mais leves, pelas nossas conversas, pelas risadas e por todos os momentos que compartilhamos. Você é a pessoa mais especial da minha vida, e cada dia ao seu lado é uma dádiva que eu amo viver.",
    "Espero que essa pequena surpresa tenha deixado seu dia um pouquinho mais feliz, e que sempre estou pensando em você…",
    "Te amo, benzinho. ❤️"
  ],

  // Cartinhas escondidas no quarto (id deve casar com o id do objeto no SVG)
  hiddenCards: {
    "obj-chick": {
      title: "A cartinha do Pintinho",
      message: "Esse pintinho é fofo, mas perde feio pra você. Toda vez que bato o olho nele, lembro do seu sorriso e do quanto você é meiga comigo."
    },
    "obj-hat": {
      title: "A cartinha do Chapéu",
      message: "Esse chapéu me lembra que eu quero viver mil aventuras e viagens ao seu lado. Pra onde você for, eu quero ir junto."
    },
    "obj-dvd": {
      title: "A cartinha do Coldplay",
      message: "Toda vez que ouço Coldplay, é em você que eu penso. Você é a melhor música que já tocou na minha vida — e eu quero ouvir pra sempre."
    },
    "obj-cat": {
      title: "A cartinha do Gatinho",
      message: "Fiu fiu! 😻 Essa gatinha aqui é a coisa mais linda do quarto… empatada só com você. Te amo, benzinho."
    }
  },

  // Opções de criação de personagem (ajuste à vontade)
  cas: {
    // pele clara como padrão (índice 1)
    skinColors: ["#fbe0cd", "#f6cdb0", "#eebb96", "#d9a06f", "#bd7d4e", "#8d5a36"],
    skinDefault: 1,
    // castanho-escuro como padrão (índice 1)
    hairColors: ["#2b1b14", "#43291b", "#6b4423", "#9c6a35", "#c08a52", "#b06a6a", "#7c9a7b", "#b6a6cc"],
    hairDefault: 1,
    // cacheado como padrão
    hairStyles: [
      { id: "cacheado", label: "Cacheado" },
      { id: "ondulado", label: "Ondulado" },
      { id: "liso", label: "Liso" },
      { id: "coque", label: "Coque" }
    ],
    hairStyleDefault: 0,
    // olhos castanhos como padrão
    eyeColors: ["#5b3a1e", "#3d2817", "#7a5230", "#6b8e5a", "#4f7a9a"],
    eyeDefault: 0,
    // blusa branca como padrão (índice 0)
    outfitColors: ["#f3ead9", "#c98b8b", "#9bb49a", "#a7bdcc", "#b6a6cc", "#c4a059"],
    outfitDefault: 0,
    accessories: [
      { emoji: "", label: "—" },
      { emoji: "🌸", label: "Flor" },
      { emoji: "🎀", label: "Laço" },
      { emoji: "👓", label: "Óculos" },
      { emoji: "👑", label: "Coroa" }
    ],
    accessoryDefault: 0
  }
};
/* =========================================================
   Fim das personalizações ✨
   ========================================================= */

const avatar = {};

document.addEventListener("DOMContentLoaded", () => {
  // defaults
  const c = CONFIG.cas;
  avatar.skin = c.skinColors[c.skinDefault];
  avatar.hair = c.hairColors[c.hairDefault];
  avatar.hairStyle = c.hairStyles[c.hairStyleDefault].id;
  avatar.eyes = c.eyeColors[c.eyeDefault];
  avatar.outfit = c.outfitColors[c.outfitDefault];
  avatar.accessory = c.accessories[c.accessoryDefault].emoji;

  startFloaters();
  setupNameScreen();
  setupCAS();
  setupReaction();
  setupLetter();
  setupRoom();
  setupFinal();

  document.getElementById("letter-sign").textContent = CONFIG.signature;
  document.getElementById("final-sign").textContent = CONFIG.signature;
});

/* ---------- Navegação ---------- */
function goToScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

/* ---------- Fundo flutuante ---------- */
function startFloaters() {
  const container = document.getElementById("floaters-bg");
  const emojis = ["🤍", "❦", "✿", "♡", "❀"];
  function spawn() {
    const item = document.createElement("span");
    item.className = "floating-item";
    item.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    item.style.left = `${Math.random() * 100}vw`;
    item.style.fontSize = `${0.9 + Math.random() * 1.3}rem`;
    const duration = 8 + Math.random() * 7;
    item.style.animationDuration = `${duration}s`;
    container.appendChild(item);
    setTimeout(() => item.remove(), duration * 1000);
  }
  for (let i = 0; i < 4; i++) setTimeout(spawn, i * 600);
  setInterval(spawn, 1800);
}

/* ---------- Tela 1: Nome ---------- */
function normalizeName(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
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
    if (normalizeName(input.value) === CONFIG.requiredName) {
      goToScreen("screen-cas");
      return;
    }
    error.classList.remove("hidden");
    const card = form.closest(".card");
    card.classList.remove("shake");
    requestAnimationFrame(() => card.classList.add("shake"));
  });
}

/* =========================================================
   AVATAR — SVG vetorial parametrizado
   ========================================================= */
function shade(hex, amt) {
  // escurece (amt<0) ou clareia (amt>0) uma cor hex
  const n = parseInt(hex.replace("#", ""), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, r + amt));
  g = Math.max(0, Math.min(255, g + amt));
  b = Math.max(0, Math.min(255, b + amt));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

function curlsMarkup(coords, color) {
  return coords.map(([x, y, r]) =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>`
  ).join("");
}

function hairBack(style, color) {
  const dark = shade(color, -22);
  if (style === "cacheado") {
    const back = [
      [100,48,34],[64,60,26],[136,60,26],[44,90,24],[156,90,24],
      [42,124,22],[158,124,22],[48,156,20],[152,156,20],
      [62,182,18],[138,182,18],[82,196,16],[118,196,16],[100,200,16]
    ];
    return `<ellipse cx="100" cy="100" rx="60" ry="58" fill="${color}"/>${curlsMarkup(back, color)}${curlsMarkup(back, dark).replace(/r="(\d+)"/g, (m,r)=>`r="${r-7}"`)}`;
  }
  if (style === "ondulado") {
    return `<path d="M40,110 Q36,46 100,42 Q164,46 160,110
      Q170,150 150,196 Q150,170 138,188 Q142,150 132,178
      Q120,150 116,180 L84,180 Q80,150 68,178 Q58,150 62,188
      Q50,170 50,196 Q30,150 40,110 Z" fill="${color}"/>`;
  }
  if (style === "liso") {
    return `<path d="M44,108 Q42,48 100,44 Q158,48 156,108 L156,200
      Q140,206 128,200 L128,120 Q120,150 116,120 L84,120 Q80,150 72,120
      L72,200 Q60,206 44,200 Z" fill="${color}"/>`;
  }
  if (style === "coque") {
    return `<circle cx="100" cy="40" r="24" fill="${color}"/>
      <circle cx="100" cy="40" r="24" fill="none" stroke="${dark}" stroke-width="3" opacity="0.5"/>
      <ellipse cx="100" cy="92" rx="54" ry="50" fill="${color}"/>`;
  }
  return "";
}

function hairFront(style, color) {
  const dark = shade(color, -22);
  if (style === "cacheado") {
    const front = [
      [70,62,16],[88,52,15],[112,52,15],[130,62,16],
      [56,92,14],[144,92,14],[56,122,13],[144,122,13],[64,150,12],[136,150,12]
    ];
    return curlsMarkup(front, color) +
      curlsMarkup([[100,58,15],[80,56,13],[120,56,13]], color);
  }
  if (style === "ondulado") {
    return `<path d="M58,70 Q100,40 142,70 Q120,58 100,62 Q80,58 58,70 Z" fill="${color}"/>
      <path d="M58,72 Q70,110 60,150" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round"/>
      <path d="M142,72 Q130,110 140,150" fill="none" stroke="${color}" stroke-width="16" stroke-linecap="round"/>`;
  }
  if (style === "liso") {
    return `<path d="M60,72 Q100,46 140,72 Q138,80 100,74 Q62,80 60,72 Z" fill="${color}"/>
      <path d="M100,48 L96,86 L104,86 Z" fill="${dark}" opacity="0.35"/>`;
  }
  if (style === "coque") {
    return `<path d="M62,78 Q100,52 138,78 Q120,66 100,70 Q80,66 62,78 Z" fill="${color}"/>`;
  }
  return "";
}

function accessoryMarkup(emoji) {
  if (!emoji) return "";
  if (emoji === "👓") {
    return `<text x="100" y="118" font-size="40" text-anchor="middle">${emoji}</text>`;
  }
  // flor/laço/coroa no cabelo
  const x = emoji === "🌸" ? 62 : 100;
  const y = emoji === "👑" ? 44 : 58;
  return `<text x="${x}" y="${y}" font-size="34" text-anchor="middle">${emoji}</text>`;
}

function buildAvatarSVG(o) {
  const skinShade = shade(o.skin, -18);
  const blush = "#e6a6a6";
  const browColor = shade(o.hair, -10);
  const outfitShade = shade(o.outfit, -22);
  const outfitLight = shade(o.outfit, 16);

  return `<svg viewBox="0 0 200 250" xmlns="http://www.w3.org/2000/svg">
    <!-- cabelo (trás) -->
    ${hairBack(o.hairStyle, o.hair)}

    <!-- corpo / blusa com mangas bufantes -->
    <ellipse cx="58" cy="206" rx="26" ry="22" fill="${outfitLight}"/>
    <ellipse cx="142" cy="206" rx="26" ry="22" fill="${outfitLight}"/>
    <path d="M50,250 Q52,196 78,188 L92,205 Q100,212 108,205 L122,188
             Q148,196 150,250 Z" fill="${o.outfit}"/>
    <path d="M92,205 Q100,214 108,205 L104,224 Q100,228 96,224 Z" fill="${outfitShade}"/>

    <!-- pescoço -->
    <path d="M90,168 q10,10 20,0 l2,20 q-12,10 -24,0 Z" fill="${skinShade}"/>

    <!-- rosto -->
    <ellipse cx="100" cy="108" rx="42" ry="48" fill="${o.skin}"/>
    <circle cx="60" cy="112" r="8" fill="${o.skin}"/>
    <circle cx="140" cy="112" r="8" fill="${o.skin}"/>

    <!-- bochechas -->
    <ellipse cx="70" cy="122" rx="9" ry="6" fill="${blush}" opacity="0.5"/>
    <ellipse cx="130" cy="122" rx="9" ry="6" fill="${blush}" opacity="0.5"/>

    <!-- sobrancelhas -->
    <path d="M68,92 q12,-6 22,-1" fill="none" stroke="${browColor}" stroke-width="3" stroke-linecap="round"/>
    <path d="M110,91 q10,-5 22,1" fill="none" stroke="${browColor}" stroke-width="3" stroke-linecap="round"/>

    <!-- olhos -->
    <ellipse cx="80" cy="104" rx="9" ry="7" fill="#fffaf2"/>
    <ellipse cx="120" cy="104" rx="9" ry="7" fill="#fffaf2"/>
    <circle cx="80" cy="105" r="5.2" fill="${o.eyes}"/>
    <circle cx="120" cy="105" r="5.2" fill="${o.eyes}"/>
    <circle cx="80" cy="105" r="2.4" fill="#2a221c"/>
    <circle cx="120" cy="105" r="2.4" fill="#2a221c"/>
    <circle cx="82" cy="103" r="1.4" fill="#fff"/>
    <circle cx="122" cy="103" r="1.4" fill="#fff"/>
    <path d="M71,101 q9,-5 18,0" fill="none" stroke="#3a2f28" stroke-width="2" stroke-linecap="round"/>
    <path d="M111,101 q9,-5 18,0" fill="none" stroke="#3a2f28" stroke-width="2" stroke-linecap="round"/>

    <!-- nariz -->
    <path d="M100,112 q4,8 -3,12" fill="none" stroke="${skinShade}" stroke-width="2.4" stroke-linecap="round"/>

    <!-- boca -->
    <path d="M88,134 q12,12 24,0" fill="none" stroke="${shade(blush,-40)}" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M90,135 q10,6 20,0 q-10,2 -20,0 Z" fill="${blush}"/>

    <!-- cabelo (frente) -->
    ${hairFront(o.hairStyle, o.hair)}

    <!-- acessório -->
    ${accessoryMarkup(o.accessory)}
  </svg>`;
}

function renderAvatar() {
  const svg = buildAvatarSVG(avatar);
  const mount = document.getElementById("avatar-mount");
  if (mount) mount.innerHTML = svg;
}

/* ---------- Tela 2: CAS ---------- */
function setupCAS() {
  const c = CONFIG.cas;

  buildColorSwatches("swatches-skin", c.skinColors, c.skinDefault, (v) => { avatar.skin = v; renderAvatar(); });
  buildColorSwatches("swatches-hair", c.hairColors, c.hairDefault, (v) => { avatar.hair = v; renderAvatar(); });
  buildColorSwatches("swatches-eyes", c.eyeColors, c.eyeDefault, (v) => { avatar.eyes = v; renderAvatar(); });
  buildColorSwatches("swatches-outfit", c.outfitColors, c.outfitDefault, (v) => { avatar.outfit = v; renderAvatar(); });

  buildChipSwatches("swatches-hairstyle",
    c.hairStyles.map((s) => ({ value: s.id, label: s.label })),
    c.hairStyleDefault, (v) => { avatar.hairStyle = v; renderAvatar(); });

  buildChipSwatches("swatches-accessory",
    c.accessories.map((a) => ({ value: a.emoji, label: a.emoji || "—" })),
    c.accessoryDefault, (v) => { avatar.accessory = v; renderAvatar(); });

  renderAvatar();

  document.getElementById("btn-cas-done").addEventListener("click", () => {
    document.getElementById("avatar-mount-reaction").innerHTML = buildAvatarSVG(avatar);
    goToScreen("screen-reaction");
  });
}

function buildColorSwatches(containerId, colors, defaultIdx, onSelect) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  colors.forEach((color, i) => {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "swatch" + (i === defaultIdx ? " selected" : "");
    sw.style.background = color;
    sw.addEventListener("click", () => {
      container.querySelectorAll(".swatch").forEach((el) => el.classList.remove("selected"));
      sw.classList.add("selected");
      onSelect(color);
    });
    container.appendChild(sw);
  });
}

function buildChipSwatches(containerId, items, defaultIdx, onSelect) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  items.forEach((item, i) => {
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "swatch-chip" + (i === defaultIdx ? " selected" : "");
    sw.textContent = item.label;
    sw.addEventListener("click", () => {
      container.querySelectorAll(".swatch-chip").forEach((el) => el.classList.remove("selected"));
      sw.classList.add("selected");
      onSelect(item.value);
    });
    container.appendChild(sw);
  });
}

/* ---------- Tela 3: Reação ---------- */
function setupReaction() {
  document.getElementById("btn-go-letter").addEventListener("click", () => {
    goToScreen("screen-letter");
  });
}

/* ---------- Tela 4: Carta ---------- */
function setupLetter() {
  const envelope = document.getElementById("envelope");
  const paper = document.getElementById("letter-paper");
  const hint = document.getElementById("letter-hint");
  const title = document.getElementById("letter-title");
  const textEl = document.getElementById("letter-text");
  const signEl = document.getElementById("letter-sign");
  const nextBtn = document.getElementById("btn-letter-next");

  let idx = 0;
  let typingTimeout;

  function typeParagraph() {
    const text = CONFIG.letterParagraphs[idx];
    textEl.textContent = "";
    textEl.classList.add("typing-cursor");
    nextBtn.classList.add("hidden");
    signEl.style.opacity = "0";

    let i = 0;
    clearTimeout(typingTimeout);
    (function typeChar() {
      if (i < text.length) {
        textEl.textContent += text.charAt(i++);
        typingTimeout = setTimeout(typeChar, 24);
      } else {
        textEl.classList.remove("typing-cursor");
        const last = idx === CONFIG.letterParagraphs.length - 1;
        if (last) { signEl.style.transition = "opacity .6s ease"; signEl.style.opacity = "1"; }
        nextBtn.textContent = last ? "Ir para o quarto" : "Continuar";
        nextBtn.classList.remove("hidden");
      }
    })();
  }

  envelope.addEventListener("click", () => {
    if (!paper.classList.contains("hidden")) return;
    paper.classList.remove("hidden");
    hint.classList.add("hidden");
    title.textContent = "Sua carta 💌";
    typeParagraph();
  });

  nextBtn.addEventListener("click", () => {
    if (idx < CONFIG.letterParagraphs.length - 1) { idx++; typeParagraph(); }
    else goToScreen("screen-room");
  });
}

/* ---------- Tela 5: Caça às cartinhas ---------- */
function setupRoom() {
  const counter = document.getElementById("found-counter");
  const modal = document.getElementById("card-modal");
  const modalTitle = document.getElementById("modal-title");
  const modalText = document.getElementById("modal-text");
  const modalClose = document.getElementById("btn-modal-close");

  const ids = Object.keys(CONFIG.hiddenCards);
  const total = ids.length;
  let found = 0;
  let allFound = false;

  counter.textContent = `0 de ${total} encontradas`;

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    const open = () => {
      if (el.classList.contains("found")) return;
      el.classList.add("found");
      found++;
      counter.textContent = `${found} de ${total} encontradas`;
      const card = CONFIG.hiddenCards[id];
      modalTitle.textContent = card.title;
      modalText.textContent = card.message;
      modal.classList.remove("hidden");
      allFound = found === total;
    };
    el.addEventListener("click", open);
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });

  modalClose.addEventListener("click", () => {
    modal.classList.add("hidden");
    if (allFound) goToScreen("screen-final");
  });
}

/* ---------- Tela 6: Final ---------- */
function setupFinal() {
  document.getElementById("btn-replay").addEventListener("click", () => location.reload());
}
