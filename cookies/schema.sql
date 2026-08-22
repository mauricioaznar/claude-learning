CREATE TABLE IF NOT EXISTS users (
    id int not null PRIMARY KEY AUTO_INCREMENT,
    username varchar(254) not null UNIQUE,
    displayName varchar(254) not null,
    password varchar(254) not null
    );

INSERT IGNORE INTO users (username, displayName, password) values ('mau', 'Mau','hunter2');
INSERT IGNORE INTO users (username, displayName, password) values ('ada', 'Ada', 'lovelace');

CREATE TABLE IF NOT EXISTS sessions (
    uuid varchar(36) PRIMARY KEY not null,
    user_id int not null,
    expire_at bigint not null,
    absolute_expire_at bigint not null,
    FOREIGN KEY (user_id) references users(id) ON DELETE CASCADE
);