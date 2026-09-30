import express from "express"; // express + node.js pour créer le serveur
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session"; // sessions enregistrées dans MySQL
import mysql from "mysql2"; // base de données
import path from "path"; // chemins de fichiers
import crypto from "crypto"; // génération de jetons (mot de passe oublié)
import { fileURLToPath } from "url";
import Stripe from "stripe"; // moyen de paiement
import bcrypt from "bcryptjs"; // hachage des mots de passe (100 % JavaScript, rien à compiler)
import dotenv from "dotenv";
// import nodemailer from "nodemailer"; // envoi d'emails : désactivé (projet local, pas de domaine)
 
dotenv.config(); // lit le fichier .env (toutes les clés secrètes sont là-bas)
 
const app = express();
const port = process.env.PORT || 3000; // port sur lequel écoute le serveur
 
// ---------------------- Connexion MySQL ---------------------- //
// Un "pool" rouvre tout seul les connexions coupées (indispensable une fois hébergé)
const db = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME || "VigoBlue",
  port: Number(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 5,
  enableKeepAlive: true,
  // Base en ligne (Aiven...) : connexion chiffrée. En local, laisse DB_SSL vide.
  ssl: process.env.DB_SSL === "true"
    ? (process.env.DB_CA_CERT ? { ca: process.env.DB_CA_CERT.replace(/\\n/g, "\n") } : { rejectUnauthorized: false })
    : undefined,
});
 
db.getConnection((err, conn) => {
  if (err) return console.error("❌ MySQL:", err.message);
  console.log("✅ Connecté à MySQL");
  conn.release();
 
  // Table des commandes : créée automatiquement si elle n'existe pas encore
  db.query(`CREATE TABLE IF NOT EXISTS commandes (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    numero VARCHAR(20),
    stripe_payment_intent_id VARCHAR(255),
    total INT NOT NULL,
    statut VARCHAR(30) DEFAULT 'payee',
    articles TEXT,
    livraison TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_commandes_user (user_id)
  )`, e => {
    if (e) return console.error("❌ Table commandes :", e.message);
    // Tables créées avant l'ajout de l'adresse : on ajoute la colonne (erreur 1060 = elle existe déjà)
    db.query("ALTER TABLE commandes ADD COLUMN livraison TEXT", e2 => {
      if (e2 && e2.errno !== 1060) console.error("❌ Colonne livraison :", e2.message);
    });
  });
 
  // Consentements RGPD : date d'acceptation des CGU + choix newsletter (erreur 1060 = colonne déjà là)
  db.query("ALTER TABLE users ADD COLUMN cgu_acceptees_le DATETIME NULL", e => {
    if (e && e.errno !== 1060) console.error("❌ Colonne cgu_acceptees_le :", e.message);
  });
  db.query("ALTER TABLE users ADD COLUMN newsletter TINYINT(1) NOT NULL DEFAULT 0", e => {
    if (e && e.errno !== 1060) console.error("❌ Colonne newsletter :", e.message);
  });
 
  // Cartes que le client a CHOISI d'enregistrer dans son portefeuille
  db.query(`CREATE TABLE IF NOT EXISTS cartes_enregistrees (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    pm_id VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_cartes_user (user_id)
  )`, e => { if (e) console.error("❌ Table cartes_enregistrees :", e.message); });
 
  // Table des messages envoyés depuis la page Aide
  db.query(`CREATE TABLE IF NOT EXISTS messages_support (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NULL,
    nom VARCHAR(100) NOT NULL,
    email VARCHAR(255) NOT NULL,
    sujet VARCHAR(50),
    message TEXT NOT NULL,
    traite TINYINT(1) DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, e => { if (e) console.error("❌ Table messages_support :", e.message); });
});
 
// Vérifie et nettoie l'adresse de livraison envoyée par la page paiement
function nettoyerLivraison(l) {
  if (!l || typeof l !== "object") return null;
  const t = (v, max) => String(v ?? "").trim().slice(0, max);
  const a = {
    prenom: t(l.prenom, 100), nom: t(l.nom, 100), adresse: t(l.adresse, 255),
    code_postal: t(l.code_postal, 10), ville: t(l.ville, 100), pays: t(l.pays, 100) || "France", telephone: t(l.telephone, 30)
  };
  if (!a.prenom || !a.nom || a.adresse.length < 5 || !a.code_postal || !a.ville || !a.telephone) return null;
  if (a.pays === "France" && !/^\d{5}$/.test(a.code_postal)) return null;
  return a;
}
 
// Nettoie la liste d'articles envoyée par la page paiement avant de l'enregistrer
function nettoyerArticles(items) {
  if (!Array.isArray(items)) return [];
  const texte = (v, max) => String(v ?? "").slice(0, max);
  return items.slice(0, 50).map(i => {
    let image = texte(i.image, 500);
    try { if (/^https?:\/\//.test(image)) image = new URL(image).pathname; } catch (e) { image = ""; }
    return {
      ref: texte(i.ref || i.name || "Article", 150),
      taille: texte(i.size || i.taille, 20),
      couleur: texte(i.color || i.couleur, 50),
      prix: Math.max(0, Number(i.price) || 0),
      quantite: Math.max(1, Math.min(99, parseInt(i.quantity) || 1)),
      image
    };
  });
}
 
// ---------------------- Stripe (clé secrète dans .env) ---------------------- //
const stripe = process.env.STRIPE_SECRET ? new Stripe(process.env.STRIPE_SECRET) : null;
if (!stripe) console.warn("⚠️  STRIPE_SECRET absent du .env : le paiement est désactivé.");
 
// ---------------------- Middlewares ---------------------- //
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// En ligne (Render), le site est derrière un proxy HTTPS
const EN_LIGNE = process.env.NODE_ENV === "production";
if (EN_LIGNE) app.set("trust proxy", 1);
 
// Les sessions sont gardées dans MySQL : les clients restent connectés même si le serveur redémarre
const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({ clearExpired: true }, db);
 
app.use(session({
  secret: process.env.SESSION_SECRET || "change-moi-dans-le-fichier-env",
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: EN_LIGNE,          // cookie envoyé seulement en HTTPS une fois en ligne
    sameSite: "lax",
    maxAge: 1000 * 60 * 60 * 24 // session valable 24 h
  }
}));
 
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, "public");
 
// ---------------------- Fonctions utilitaires ---------------------- //
function validatePassword(password) {
  const regex = /^(?=.*[A-Z])(?=(?:.*\d){3,})(?=.*[!@#$%^&*()_+=[\]{};':"\\|,.<>/?]).{8,}$/;
  return regex.test(password);
}
 
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
 
// Nom de la page demandée, sans "/" ni ".html"  ("/site.html" et "/site" -> "site")
function pageName(urlPath) {
  return urlPath.replace(/^\/+/, "").replace(/\.html$/, "").toLowerCase();
}
 
// ---------------------- Protection des pages ---------------------- //
// Pages réservées aux membres connectés
const PAGES_MEMBRES = ["site", "compte", "adresses", "commandes", "paiement", "paie", "portefeuille"];
// Pages inutiles quand on est déjà connecté (on renvoie vers l'espace membre)
const PAGES_VISITEURS = ["", "index", "login", "signup"];
 
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  const page = pageName(req.path);
  const connecte = Boolean(req.session.userId);
 
  if (PAGES_MEMBRES.includes(page) && !connecte) return res.redirect("/login.html");
  if (PAGES_VISITEURS.includes(page) && connecte) return res.redirect("/site.html");
  next();
});
 
// ---------------------- Pages ---------------------- //
app.get("/", (req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));
 
// Page de "réveil" : un service de ping l'appelle toutes les 10 min pour éviter la mise en veille
// (elle interroge aussi la base, ce qui garde Aiven actif)
app.get("/health", (req, res) => {
  db.query("SELECT 1", err => res.status(err ? 500 : 200).send(err ? "db error" : "ok"));
});
 
// Le bouton "Voir la boutique" pointe vers shop.html, qui n'existe pas : on renvoie vers l'accueil
app.get(["/shop", "/shop.html"], (req, res) => {
  res.redirect(req.session.userId ? "/site.html" : "/index.html");
});
 
// Fichiers du site (HTML, CSS, images...). "/site" fonctionne comme "/site.html".
app.use(express.static(PUBLIC_DIR, { index: false, extensions: ["html"] }));
 
// ---------------------- Inscription (sans code de vérification) ---------------------- //
app.post("/register", async (req, res) => {
  const { email, password, nom, prenom, jour, mois, annee, cgu, newsletter } = req.body;
 
  if (!email || !password || !nom || !prenom) {
    return res.status(400).json({ success: false, message: "Tous les champs sont requis" });
  }
  if (cgu !== true) {
    return res.status(400).json({ success: false, message: "Tu dois accepter les Conditions générales et la Politique de confidentialité." });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, message: "Adresse email invalide" });
  }
  if (!validatePassword(password)) {
    return res.status(400).json({ success: false, message: "Mot de passe invalide : minimum 8 caractères, 1 majuscule, 3 chiffres, 1 symbole" });
  }
 
  try {
    const [existing] = await db.promise().query("SELECT id FROM users WHERE email = ?", [email]);
    if (existing.length > 0) return res.status(400).json({ success: false, message: "Email déjà utilisé" });
 
    // Client Stripe (facultatif : si Stripe ne répond pas, l'inscription fonctionne quand même)
    let stripeCustomerId = null;
    if (stripe) {
      try {
        const customer = await stripe.customers.create({ email });
        stripeCustomerId = customer.id;
      } catch (e) {
        console.warn("⚠️  Client Stripe non créé :", e.message);
      }
    }
 
    const hashedPassword = await bcrypt.hash(password, 10);
 
    await db.promise().query(
      "INSERT INTO users (email, password, nom, prenom, jour_naissance, mois_naissance, annee_naissance, stripe_customer_id, cgu_acceptees_le, newsletter) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)",
      [email, hashedPassword, nom, prenom, parseInt(jour) || null, parseInt(mois) || null, parseInt(annee) || null, stripeCustomerId, newsletter === true ? 1 : 0]
    );
 
    // --- Email de bienvenue : désactivé (projet local, pas de domaine) ---
    // Pour le réactiver : npm install nodemailer, décommenter l'import en haut du fichier
    // et ce bloc, puis ajouter EMAIL_USER et EMAIL_PASS dans le fichier .env
    //
    // const transporter = nodemailer.createTransport({
    //   service: "gmail",
    //   auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS }
    // });
    // await transporter.sendMail({
    //   from: process.env.EMAIL_USER,
    //   to: email,
    //   subject: "Bienvenue sur VigoBlue !",
    //   html: `<div style="text-align:center;">
    //     <h2>Bienvenue sur VigoBlue</h2>
    //     <p>Bonjour ${nom}, votre inscription est réussie !</p>
    //     <p>Vous pouvez maintenant continuer votre shopping.</p>
    //   </div>`
    // });
 
    res.json({ success: true, message: "Inscription réussie ! Vous pouvez vous connecter.", redirect: "/login.html" });
  } catch (err) {
    console.error("Erreur /register :", err);
    res.status(500).json({ success: false, message: "Erreur serveur : " + err.message });
  }
});
 
// ---------------------- Connexion / Déconnexion ---------------------- //
app.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ success: false, message: "Email et mot de passe requis" });
 
  db.query("SELECT * FROM users WHERE email = ?", [email], async (err, results) => {
    if (err) return res.status(500).json({ success: false, message: "Erreur serveur" });
 
    const user = results[0];
    const match = user ? await bcrypt.compare(password, user.password) : false;
    if (!match) return res.status(401).json({ success: false, message: "Email ou mot de passe incorrect" });
 
    req.session.userId = user.id;
    res.json({ success: true, redirect: "/site.html" });
  });
});
 
app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/index.html");
  });
});
 
// ---------------------- Mot de passe oublié (mode local : pas d'email) ---------------------- //
// Le lien de réinitialisation est affiché dans le terminal du serveur au lieu d'être envoyé par mail.
app.post("/send-reset-mail", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).send("Email requis");
 
  try {
    const [users] = await db.promise().query("SELECT id FROM users WHERE email = ?", [email]);
    if (users.length > 0) {
      const token = crypto.randomBytes(32).toString("hex");
      const expire = Date.now() + 15 * 60 * 1000; // 15 minutes
      await db.promise().query("UPDATE users SET reset_token = ?, reset_token_exp = ? WHERE id = ?", [token, expire, users[0].id]);
 
      const lien = `${process.env.SITE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${port}`}/reset-password.html?token=${token}&email=${encodeURIComponent(email)}`;
      console.log(`🔑 Lien de réinitialisation pour ${email} :\n   ${lien}`);
    }
    // Même réponse que le compte existe ou non (on ne révèle pas quels emails sont inscrits)
    res.send("Si ce compte existe, un lien de réinitialisation a été généré (mode local : voir le terminal du serveur).");
  } catch (err) {
    console.error("Erreur /send-reset-mail :", err);
    res.status(500).send("Erreur serveur");
  }
});
 
app.post("/reset-password", async (req, res) => {
  const { email, token, newPassword } = req.body;
  if (!email || !token || !newPassword) return res.status(400).json({ success: false, message: "Lien invalide" });
  if (!validatePassword(newPassword)) {
    return res.status(400).json({ success: false, message: "Mot de passe invalide : minimum 8 caractères, 1 majuscule, 3 chiffres, 1 symbole" });
  }
 
  try {
    const [users] = await db.promise().query(
      "SELECT id FROM users WHERE email = ? AND reset_token = ? AND reset_token_exp > ?",
      [email, token, Date.now()]
    );
    if (users.length === 0) return res.status(400).json({ success: false, message: "Lien invalide ou expiré" });
 
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await db.promise().query(
      "UPDATE users SET password = ?, reset_token = NULL, reset_token_exp = NULL WHERE id = ?",
      [hashedPassword, users[0].id]
    );
    res.json({ success: true, message: "Mot de passe modifié ! Vous pouvez vous connecter." });
  } catch (err) {
    console.error("Erreur /reset-password :", err);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
});
 
// ---------------------- Utilisateur connecté ---------------------- //
app.get("/user/me", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false, message: "Non connecté" });
 
  db.query(
    "SELECT id, email, nom, prenom, jour_naissance, mois_naissance, annee_naissance, stripe_customer_id FROM users WHERE id = ?",
    [req.session.userId],
    (err, results) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      if (results.length === 0) return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
      res.json({ success: true, user: results[0] });
    }
  );
});
 
// ---------------------- Adresses ---------------------- //
function saveAddress(req, res) {
  if (!req.session.userId) return res.status(401).json({ success: false, message: "Non connecté" });
 
  const { adresse, code_postal, ville, pays, telephone } = req.body;
  const userId = req.session.userId;
 
  // Tous les champs vides = suppression de l'adresse (bouton "Supprimer")
  const vide = [adresse, code_postal, ville, pays, telephone].every(v => !v || !String(v).trim());
  if (vide) {
    db.query("DELETE FROM adresses WHERE user_id = ?", [userId], err => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      res.json({ success: true, message: "Adresse supprimée" });
    });
    return;
  }
 
  db.query("SELECT id FROM adresses WHERE user_id = ?", [userId], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
 
    if (results.length > 0) {
      db.query(
        "UPDATE adresses SET adresse = ?, code_postal = ?, ville = ?, pays = ?, telephone = ? WHERE user_id = ?",
        [adresse, code_postal, ville, pays, telephone, userId],
        err2 => {
          if (err2) return res.status(500).json({ success: false, message: err2.message });
          res.json({ success: true, message: "Adresse mise à jour avec succès !" });
        }
      );
    } else {
      db.query(
        "INSERT INTO adresses (user_id, adresse, code_postal, ville, pays, telephone) VALUES (?, ?, ?, ?, ?, ?)",
        [userId, adresse, code_postal, ville, pays, telephone],
        err2 => {
          if (err2) return res.status(500).json({ success: false, message: err2.message });
          res.json({ success: true, message: "Adresse enregistrée avec succès !" });
        }
      );
    }
  });
}
app.post("/user/address/save", saveAddress);
app.post("/user/address/update", saveAddress);
 
app.get("/user/address", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ success: false, message: "Non connecté" });
 
  db.query("SELECT * FROM adresses WHERE user_id = ? LIMIT 1", [req.session.userId], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.json({ success: true, address: results[0] || null });
  });
});
 
// ---------------------- Produits ---------------------- //
app.get("/products", (req, res) => {
  db.query("SELECT * FROM products", (err, results) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.json({ success: true, products: results });
  });
});
 
app.get("/products/:id", (req, res) => {
  const productId = req.params.id;
 
  db.query("SELECT * FROM products WHERE id = ?", [productId], (err, products) => {
    if (err) return res.status(500).json({ success: false, message: "Erreur MySQL" });
    if (products.length === 0) return res.status(404).json({ success: false, message: "Produit introuvable" });
 
    db.query("SELECT * FROM product_variants WHERE product_id = ?", [productId], (err2, variants) => {
      if (err2) return res.status(500).json({ success: false, message: "Erreur variantes" });
      res.json({ success: true, product: products[0], variants });
    });
  });
});
 
// ---------------------- Panier (côté serveur) ---------------------- //
app.get("/cart", (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Non connecté" });
 
  db.query("SELECT * FROM cart_items WHERE user_id = ?", [userId], (err, results) => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.json({ success: true, cart: results });
  });
});
 
app.post("/cart/add", (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Non connecté" });
 
  const { ref, color, size, taille, price, quantity, image } = req.body;
  const productSize = size || taille || "Non spécifiée";
  const productColor = color || "Non spécifiée";
 
  if (!ref || !price || !quantity) return res.status(400).json({ success: false, message: "Données manquantes" });
 
  db.query(
    "SELECT id, quantity FROM cart_items WHERE user_id = ? AND ref = ? AND color = ? AND taille = ?",
    [userId, ref, productColor, productSize],
    (err, results) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
 
      if (results.length > 0) {
        const newQty = results[0].quantity + Number(quantity);
        db.query("UPDATE cart_items SET quantity = ? WHERE id = ?", [newQty, results[0].id], err2 => {
          if (err2) return res.status(500).json({ success: false, message: err2.message });
          res.json({ success: true, message: "Quantité mise à jour" });
        });
      } else {
        db.query(
          "INSERT INTO cart_items (user_id, ref, color, taille, price, quantity, image) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [userId, ref, productColor, productSize, price, Number(quantity), image],
          err2 => {
            if (err2) return res.status(500).json({ success: false, message: err2.message });
            res.json({ success: true, message: "Produit ajouté au panier" });
          }
        );
      }
    }
  );
});
 
app.post("/cart/update", (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Non connecté" });
 
  const { id, quantity } = req.body;
  db.query("UPDATE cart_items SET quantity = ? WHERE id = ? AND user_id = ?", [quantity, id, userId], err => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.json({ success: true, message: "Quantité mise à jour" });
  });
});
 
app.post("/cart/remove", (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Non connecté" });
 
  const { id } = req.body;
  db.query("DELETE FROM cart_items WHERE id = ? AND user_id = ?", [id, userId], err => {
    if (err) return res.status(500).json({ success: false, message: err.message });
    res.json({ success: true, message: "Produit supprimé" });
  });
});
 
// ---------------------- Paiement Stripe & historique ---------------------- //
// ---------------------- Portefeuille (cartes enregistrées) ---------------------- //
// Renvoie l'identifiant client Stripe de l'utilisateur (le crée s'il n'existe pas encore)
async function clientStripe(userId) {
  const [users] = await db.promise().query("SELECT email, stripe_customer_id FROM users WHERE id = ?", [userId]);
  if (!users.length) throw new Error("Utilisateur non trouvé");
  if (users[0].stripe_customer_id) return users[0].stripe_customer_id;
  const customer = await stripe.customers.create({ email: users[0].email });
  await db.promise().query("UPDATE users SET stripe_customer_id = ? WHERE id = ?", [customer.id, userId]);
  return customer.id;
}
 
// Vérifie qu'une carte appartient bien au client connecté
async function carteDuClient(pmId, customerId) {
  const pm = await stripe.paymentMethods.retrieve(String(pmId));
  if (pm.customer !== customerId) throw Object.assign(new Error("Carte introuvable"), { statut: 404 });
  return pm;
}
 
// Supprime les cartes en double (même carte enregistrée plusieurs fois).
// On garde la carte par défaut, sinon la plus récente. Renvoie les cartes restantes.
async function dedoublonnerCartes(customerId, cartesStripe, defautId) {
  const groupes = new Map();
  for (const pm of cartesStripe) {
    const c = pm.card;
    const cle = c.fingerprint || `${c.brand}-${c.last4}-${c.exp_month}-${c.exp_year}`;
    if (!groupes.has(cle)) groupes.set(cle, []);
    groupes.get(cle).push(pm);
  }
  const gardees = [];
  const aRetirer = [];
  for (const groupe of groupes.values()) {
    groupe.sort((a, b) => (b.id === defautId) - (a.id === defautId) || (b.created || 0) - (a.created || 0));
    gardees.push(groupe[0]);
    aRetirer.push(...groupe.slice(1));
  }
  await Promise.all(aRetirer.map(pm => Promise.all([stripe.paymentMethods.detach(pm.id).catch(() => {}), oublierCarte(pm.id).catch(() => {})])));
  return gardees;
}
 
async function idsEnregistres(userId) {
  const [rows] = await db.promise().query("SELECT pm_id FROM cartes_enregistrees WHERE user_id = ?", [userId]);
  return new Set(rows.map(r => r.pm_id));
}
async function enregistrerCarte(userId, pmId) {
  await db.promise().query("INSERT IGNORE INTO cartes_enregistrees (user_id, pm_id) VALUES (?, ?)", [userId, pmId]);
}
async function oublierCarte(pmId) {
  await db.promise().query("DELETE FROM cartes_enregistrees WHERE pm_id = ?", [pmId]);
}
 
function exigerStripe(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ success: false, message: "Non connecté" });
  if (!stripe) return res.status(503).json({ success: false, message: "Paiement indisponible (STRIPE_SECRET manquant dans .env)" });
  next();
}
 
// Liste des cartes
app.get("/api/cartes", exigerStripe, async (req, res) => {
  try {
    const customerId = await clientStripe(req.session.userId);
    const [liste, client] = await Promise.all([
      stripe.paymentMethods.list({ customer: customerId, type: "card" }),
      stripe.customers.retrieve(customerId)
    ]);
    const defaut = client.invoice_settings && client.invoice_settings.default_payment_method;
    const enregistres = await idsEnregistres(req.session.userId);
    // Cartes rattachées sans que le client ait demandé à les enregistrer : on les retire
    const nonVoulues = liste.data.filter(pm => !enregistres.has(pm.id));
    await Promise.all(nonVoulues.map(pm => stripe.paymentMethods.detach(pm.id).catch(() => {})));
    const uniques = await dedoublonnerCartes(customerId, liste.data.filter(pm => enregistres.has(pm.id)), defaut);
    const cartes = uniques.map(pm => ({
      id: pm.id, marque: pm.card.brand, last4: pm.card.last4,
      exp_mois: pm.card.exp_month, exp_annee: pm.card.exp_year,
      titulaire: (pm.billing_details && pm.billing_details.name) || "",
      defaut: pm.id === defaut
    }));
    // Si aucune carte n'est "par défaut", la plus récente le devient ; la carte par défaut est affichée en premier
    if (cartes.length && !cartes.some(c => c.defaut)) cartes[0].defaut = true;
    cartes.sort((a, b) => b.defaut - a.defaut);
    res.json({ success: true, cartes });
  } catch (e) {
    console.error("Erreur /api/cartes :", e.message);
    res.status(500).json({ success: false, message: "Impossible de charger tes cartes." });
  }
});
 
// Préparer l'ajout d'une carte (SetupIntent Stripe : la carte est vérifiée sans être débitée)
app.post("/api/cartes/preparer", exigerStripe, async (req, res) => {
  try {
    const customerId = await clientStripe(req.session.userId);
    const setup = await stripe.setupIntents.create({ customer: customerId, payment_method_types: ["card"], usage: "off_session" });
    res.json({ success: true, clientSecret: setup.client_secret });
  } catch (e) {
    console.error("Erreur /api/cartes/preparer :", e.message);
    res.status(500).json({ success: false, message: "Impossible d'ajouter une carte pour le moment." });
  }
});
 
// Enregistrer dans le portefeuille une carte qui vient d'être ajoutée
app.post("/api/cartes/:id/enregistrer", exigerStripe, async (req, res) => {
  try {
    const customerId = await clientStripe(req.session.userId);
    await carteDuClient(req.params.id, customerId);
    await enregistrerCarte(req.session.userId, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(e.statut || 400).json({ success: false, message: e.statut ? e.message : "Impossible d'enregistrer cette carte." });
  }
});
 
// Définir la carte par défaut
app.post("/api/cartes/:id/defaut", exigerStripe, async (req, res) => {
  try {
    const customerId = await clientStripe(req.session.userId);
    await carteDuClient(req.params.id, customerId);
    await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: req.params.id } });
    res.json({ success: true, message: "Carte par défaut mise à jour." });
  } catch (e) {
    res.status(e.statut || 400).json({ success: false, message: e.statut ? e.message : "Impossible de modifier la carte par défaut." });
  }
});
 
// Modifier une carte (titulaire et date d'expiration)
app.put("/api/cartes/:id", exigerStripe, async (req, res) => {
  const mois = parseInt(req.body.exp_mois);
  const annee = parseInt(req.body.exp_annee);
  const titulaire = String(req.body.titulaire || "").trim().slice(0, 100);
  const maintenant = new Date();
  if (!(mois >= 1 && mois <= 12) || !(annee >= maintenant.getFullYear() && annee <= maintenant.getFullYear() + 20)
      || (annee === maintenant.getFullYear() && mois < maintenant.getMonth() + 1)) {
    return res.status(400).json({ success: false, message: "Date d'expiration invalide." });
  }
  if (!titulaire) return res.status(400).json({ success: false, message: "Indique le nom du titulaire." });
  try {
    const customerId = await clientStripe(req.session.userId);
    await carteDuClient(req.params.id, customerId);
    await stripe.paymentMethods.update(req.params.id, { card: { exp_month: mois, exp_year: annee }, billing_details: { name: titulaire } });
    res.json({ success: true, message: "Carte modifiée." });
  } catch (e) {
    res.status(e.statut || 400).json({ success: false, message: e.statut ? e.message : "Impossible de modifier cette carte." });
  }
});
 
// Supprimer une carte
app.delete("/api/cartes/:id", exigerStripe, async (req, res) => {
  try {
    const customerId = await clientStripe(req.session.userId);
    await carteDuClient(req.params.id, customerId);
    await stripe.paymentMethods.detach(req.params.id);
    await oublierCarte(req.params.id);
    res.json({ success: true, message: "Carte supprimée." });
  } catch (e) {
    res.status(e.statut || 400).json({ success: false, message: e.statut ? e.message : "Impossible de supprimer cette carte." });
  }
});
 
app.post("/pay", async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Non connecté" });
  if (!stripe) return res.status(503).json({ success: false, message: "Paiement indisponible (STRIPE_SECRET manquant dans .env)" });
 
  const { paymentMethodId, amount, items } = req.body;
  const livraison = nettoyerLivraison(req.body.livraison);
  const montant = parseInt(amount);
  if (!paymentMethodId || !montant || montant < 50) {
    return res.status(400).json({ success: false, message: "Données de paiement manquantes ou montant invalide" });
  }
  if (!livraison) {
    return res.status(400).json({ success: false, message: "Adresse de livraison incomplète." });
  }
 
  let nouvelleCarte = false;
  try {
    const [users] = await db.promise().query("SELECT email, stripe_customer_id FROM users WHERE id = ?", [userId]);
    if (users.length === 0) return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
 
    // Si le compte n'a pas encore de client Stripe, on le crée maintenant
    let customerId = users[0].stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: users[0].email });
      customerId = customer.id;
      await db.promise().query("UPDATE users SET stripe_customer_id = ? WHERE id = ?", [customerId, userId]);
    }
 
    // Carte déjà dans le portefeuille ? Sinon on la rattache au client
    const pmAvant = await stripe.paymentMethods.retrieve(paymentMethodId);
    nouvelleCarte = pmAvant.customer !== customerId;
    if (pmAvant.customer && nouvelleCarte) {
      return res.status(403).json({ success: false, message: "Cette carte n'est pas utilisable." });
    }
    if (!nouvelleCarte && !(await idsEnregistres(userId)).has(paymentMethodId)) {
      return res.status(403).json({ success: false, message: "Cette carte n'est plus dans ton portefeuille." });
    }
    if (nouvelleCarte) await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
 
    const paymentIntent = await stripe.paymentIntents.create({
      amount: montant,
      currency: "eur",
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" }
    });
 
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
 
    // Nouvelle carte : on la garde dans le portefeuille seulement si le client l'a demandé
    if (nouvelleCarte && !req.body.enregistrerCarte) {
      stripe.paymentMethods.detach(paymentMethodId).catch(() => {});
    } else if (nouvelleCarte) {
      // Le client a coché "Enregistrer" : la carte entre dans son portefeuille (sans doublon)
      try {
        await enregistrerCarte(userId, paymentMethodId);
        const enregistres = await idsEnregistres(userId);
        const [l, c] = await Promise.all([stripe.paymentMethods.list({ customer: customerId, type: "card" }), stripe.customers.retrieve(customerId)]);
        await dedoublonnerCartes(customerId, l.data.filter(pm => enregistres.has(pm.id)), c.invoice_settings && c.invoice_settings.default_payment_method);
      } catch (e) { console.error("⚠️  Carte non enregistrée :", e.message); }
    }
 
    await db.promise().query(
      `INSERT INTO paiements
        (user_id, stripe_payment_intent_id, amount, currency, status, brand, last4, montant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, paymentIntent.id, paymentIntent.amount, paymentIntent.currency, paymentIntent.status,
       paymentMethod.card.brand, paymentMethod.card.last4, montant]
    );
 
    // Enregistrement de la commande (visible dans "Mes commandes")
    let numero = null;
    try {
      const [r] = await db.promise().query(
        "INSERT INTO commandes (user_id, stripe_payment_intent_id, total, statut, articles, livraison) VALUES (?, ?, ?, 'payee', ?, ?)",
        [userId, paymentIntent.id, montant, JSON.stringify(nettoyerArticles(items)), JSON.stringify(livraison)]
      );
      numero = "VB-" + (10000 + r.insertId);
      await db.promise().query("UPDATE commandes SET numero = ? WHERE id = ?", [numero, r.insertId]);
    } catch (e) {
      console.error("⚠️  Commande non enregistrée :", e.message);
    }
 
    // "Enregistrer comme adresse principale" coché : on met à jour l'adresse du compte
    if (req.body.livraison && req.body.livraison.enregistrer) {
      try {
        const [ex] = await db.promise().query("SELECT id FROM adresses WHERE user_id = ?", [userId]);
        const v = [livraison.adresse, livraison.code_postal, livraison.ville, livraison.pays, livraison.telephone];
        if (ex.length) await db.promise().query("UPDATE adresses SET adresse = ?, code_postal = ?, ville = ?, pays = ?, telephone = ? WHERE user_id = ?", [...v, userId]);
        else await db.promise().query("INSERT INTO adresses (adresse, code_postal, ville, pays, telephone, user_id) VALUES (?, ?, ?, ?, ?, ?)", [...v, userId]);
      } catch (e) { console.error("⚠️  Adresse non enregistrée :", e.message); }
    }
 
    res.json({ success: true, paymentIntent, numero });
  } catch (error) {
    console.error("Erreur Stripe /pay :", error.message);
    // Paiement refusé avec une nouvelle carte non enregistrée : on la retire du portefeuille
    if (nouvelleCarte && !req.body.enregistrerCarte && req.body.paymentMethodId) {
      stripe.paymentMethods.detach(req.body.paymentMethodId).catch(() => {});
    }
    // Messages Stripe traduits en français pour le client
    const MESSAGES = {
      insufficient_funds: "Fonds insuffisants sur cette carte.",
      expired_card: "Cette carte est expirée.",
      incorrect_cvc: "Le code CVC est incorrect.",
      incorrect_number: "Le numéro de carte est incorrect.",
      processing_error: "Erreur de traitement, réessaie dans un instant.",
      authentication_required: "Cette carte demande une authentification 3D Secure, non prise en charge ici.",
      card_declined: "Ta carte a été refusée par la banque."
    };
    const message = MESSAGES[error.decline_code] || MESSAGES[error.code] || error.message;
    res.status(400).json({ success: false, message });
  }
});
 
// ---------------------- Formulaire de contact (page Aide) ---------------------- //
const envoisContact = new Map(); // limite anti-spam : 5 messages / 10 min par adresse IP
app.post("/api/contact", (req, res) => {
  const { nom, email, sujet, message, site } = req.body;
  if (site) return res.json({ success: true }); // champ piège rempli = robot, on ignore
 
  const ip = req.ip;
  const maintenant = Date.now();
  const recents = (envoisContact.get(ip) || []).filter(t => maintenant - t < 10 * 60 * 1000);
  if (recents.length >= 5) return res.status(429).json({ success: false, message: "Trop de messages envoyés, réessaie dans quelques minutes." });
 
  if (!nom || !email || !message || !String(message).trim()) {
    return res.status(400).json({ success: false, message: "Nom, email et message sont obligatoires." });
  }
  if (!isValidEmail(String(email))) return res.status(400).json({ success: false, message: "Adresse email invalide." });
 
  db.query(
    "INSERT INTO messages_support (user_id, nom, email, sujet, message) VALUES (?, ?, ?, ?, ?)",
    [req.session.userId || null, String(nom).slice(0, 100), String(email).slice(0, 255), String(sujet || "Autre").slice(0, 50), String(message).slice(0, 2000)],
    err => {
      if (err) return res.status(500).json({ success: false, message: "Erreur serveur, réessaie plus tard." });
      recents.push(maintenant);
      envoisContact.set(ip, recents);
      console.log(`📩 Nouveau message support de ${email} (${sujet})`);
      res.json({ success: true });
    }
  );
});
 
app.get("/api/commandes", (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Non connecté" });
 
  db.query(
    "SELECT numero, total, statut, articles, livraison, created_at FROM commandes WHERE user_id = ? ORDER BY created_at DESC, id DESC",
    [userId],
    (err, rows) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      const commandes = rows.map(c => {
        let articles = [];
        let livraison = null;
        try { articles = JSON.parse(c.articles || "[]"); } catch (e) {}
        try { livraison = c.livraison ? JSON.parse(c.livraison) : null; } catch (e) {}
        return { numero: c.numero, total: c.total, statut: c.statut, date: c.created_at, articles, livraison };
      });
      res.json({ success: true, commandes });
    }
  );
});
 
app.get("/paiements", (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Non connecté" });
 
  db.query(
    "SELECT brand, last4, montant, status, created_at FROM paiements WHERE user_id = ? ORDER BY created_at DESC",
    [userId],
    (err, results) => {
      if (err) return res.status(500).json({ success: false, message: err.message });
      res.json({ success: true, paiements: results });
    }
  );
});
 
// ---------------------- Lancement du serveur ---------------------- //
app.listen(port, () => console.log(`🚀 Serveur lancé : http://localhost:${port}`));
 


