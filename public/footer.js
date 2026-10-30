/* =========================================================
   Newsletter (enregistrement de l'e-mail) + rubriques du footer sur mobile
   ========================================================= */
(function () {
  // 1. Newsletter : envoie l'e-mail au serveur sans recharger la page
  const form = document.getElementById("vbfNewsForm");
  if (form) {
    const champ = form.querySelector("input");
    const bouton = form.querySelector("button");
    const message = document.getElementById("vbfNewsMsg");
    const afficher = (texte, ok) => {
      message.textContent = texte;
      message.className = "vbf-msg " + (ok ? "ok" : "err");
    };

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const email = champ.value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        afficher("Saisis une adresse e-mail valide.", false);
        champ.focus();
        return;
      }
      bouton.disabled = true;
      try {
        const res = await fetch("/newsletter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
          afficher("✓ Merci, tu es inscrit !", true);
          champ.value = "";
        } else {
          afficher(data.message || "Inscription impossible, réessaie.", false);
        }
      } catch (err) {
        afficher("Impossible de contacter le serveur, réessaie dans un instant.", false);
      }
      bouton.disabled = false;
    });
  }

  // 2. Footer sur mobile : chaque rubrique s'ouvre et se ferme au toucher
  document.querySelectorAll(".vbf-col-title").forEach(titre => {
    titre.addEventListener("click", () => {
      if (window.matchMedia("(min-width: 992px)").matches) return; // sur PC tout est déjà affiché
      const col = titre.closest(".vbf-col");
      const ouvert = col.classList.toggle("open");
      titre.setAttribute("aria-expanded", ouvert);
      titre.querySelector("span").textContent = ouvert ? "−" : "+";
    });
  });
})();
