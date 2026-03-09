-- 1. Roles Table
CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    permissions TEXT NOT NULL -- JSON string of permissions
);

-- 2. Users Table
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role_id INTEGER,
    FOREIGN KEY (role_id) REFERENCES roles(id)
);

-- 3. Category Table
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    default_weight REAL DEFAULT 1.0
);

-- 4. Sources Table
CREATE TABLE IF NOT EXISTS sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    organization TEXT,
    category_id INTEGER,
    reliability_weight REAL DEFAULT 1.0,
    metadata_config TEXT, -- JSON configuration
    FOREIGN KEY (category_id) REFERENCES categories(id)
);

-- 5. Audit Log Table
CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    old_value TEXT,
    new_value TEXT,
    actor_user_id INTEGER,
    reason TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

-- 6. Config Table
CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 7. Overrides Table
CREATE TABLE IF NOT EXISTS overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_type TEXT NOT NULL, -- 'industry' or 'company'
    entity_id TEXT NOT NULL,   -- Industry name or UEN
    original_score REAL,
    overridden_score REAL NOT NULL,
    actor_user_id INTEGER,
    reason TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

-- Seed Data (using INSERT OR IGNORE to be idempotent)
INSERT OR IGNORE INTO roles (name, permissions) VALUES 
('Admin', '["all"]'),
('Analyst', '["read", "override_industry", "config_industry"]'),
('Officer', '["read", "override_company", "config_company", "approve_entity"]');

INSERT OR IGNORE INTO categories (name, default_weight) VALUES 
('Macroeconomic', 1.0),
('Industry Structural', 1.0),
('Labour Market', 1.0),
('Company Financial', 1.0),
('Operational Business', 1.0),
('Sentiment', 1.0),
('Event', 1.0);

INSERT OR IGNORE INTO users (username, password_hash, role_id) 
SELECT 'admin', 'admin123', id FROM roles WHERE name = 'Admin';

INSERT OR IGNORE INTO config (key, value) VALUES 
('industry_stress_threshold', '60'),
('industry_adjustment_weight', '0.30'),
('high_risk_alert_threshold', '70'),
('emerging_risk_delta_trigger', '10');
