CREATE TABLE IF NOT EXISTS users (
    id int not null PRIMARY KEY AUTO_INCREMENT,
    username varchar(254) not null UNIQUE,
    displayName varchar(254) not null,
    password varchar(254) not null
    );

INSERT IGNORE INTO users (username, displayName, password) values ('mau', 'Mau','hunter2');
INSERT IGNORE INTO users (username, displayName, password) values ('ada', 'Ada', 'lovelace');

CREATE TABLE IF NOT EXISTS sessions (
    sessionUuid varchar(36) PRIMARY KEY not null,
    userId int not null,
    absoluteExpireAt bigint not null,
    rotatedAt bigint default null,
    active tinyint not null default 1,
    familyUuid varchar(36) not null,
    FOREIGN KEY (userId) references users(id) ON DELETE CASCADE
);
