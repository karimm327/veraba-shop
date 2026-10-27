/* =========================================================
   Menu mobile : catégories et sous-menus recopiés depuis la barre PC (.vbnav-cats),
   pour que les deux restent toujours identiques.
   ========================================================= */
(function () {
  const menu = document.getElementById("mobileMenu");
  if (!menu || !menu.classList.contains("vbm-menu")) return;

  const CLE_UNIVERS = "vbn_univers"; // même clé que la barre PC
  const chevron = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>';
  const panels = menu.querySelector(".vbm-panels");
  const principal = menu.querySelector(".vbm-main");
  const liste = menu.querySelector(".vbm-cats");

  // 1. Catégories et sous-menus construits à partir de la barre PC
  document.querySelectorAll(".vbnav-cats .vbnav-cat").forEach((cat, i) => {
    const lien = cat.querySelector(":scope > a");
    const badge = lien.querySelector("em");
    const nom = [...lien.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join("").trim();
    const mega = cat.querySelector(".vbnav-mega");
    const li = document.createElement("li");

    if (!mega) {
      // Pas de sous-menu (PROMOS) : simple lien
      li.innerHTML = `<a class="vbm-cat${cat.classList.contains("promo") ? " promo" : ""}" href="${lien.getAttribute("href")}"><span></span></a>`;
      li.querySelector("span").textContent = nom;
      liste.appendChild(li);
      return;
    }

    const id = "vbm-sub-" + i;
    li.innerHTML = `<button type="button" class="vbm-cat" data-open="${id}"><span></span>${chevron}</button>`;
    li.querySelector("span").textContent = nom;
    if (badge) li.querySelector("span").appendChild(badge.cloneNode(true));
    liste.appendChild(li);

    const sous = document.createElement("section");
    sous.className = "vbm-panel vbm-sub";
    sous.id = id;
    sous.setAttribute("aria-hidden", "true");
    sous.innerHTML = `
      <div class="vbm-head">
        <button type="button" class="vbm-back" data-back><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>Retour</button>
        <button type="button" class="vbm-icon" data-bs-dismiss="offcanvas" aria-label="Fermer le menu"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
      </div>
      <div class="vbm-body"><h2 class="vbm-sub-title"></h2></div>`;
    sous.querySelector(".vbm-sub-title").textContent = nom;
    const corps = sous.querySelector(".vbm-body");

    mega.querySelectorAll(".vbnav-col").forEach(col => {
      const groupe = document.createElement("div");
      groupe.className = "vbm-group";
      const titre = document.createElement("h4");
      titre.innerHTML = col.querySelector("h4").innerHTML; // garde le libellé de l'univers ("Vêtements Homme")
      groupe.appendChild(titre);
      col.querySelectorAll("a").forEach(a => {
        const lienSous = document.createElement("a");
        lienSous.href = a.getAttribute("href");
        if (a.classList.contains("red")) lienSous.className = "red";
        lienSous.innerHTML = `<span></span>${chevron}`;
        lienSous.querySelector("span").textContent = a.textContent.replace(/^→\s*/, "");
        groupe.appendChild(lienSous);
      });
      corps.appendChild(groupe);
    });
    panels.appendChild(sous);
  });

  // 2. Ouvrir / fermer un sous-menu (glissement)
  function fermerSousMenus() {
    menu.querySelectorAll(".vbm-sub.open").forEach(s => { s.classList.remove("open"); s.setAttribute("aria-hidden", "true"); });
    principal.classList.remove("behind");
  }
  menu.addEventListener("click", (e) => {
    const ouvrir = e.target.closest("[data-open]");
    if (ouvrir) {
      const sous = document.getElementById(ouvrir.dataset.open);
      sous.classList.add("open");
      sous.setAttribute("aria-hidden", "false");
      sous.scrollTop = 0;
      principal.classList.add("behind");
      return;
    }
    if (e.target.closest("[data-back]")) fermerSousMenus();
  });
  menu.addEventListener("hidden.bs.offcanvas", fermerSousMenus);

  // 3. Univers (Femme / Homme / Enfants), partagé avec la barre PC
  const boutons = menu.querySelectorAll(".vbm-univ button");
  function choisirUnivers(nom) {
    boutons.forEach(b => b.classList.toggle("active", b.dataset.univ === nom));
    const libelle = [...boutons].find(b => b.dataset.univ === nom)?.textContent.trim() || "";
    document.querySelectorAll(".vbnav-univ-label").forEach(el => {
      el.textContent = libelle.charAt(0) + libelle.slice(1).toLowerCase();
    });
    document.querySelectorAll(".vbnav-univ button").forEach(b => b.classList.toggle("active", b.dataset.univ === nom));
    try { localStorage.setItem(CLE_UNIVERS, nom); } catch (e) {}
  }
  let univers = "homme";
  try { univers = localStorage.getItem(CLE_UNIVERS) || univers; } catch (e) {}
  choisirUnivers(univers);
  boutons.forEach(b => b.addEventListener("click", () => choisirUnivers(b.dataset.univ)));

  // 4. Recherche : ferme le menu et ouvre la fenêtre de recherche de la page
  menu.querySelectorAll(".vbm-search").forEach(btn => btn.addEventListener("click", () => {
    const overlay = document.getElementById("search-overlay");
    if (!overlay) { window.location.href = "shop.html"; return; }
    if (typeof bootstrap !== "undefined") bootstrap.Offcanvas.getInstance(menu)?.hide();
    overlay.style.display = "flex";
    document.getElementById("overlay-search-input")?.focus();
  }));

  // 5. Connecté : menu membre, logo vers site.html
  fetch("/user/me")
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      if (!data || !data.success) return;
      menu.classList.add("is-member");
      menu.querySelectorAll(".vbm-logo").forEach(a => { a.href = "site.html"; });
    })
    .catch(() => {});

  // 6. Badges favoris / panier du menu : recopient ceux de la barre PC dès qu'ils changent
  menu.querySelectorAll("[data-mirror]").forEach(copie => {
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

/* =========================================================
   Panneau "Mon compte" mobile (#accountMenu) : visiteur ou membre, dernière commande
   ========================================================= */
(function () {
  const panneau = document.getElementById("accountMenu");
  if (!panneau || !panneau.classList.contains("vba")) return;

  const STATUTS = { payee: "Payée", preparee: "En préparation", expediee: "Expédiée", livree: "Livrée", annulee: "Annulée" };

  fetch("/user/me")
    .then(res => res.ok ? res.json() : null)
    .then(data => {
      if (!data || !data.success) return;
      panneau.classList.add("is-member");
      panneau.querySelector(".vba-name").textContent = [data.user.prenom, data.user.nom].filter(Boolean).join(" ");
      panneau.querySelector(".vba-email").textContent = data.user.email || "";
      panneau.querySelectorAll(".vbm-logo").forEach(a => { a.href = "site.html"; });

      // Dernière commande (affichée seulement s'il y en a une)
      return fetch("/api/commandes")
        .then(res => res.ok ? res.json() : null)
        .then(cmd => {
          const derniere = cmd && cmd.success && cmd.commandes[0];
          if (!derniere) return;
          const statut = STATUTS[derniere.statut] || derniere.statut || "";
          panneau.querySelector(".vba-last-txt").textContent = `N° ${derniere.numero}${statut ? " · " + statut : ""}`;
          panneau.querySelector(".vba-last").hidden = false;
        });
    })
    .catch(() => {});

  // Badge favoris : recopie celui de la barre PC dès qu'il change
  panneau.querySelectorAll("[data-mirror]").forEach(copie => {
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
