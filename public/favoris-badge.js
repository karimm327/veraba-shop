  ========================================================= */
(function () {
  const CLE = "vigoblue_favorites";
  const BADGES = ["real-favorite-count", "favorite-count"];
 
  function lire() {
    try { return JSON.parse(localStorage.getItem(CLE)) || []; } catch (e) { return []; }
  }
 
  let dernier = null;
  function maj() {
    const favoris = lire();
    const n = favoris.length;
 
    // 1. Chiffre sur le cœur (tous les badges de la page)
    BADGES.forEach(id => document.querySelectorAll('[id="' + id + '"]').forEach(b => {
      b.textContent = n;
      b.style.display = n > 0 ? "inline-block" : "none";
      if (dernier !== null && n > dernier && n > 0) {
        b.classList.remove("vb-pop"); void b.offsetWidth; b.classList.add("vb-pop");
      }
    }));
    dernier = n;
 
    // 2. Cœurs du même article synchronisés (s'il apparaît plusieurs fois sur la page)
    const ids = new Set(favoris.map(f => String(f.id)));
    document.querySelectorAll(".btn-favorite[data-id]").forEach(btn =>
      btn.classList.toggle("active", ids.has(btn.getAttribute("data-id"))));
  }
 
  // Petite animation quand le chiffre augmente
  const style = document.createElement("style");
  style.textContent = "@keyframes vbPop{0%{scale:1}40%{scale:1.45}100%{scale:1}}.vb-pop{animation:vbPop .35s ease}";
  document.head.appendChild(style);
 
  // Détecte chaque enregistrement des favoris dans cette page
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (cle) {
    setItem.apply(this, arguments);
    if (this === localStorage && cle === CLE) setTimeout(maj, 0);
  };
  const removeItem = Storage.prototype.removeItem;
  Storage.prototype.removeItem = function (cle) {
    removeItem.apply(this, arguments);
    if (this === localStorage && cle === CLE) setTimeout(maj, 0);
  };
 
  // Changement fait dans un autre onglet, ou retour arrière du navigateur
  window.addEventListener("storage", e => { if (e.key === CLE) maj(); });
  window.addEventListener("pageshow", maj);
 
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", maj);
  else maj();
 
  window.majBadgeFavoris = maj;
})();
