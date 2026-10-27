/* =========================================================
   Navigation PC style Zalando / ASOS : univers, compte, barre réduite au scroll
   ========================================================= */
(function () {
  const nav = document.querySelector(".vbnav");
  if (!nav) return;

  // 1. Univers (Femme / Homme / Enfants), mémorisé d'une page à l'autre
  const CLE_UNIVERS = "vbn_univers";
  const boutons = nav.querySelectorAll(".vbnav-univ button");

  function choisirUnivers(nom) {
    boutons.forEach(b => b.classList.toggle("active", b.dataset.univ === nom));
    const libelle = [...boutons].find(b => b.dataset.univ === nom)?.textContent.trim() || "";
    nav.querySelectorAll(".vbnav-univ-label").forEach(el => {
      el.textContent = libelle.charAt(0) + libelle.slice(1).toLowerCase();
    });
    try { localStorage.setItem(CLE_UNIVERS, nom); } catch (e) {}
  }

  let univers = "homme";
  try { univers = localStorage.getItem(CLE_UNIVERS) || univers; } catch (e) {}
  choisirUnivers(univers);
  boutons.forEach(b => b.addEventListener("click", () => choisirUnivers(b.dataset.univ)));

  // 2. Recherche : ouvre la fenêtre de recherche déjà présente sur la page
  nav.querySelectorAll(".vbnav-search, .vbnav-search-mini").forEach(btn => btn.addEventListener("click", () => {
    const overlay = document.getElementById("search-overlay");
    if (!overlay) { window.location.href = "shop.html"; return; }
    overlay.style.display = "flex";
    document.getElementById("overlay-search-input")?.focus();
  }));

  // 3. Compte : menu membre si l'utilisateur est connecté, sinon Se connecter / S'inscrire
  fetch("/user/me")
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      if (!data || !data.success) return;
      nav.classList.add("is-member");
      // Connecté : le logo ramène à l'accueil membre (site.html), sinon il reste sur index.html
      nav.querySelectorAll(".vbnav-logo, .vbnav-mini-logo").forEach(a => { a.href = "site.html"; });
    })
    .catch(() => {});

  // 4. En scrollant, la barre se réduit à une seule ligne (deux seuils pour éviter qu'elle clignote)
  let compact = false;
  function majCompact() {
    const y = window.scrollY;
    if (!compact && y > 200) compact = true;
    else if (compact && y < 40) compact = false;
    nav.classList.toggle("is-compact", compact);
  }
  window.addEventListener("scroll", majCompact, { passive: true });
  majCompact();

  // 5. Badges panier (barre PC + ancienne barre mobile) mis à jour en direct, comme les favoris
  const CLE_PANIER = "userCart";
  function majPanier() {
    let total = 0;
    try {
      const panier = JSON.parse(localStorage.getItem(CLE_PANIER)) || [];
      total = panier.reduce((somme, article) => somme + (Number(article.quantity) || 0), 0);
    } catch (e) {}
    document.querySelectorAll('[id="cart-count"], .cart-count-badge').forEach(badge => {
      badge.textContent = total;
      badge.style.display = total > 0 ? "inline-block" : "none";
    });
  }
  // Détecte chaque enregistrement du panier dans cette page (ajout, quantité, suppression)
  const setItemOrigine = Storage.prototype.setItem;
  Storage.prototype.setItem = function (cle) {
    setItemOrigine.apply(this, arguments);
    if (this === localStorage && cle === CLE_PANIER) setTimeout(majPanier, 0);
  };
  const removeItemOrigine = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function (cle) {
    removeItemOrigine.apply(this, arguments);
    if (this === localStorage && cle === CLE_PANIER) setTimeout(majPanier, 0);
  };
  // Panier changé dans un autre onglet, ou retour arrière du navigateur
  window.addEventListener("storage", e => { if (e.key === CLE_PANIER) majPanier(); });
  window.addEventListener("pageshow", majPanier);
  majPanier();

  // 6. Les badges de la barre réduite et de la barre mobile recopient ceux du haut (favoris, panier) dès qu'ils changent
  nav.querySelectorAll("[data-mirror]").forEach(copie => {
    const source = document.getElementById(copie.dataset.mirror);
    if (!source) return;
    const recopier = () => {
      copie.textContent = source.textContent;
      copie.style.display = source.style.display;
    };
    new MutationObserver(recopier).observe(source, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["style"] });
    recopier();
  });
})();
