import express from "express"; // express + node.js pour créer le serveur
import session from "express-session";
import MySQLStoreFactory from "express-mysql-session"; // sessions enregistrées dans MySQL
import mysql from "mysql2"; // base de données
import path from "path"; // chemins de fichiers
import crypto from "crypto"; // génération de jetons (mot de passe oublié)
import { fileURLToPath } from "url";
import Stripe from "stripe"; // moyen de paiement
import bcrypt from "bcrypt"; // hachage des mots de passe
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
});

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
const PAGES_MEMBRES = ["site", "compte", "adresses", "commandes", "paiement", "paie"];
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

// Le bouton "Voir la boutique" pointe vers shop.html, qui n'existe pas : on renvoie vers l'accueil
app.get(["/shop", "/shop.html"], (req, res) => {
  res.redirect(req.session.userId ? "/site.html" : "/index.html");
});

// Fichiers du site (HTML, CSS, images...). "/site" fonctionne comme "/site.html".
app.use(express.static(PUBLIC_DIR, { index: false, extensions: ["html"] }));

// ---------------------- Inscription (sans code de vérification) ---------------------- //
app.post("/register", async (req, res) => {
  const { email, password, nom, prenom, jour, mois, annee } = req.body;

  if (!email || !password || !nom || !prenom) {
    return res.status(400).json({ success: false, message: "Tous les champs sont requis" });
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
      "INSERT INTO users (email, password, nom, prenom, jour_naissance, mois_naissance, annee_naissance, stripe_customer_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [email, hashedPassword, nom, prenom, parseInt(jour) || null, parseInt(mois) || null, parseInt(annee) || null, stripeCustomerId]
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
app.post("/pay", async (req, res) => {
  const userId = req.session.userId;
  if (!userId) return res.status(401).json({ success: false, message: "Non connecté" });
  if (!stripe) return res.status(503).json({ success: false, message: "Paiement indisponible (STRIPE_SECRET manquant dans .env)" });

  const { paymentMethodId, amount } = req.body;
  const montant = parseInt(amount);
  if (!paymentMethodId || !montant || montant < 50) {
    return res.status(400).json({ success: false, message: "Données de paiement manquantes ou montant invalide" });
  }

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

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });

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

    await db.promise().query(
      `INSERT INTO paiements
        (user_id, stripe_payment_intent_id, amount, currency, status, brand, last4, montant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [userId, paymentIntent.id, paymentIntent.amount, paymentIntent.currency, paymentIntent.status,
       paymentMethod.card.brand, paymentMethod.card.last4, montant]
    );

    res.json({ success: true, paymentIntent });
  } catch (error) {
    console.error("Erreur Stripe /pay :", error.message);
    res.status(400).json({ success: false, message: error.message });
  }
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
