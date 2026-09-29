-- ============================================================
--  VigoBlue - Base de données MySQL (installation complète)
--  ⚠️  Ce script SUPPRIME puis recrée toutes les tables.
--  Pour mettre à jour une base existante sans perdre les données,
--  utilise plutôt migration.sql
--  Utilisation : mysql -u ben -p < VigoBlue.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS VigoBlue CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE VigoBlue;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS cart_items;
DROP TABLE IF EXISTS paiements;
DROP TABLE IF EXISTS adresses;
DROP TABLE IF EXISTS product_variants;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS verification_codes;
DROP TABLE IF EXISTS personnes;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

-- ---------- Utilisateurs ----------
CREATE TABLE users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,            -- mot de passe haché avec bcrypt
    nom VARCHAR(100),
    prenom VARCHAR(100),
    jour_naissance INT,
    mois_naissance INT,
    annee_naissance INT,
    stripe_customer_id VARCHAR(255),
    reset_token VARCHAR(100),                  -- mot de passe oublié
    reset_token_exp BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------- Adresses (une par utilisateur) ----------
CREATE TABLE adresses (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE,
    adresse VARCHAR(255),
    code_postal VARCHAR(20),
    ville VARCHAR(100),
    pays VARCHAR(100) DEFAULT 'France',
    telephone VARCHAR(30),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_adresses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- Produits ----------
CREATE TABLE products (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    nom VARCHAR(255) NOT NULL,
    description TEXT,
    prix DECIMAL(10,2) NOT NULL,               -- en euros (ex : 22.99)
    image VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE product_variants (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    product_id BIGINT NOT NULL,
    couleur VARCHAR(100),
    taille VARCHAR(20),
    stock INT DEFAULT 0,
    image VARCHAR(255),
    CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- Panier ----------
CREATE TABLE cart_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    ref VARCHAR(255) NOT NULL,
    color VARCHAR(100),
    taille VARCHAR(20),
    price DECIMAL(10,2) NOT NULL,
    quantity INT DEFAULT 1,
    image VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cart_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- Paiements ----------
-- Les numéros de carte ne sont JAMAIS stockés : seulement la marque et les 4 derniers chiffres.
CREATE TABLE paiements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    stripe_payment_intent_id VARCHAR(255),
    amount INT NOT NULL,                       -- en centimes (renvoyé par Stripe)
    currency VARCHAR(10) DEFAULT 'eur',
    status VARCHAR(50),
    brand VARCHAR(50),
    last4 VARCHAR(4),
    montant INT NOT NULL,                      -- en centimes
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_paiements_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- ---------- Produits d'exemple (ceux affichés sur le site) ----------
INSERT INTO products (id, nom, description, prix, image) VALUES
(1, 'T-shirt Veraba',          'T-shirt en coton', 22.99, 's.png'),
(2, 'T-shirt Veraba Classic',  'T-shirt en coton', 22.99, 'www.png'),
(3, 'T-shirt Veraba Edition',  'T-shirt en coton', 22.99, 'vigo4.png'),
(4, 'T-shirt Veraba Edition 2','T-shirt en coton', 22.99, 'vigo1.png'),
(5, 'T-shirt Veraba Edition 3','T-shirt en coton', 22.99, 'vigo2.png'),
(6, 'T-shirt Veraba Edition 4','T-shirt en coton', 22.99, 'vigo.png');

INSERT INTO product_variants (product_id, couleur, taille, stock)
SELECT p.id, 'Standard', t.taille, 20
FROM products p
CROSS JOIN (SELECT 'S' AS taille UNION SELECT 'M' UNION SELECT 'L' UNION SELECT 'XL') t;
