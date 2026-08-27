-- Read and run on boot by the server (Ex 0). Top-to-bottom, so one bad
-- statement takes out everything after it. `IF NOT EXISTS` + `INSERT IGNORE`
-- keep it idempotent so re-running on every --watch restart is safe.

CREATE TABLE IF NOT EXISTS users (
    id int NOT NULL PRIMARY KEY AUTO_INCREMENT,
    username varchar(254) NOT NULL UNIQUE,
    displayName varchar(254) NOT NULL,
    password varchar(254) NOT NULL
);

INSERT IGNORE INTO users (username, displayName, password) VALUES ('mau', 'Mau', 'hunter2');
INSERT IGNORE INTO users (username, displayName, password) VALUES ('ada', 'Ada', 'lovelace');

-- The `sessions` table (the refresh token) arrives in Phase 2. It stays out of
-- here until then so Phase 1 is pure access-token work with nothing to revoke.

CREATE TABLE IF NOT EXISTS sessions (
    sessionUuid varchar(36) PRIMARY KEY not null,
    userId int not null,
    absoluteExpireAt bigint not null,
    foreign key (userId) references users(id) on delete cascade
);
