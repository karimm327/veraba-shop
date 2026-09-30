-- ============================================================
--  VigoBlue - Mise à jour d'une base EXISTANTE (sans perte de données)
--  Ajoute seulement ce qui manque : tables et colonnes utilisées par server.js.
--  Tu peux l'exécuter plusieurs fois sans risque.
--  Utilisation : mysql -u ben -p VigoBlue < migration.sql
-- ============================================================

-- Petite procédure : ajoute une colonne seulement si elle n'existe pas encore
DROP PROCEDURE IF EXISTS vb_add_col;
DELIMITER //
CREATE PROCEDURE vb_add_col(IN t VARCHAR(64), IN c VARCHAR(64), IN def VARCHAR(255))
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = t)
     AND NOT EXISTS (SELECT 1 FROM information_schema.COLUMNS
                     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = t AND COLUMN_NAME = c) THEN
    SET @sql = CONCAT('ALTER TABLE `', t, '` ADD COLUMN `', c, '` ', def);
    PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- ---------- Tables manquantes ----------
CREATE TABLE IF NOT EXISTS users (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS adresses (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    adresse VARCHAR(255),
    code_postal VARCHAR(20),
    ville VARCHAR(100),
    pays VARCHAR(100) DEFAULT 'France',
    telephone VARCHAR(30),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS products (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    nom VARCHAR(255) NOT NULL,
    description TEXT,
    prix DECIMAL(10,2) NOT NULL,
    image VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS product_variants (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    product_id BIGINT NOT NULL,
    couleur VARCHAR(100),
    taille VARCHAR(20),
    stock INT DEFAULT 0,
    image VARCHAR(255)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cart_items (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    ref VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    quantity INT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS paiements (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    montant INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ---------- Commandes (remplies automatiquement après chaque paiement) ----------
CREATE TABLE IF NOT EXISTS commandes (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT NOT NULL,
    numero VARCHAR(20),                        -- ex : VB-10001
    stripe_payment_intent_id VARCHAR(255),
    total INT NOT NULL,                        -- en centimes
    statut VARCHAR(30) DEFAULT 'payee',        -- payee / preparee / expediee / livree / annulee
    articles TEXT,                             -- liste des articles (JSON)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_commandes_user (user_id)
) ENGINE=InnoDB;

-- ---------- Colonnes manquantes ----------
CALL vb_add_col('users', 'nom', 'VARCHAR(100)');
CALL vb_add_col('users', 'prenom', 'VARCHAR(100)');
CALL vb_add_col('users', 'jour_naissance', 'INT');
CALL vb_add_col('users', 'mois_naissance', 'INT');
CALL vb_add_col('users', 'annee_naissance', 'INT');
CALL vb_add_col('users', 'stripe_customer_id', 'VARCHAR(255)');
CALL vb_add_col('users', 'reset_token', 'VARCHAR(100)');
CALL vb_add_col('users', 'reset_token_exp', 'BIGINT');

CALL vb_add_col('cart_items', 'color', 'VARCHAR(100)');
CALL vb_add_col('cart_items', 'taille', 'VARCHAR(20)');
CALL vb_add_col('cart_items', 'image', 'VARCHAR(500)');

CALL vb_add_col('paiements', 'stripe_payment_intent_id', 'VARCHAR(255)');
CALL vb_add_col('paiements', 'amount', 'INT NOT NULL DEFAULT 0');
CALL vb_add_col('paiements', 'currency', "VARCHAR(10) DEFAULT 'eur'");
CALL vb_add_col('paiements', 'status', 'VARCHAR(50)');
CALL vb_add_col('paiements', 'brand', 'VARCHAR(50)');
CALL vb_add_col('paiements', 'last4', 'VARCHAR(4)');

CALL vb_add_col('adresses', 'telephone', 'VARCHAR(30)');
CALL vb_add_col('adresses', 'pays', "VARCHAR(100) DEFAULT 'France'");

CALL vb_add_col('product_variants', 'couleur', 'VARCHAR(100)');
CALL vb_add_col('product_variants', 'taille', 'VARCHAR(20)');
CALL vb_add_col('product_variants', 'stock', 'INT DEFAULT 0');

DROP PROCEDURE IF EXISTS vb_add_col;

-- ---------- Tables qui ne servent plus ----------
-- "verification_codes" : plus de code par email.
-- "personnes" : stockait des numéros de carte et des CVV (interdit, Stripe s'en charge).
-- Retire les "--" devant les 2 lignes suivantes pour les supprimer :
-- DROP TABLE IF EXISTS verification_codes;
-- DROP TABLE IF EXISTS personnes;
