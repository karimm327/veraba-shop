/* =====================================================================
   Notifications VigoBlue – remplace les alert() gris du navigateur
   notif("Message")                      -> succès
   notif("Message", "erreur")            -> erreur
   notif("Message", "info")              -> information
   notif("Message", "succes", "Titre")   -> avec un titre personnalisé
   ===================================================================== */
(function () {
  const LOGO = "logop.png";
  const TITRES = { succes: "C'est fait !", erreur: "Oups…", info: "Information" };
  const DUREE = { succes: 4000, erreur: 6000, info: 5000 };

  const css = `
  .vbn-zone{position:fixed;top:18px;right:18px;z-index:99999;display:flex;flex-direction:column;
    gap:12px;width:min(380px,calc(100vw - 32px));pointer-events:none}
  @media (max-width:576px){.vbn-zone{top:12px;right:50%;transform:translateX(50%)}}

  .vbn{--accent:#1f9d74;position:relative;pointer-events:auto;display:flex;align-items:center;gap:14px;
    background:#fff;color:#111;border:1px solid #111;padding:14px 16px 16px 14px;overflow:hidden;
    font-family:inherit;box-shadow:0 18px 40px -12px rgba(0,0,0,.35);
    transform:translateY(-24px) scale(.96);opacity:0;
    transition:transform .45s cubic-bezier(.2,1.4,.4,1),opacity .3s ease}
  .vbn.in{transform:none;opacity:1}
  .vbn.out{transform:translateX(120%);opacity:0;transition:transform .35s ease-in,opacity .3s ease-in}
  .vbn.erreur{--accent:#d93025}
  .vbn.info{--accent:#111}
  .vbn.erreur.in{animation:vbn-shake .45s .35s}

  .vbn-logo{flex-shrink:0;width:46px;height:46px;border:1px solid #e5e5e5;background:#fff url(${LOGO}) center 42%/175% no-repeat}

  .vbn-txt{flex:1;min-width:0}
  .vbn-titre{font-weight:800;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;margin:0 0 2px}
  .vbn-msg{font-size:.88rem;line-height:1.35;color:#444;margin:0;word-wrap:break-word}

  .vbn-ico{flex-shrink:0;width:34px;height:34px}
  .vbn-ico circle{fill:none;stroke:var(--accent);stroke-width:2.5;stroke-dasharray:101;stroke-dashoffset:101;
    animation:vbn-draw .5s .15s ease-out forwards}
  .vbn-ico path{fill:none;stroke:var(--accent);stroke-width:3;stroke-linecap:round;stroke-linejoin:round;
    stroke-dasharray:30;stroke-dashoffset:30;animation:vbn-draw .35s .55s ease-out forwards}
  .vbn-ico .fond{fill:var(--accent);opacity:0;transform-origin:center;animation:vbn-pop .4s .5s ease-out forwards}

  .vbn-x{position:absolute;top:6px;right:8px;background:none;border:0;padding:2px 4px;font-size:1rem;
    line-height:1;color:#999;cursor:pointer}
  .vbn-x:hover{color:#111}

  .vbn-barre{position:absolute;left:0;bottom:0;height:3px;width:100%;background:var(--accent);
    transform-origin:left;animation:vbn-barre linear forwards}
  .vbn:hover .vbn-barre{animation-play-state:paused}

  .vbc-fond{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);display:flex;align-items:center;
    justify-content:center;padding:16px;opacity:0;transition:opacity .2s ease}
  .vbc-fond.in{opacity:1}
  .vbc{background:#fff;color:#111;border:1px solid #111;width:min(400px,100%);padding:26px 24px 22px;text-align:center;
    box-shadow:0 24px 60px -16px rgba(0,0,0,.5);transform:translateY(16px) scale(.97);
    transition:transform .35s cubic-bezier(.2,1.3,.4,1)}
  .vbc-fond.in .vbc{transform:none}
  .vbc-logo{width:64px;height:64px;margin:0 auto 12px;background:url(${LOGO}) center 42%/175% no-repeat}
  .vbc-titre{font-weight:800;font-size:.85rem;letter-spacing:.08em;text-transform:uppercase;margin:0 0 6px}
  .vbc-msg{font-size:.92rem;color:#444;margin:0 0 20px;line-height:1.4}
  .vbc-btns{display:flex;gap:10px}
  .vbc-btns button{flex:1;padding:12px 10px;font-size:.78rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;
    border:1px solid #111;cursor:pointer;transition:background .15s,color .15s}
  .vbc-non{background:#fff;color:#111}
  .vbc-non:hover{background:#f2f2f2}
  .vbc-oui{background:#111;color:#fff}
  .vbc-oui:hover{background:#333}
  .vbc-oui.danger{background:#d93025;border-color:#d93025}
  .vbc-oui.danger:hover{background:#b3261e}
  @keyframes vbn-draw{to{stroke-dashoffset:0}}
  @keyframes vbn-pop{0%{opacity:0;transform:scale(.4)}60%{opacity:.14;transform:scale(1.15)}100%{opacity:.1;transform:scale(1)}}
  @keyframes vbn-barre{from{transform:scaleX(1)}to{transform:scaleX(0)}}
  @keyframes vbn-shake{0%,100%{transform:none}20%{transform:translateX(-7px)}40%{transform:translateX(6px)}
    60%{transform:translateX(-4px)}80%{transform:translateX(2px)}}
  @media (prefers-reduced-motion:reduce){.vbn,.vbn *{animation:none!important;transition:opacity .2s!important}
    .vbn-ico circle,.vbn-ico path{stroke-dashoffset:0}}`;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const ICONES = {
    succes: '<circle class="fond" cx="17" cy="17" r="16"/><circle cx="17" cy="17" r="16"/><path d="M10 17.5l4.5 4.5L24 12.5"/>',
    erreur: '<circle class="fond" cx="17" cy="17" r="16"/><circle cx="17" cy="17" r="16"/><path d="M12 12l10 10M22 12L12 22"/>',
    info:   '<circle class="fond" cx="17" cy="17" r="16"/><circle cx="17" cy="17" r="16"/><path d="M17 15.5v8M17 11v.5"/>'
  };

  let zone = null;

  window.notif = function (message, type, titre, image) {
    type = type === "erreur" || type === "info" ? type : "succes";
    if (!zone) {
      zone = document.createElement("div");
      zone.className = "vbn-zone";
      zone.setAttribute("aria-live", "polite");
      document.body.appendChild(zone);
    }

    const el = document.createElement("div");
    el.className = "vbn " + type;
    el.setAttribute("role", type === "erreur" ? "alert" : "status");
    el.innerHTML =
      '<div class="vbn-logo" aria-hidden="true"></div>' +
      '<div class="vbn-txt"><p class="vbn-titre"></p><p class="vbn-msg"></p></div>' +
      '<svg class="vbn-ico" viewBox="0 0 34 34" aria-hidden="true">' + ICONES[type] + "</svg>" +
      '<button class="vbn-x" aria-label="Fermer">×</button>' +
      '<div class="vbn-barre"></div>';
    if (image) {
      const logo = el.querySelector(".vbn-logo");
      logo.style.backgroundImage = "url('" + String(image).replace(/'/g, "%27") + "')";
      logo.style.backgroundSize = "cover";
      logo.style.backgroundPosition = "center";
    }
    el.querySelector(".vbn-titre").textContent = titre || TITRES[type];
    el.querySelector(".vbn-msg").textContent = message;
    el.querySelector(".vbn-barre").style.animationDuration = DUREE[type] + "ms";

    zone.prepend(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add("in")));

    let fini = false;
    const fermer = () => {
      if (fini) return;
      fini = true;
      el.classList.add("out");
      setTimeout(() => el.remove(), 380);
    };
    el.querySelector(".vbn-x").addEventListener("click", fermer);
    el.querySelector(".vbn-barre").addEventListener("animationend", fermer); // se ferme à la fin de la barre (pause au survol)
  };

  /* Fenêtre de confirmation stylée (remplace confirm())
     if (!(await confirmer("Supprimer cette adresse ?", { titre: "Supprimer", bouton: "Supprimer", danger: true }))) return; */
  window.confirmer = function (message, options) {
    options = options || {};
    return new Promise(resolve => {
      const fond = document.createElement("div");
      fond.className = "vbc-fond";
      fond.innerHTML =
        '<div class="vbc" role="dialog" aria-modal="true">' +
        '<div class="vbc-logo" aria-hidden="true"></div>' +
        '<p class="vbc-titre"></p><p class="vbc-msg"></p>' +
        '<div class="vbc-btns"><button class="vbc-non" type="button"></button><button class="vbc-oui" type="button"></button></div></div>';
      fond.querySelector(".vbc-titre").textContent = options.titre || "Confirmation";
      fond.querySelector(".vbc-msg").textContent = message;
      fond.querySelector(".vbc-non").textContent = options.annuler || "Annuler";
      const oui = fond.querySelector(".vbc-oui");
      oui.textContent = options.bouton || "Confirmer";
      if (options.danger) oui.classList.add("danger");
      document.body.appendChild(fond);
      requestAnimationFrame(() => requestAnimationFrame(() => fond.classList.add("in")));
      oui.focus();

      const fin = reponse => {
        document.removeEventListener("keydown", clavier);
        fond.classList.remove("in");
        setTimeout(() => fond.remove(), 220);
        resolve(reponse);
      };
      const clavier = e => { if (e.key === "Escape") fin(false); if (e.key === "Enter") fin(true); };
      document.addEventListener("keydown", clavier);
      oui.addEventListener("click", () => fin(true));
      fond.querySelector(".vbc-non").addEventListener("click", () => fin(false));
      fond.addEventListener("click", e => { if (e.target === fond) fin(false); });
    });
  };
})();
