# VigoBlue / Veraba – Boutique en ligne

Site e-commerce de t-shirts : catalogue, fiche produit avec tailles, panier, favoris, code promo,
compte client, adresses, paiement par carte (Stripe, mode test) et recherche de magasin.

**Technologies :** Node.js · Express · MySQL · Bootstrap · Stripe

## Lancer le projet en local

1. **Installer** [Node.js](https://nodejs.org) et MySQL.
2. **Créer la base :**
   ```bash
   mysql -u root -p < VigoBlue.sql
   ```
   Base déjà existante ? Utilise plutôt `migration.sql`, qui ajoute ce qui manque sans rien supprimer :
   ```bash
   mysql -u ben -p VigoBlue < migration.sql
   ```
3. **Configurer :** copie `.env.example` en `.env` et remplis tes valeurs (MySQL, secret de session, clé Stripe de test).
4. **Installer et démarrer :**
   ```bash
   npm install
   npm start
   ```
5. Ouvre **http://localhost:3000**

## Organisation

```
server.js        → serveur Express (API + pages)
VigoBlue.sql     → création complète de la base
migration.sql    → mise à jour d'une base existante
.env.example     → modèle de configuration (le vrai .env n'est jamais publié)
public/          → pages HTML, CSS, images
```

## Fonctionnement

- **Inscription** avec email + mot de passe (8 caractères, 1 majuscule, 3 chiffres, 1 symbole), haché avec bcrypt.
- **Pages membres** (`site`, `compte`, `adresses`, `commandes`, `paiement`) : accessibles uniquement une fois connecté,
  sinon redirection vers la connexion.
- **Mot de passe oublié :** pas d'envoi d'email en local, le lien de réinitialisation s'affiche dans le terminal du serveur.
- **Panier :** stocké dans le navigateur ; le total (−5 %, code `VB10`, livraison offerte dès 25 €) est repris sur la page paiement.
- **Paiement :** Stripe en mode test, carte `4242 4242 4242 4242`, date future, CVC au choix.

## Mettre en ligne (Render + Aiven)

1. **Base MySQL gratuite sur [Aiven](https://aiven.io/free-mysql-database)** : crée un service MySQL (plan Free),
   puis importe la base : `mysql -h HÔTE -P PORT -u avnadmin -p --ssl-mode=REQUIRED < VigoBlue.sql`
2. **Code sur GitHub** (le `.env` n'est pas envoyé grâce au `.gitignore`).
3. **Site sur [Render](https://render.com)** : New → Web Service → ton dépôt GitHub
   - Build command : `npm install` · Start command : `npm start` · Plan : Free
   - Environment : `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASS`, `DB_NAME=VigoBlue`, `DB_SSL=true`,
     `SESSION_SECRET`, `STRIPE_SECRET`, `NODE_ENV=production`, `SITE_URL=https://ton-site.onrender.com`
