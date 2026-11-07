/* =========================================================
   Consentement cookies : bandeau, réglages, « Gérer les cookies » dans le footer.
   Le choix est gardé dans localStorage("cookies") : { necessary, analytics, marketing, date }
   Pour savoir si un service est autorisé : window.vbCookies.accepte("analytics")
   ========================================================= */
(function () {
  const CLE = "cookies";
  const DUREE = 1000 * 60 * 60 * 24 * 180; // on redemande au bout de 6 mois (recommandation CNIL)

  function lire() {
    try {
      const c = JSON.parse(localStorage.getItem(CLE));
      if (!c || (c.date && Date.now() - c.date > DUREE)) return null;
      return c;
    } catch (e) { return null; }
  }
  function enregistrer(analytics, marketing) {
    try { localStorage.setItem(CLE, JSON.stringify({ necessary: true, analytics, marketing, date: Date.now() })); } catch (e) {}
    cacherBandeau();
    fermerReglages();
  }

  const html = `
    <div class="vbc-banner" id="vbcBanner" role="dialog" aria-labelledby="vbcTitre" aria-live="polite" hidden>
      <h2 id="vbcTitre">🍪 On respecte ta vie privée</h2>
      <p>On utilise des cookies nécessaires au fonctionnement du site (connexion, panier). Avec ton accord, on peut aussi mesurer l'audience et te proposer des offres adaptées.
        <a href="confidentialite.html#s7">En savoir plus</a></p>
      <div class="vbc-actions">
        <button type="button" class="vbc-btn" data-vbc="refuser">Tout refuser</button>
        <button type="button" class="vbc-btn dark" data-vbc="accepter">Tout accepter</button>
      </div>
      <button type="button" class="vbc-link" data-vbc="reglages">Personnaliser</button>
    </div>
    <div class="vbc-modal" id="vbcModal" role="dialog" aria-modal="true" aria-labelledby="vbcTitre2">
      <div class="vbc-box">
        <div class="vbc-box-head"><h2 id="vbcTitre2">Gérer les cookies</h2><button type="button" class="vbc-close" data-vbc="fermer" aria-label="Fermer">×</button></div>
        <p class="vbc-intro">Choisis les cookies que tu acceptes. Tu peux changer d'avis à tout moment avec le lien « Gérer les cookies » en bas du site.</p>
        <div class="vbc-cat">
          <div class="vbc-cat-head"><b>Nécessaires</b><span class="vbc-always">Toujours actifs</span></div>
          <p>Indispensables au site : connexion à ton compte, panier, favoris, sécurité du paiement.</p>
        </div>
        <div class="vbc-cat">
          <div class="vbc-cat-head"><b>Mesure d'audience</b><label class="vbc-switch"><input type="checkbox" id="vbcAnalytics" aria-label="Mesure d'audience"><span></span></label></div>
          <p>Nous aident à comprendre comment le site est utilisé, pour l'améliorer.</p>
        </div>
        <div class="vbc-cat">
          <div class="vbc-cat-head"><b>Marketing</b><label class="vbc-switch"><input type="checkbox" id="vbcMarketing" aria-label="Marketing"><span></span></label></div>
          <p>Permettent de te montrer des offres et des produits adaptés à tes goûts.</p>
        </div>
        <div class="vbc-actions">
          <button type="button" class="vbc-btn" data-vbc="refuser">Tout refuser</button>
          <button type="button" class="vbc-btn dark" data-vbc="enregistrer">Enregistrer mes choix</button>
        </div>
      </div>
    </div>`;
  document.body.insertAdjacentHTML("beforeend", html);

  const bandeau = document.getElementById("vbcBanner");
  const modal = document.getElementById("vbcModal");

  function montrerBandeau() { bandeau.hidden = false; requestAnimationFrame(() => bandeau.classList.add("show")); }
  function cacherBandeau() { bandeau.classList.remove("show"); setTimeout(() => { bandeau.hidden = true; }, 300); }
  function ouvrirReglages() {
    const c = lire() || {};
    document.getElementById("vbcAnalytics").checked = !!c.analytics;
    document.getElementById("vbcMarketing").checked = !!c.marketing;
    modal.classList.add("show");
  }
  function fermerReglages() { modal.classList.remove("show"); }

  document.addEventListener("click", (e) => {
    const action = e.target.closest("[data-vbc], [data-cookies-open]");
    if (!action) {
      if (e.target === modal) fermerReglages(); // clic à côté du panneau
      return;
    }
    if (action.hasAttribute("data-cookies-open")) { e.preventDefault(); ouvrirReglages(); return; }
    const a = action.dataset.vbc;
    if (a === "accepter") enregistrer(true, true);
    else if (a === "refuser") enregistrer(false, false);
    else if (a === "reglages") ouvrirReglages();
    else if (a === "fermer") fermerReglages();
    else if (a === "enregistrer") enregistrer(document.getElementById("vbcAnalytics").checked, document.getElementById("vbcMarketing").checked);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") fermerReglages(); });

  if (!lire()) setTimeout(montrerBandeau, 600);

  window.vbCookies = { ouvrir: ouvrirReglages, accepte: type => !!(lire() || {})[type] };
})();
