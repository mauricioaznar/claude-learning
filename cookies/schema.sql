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
    userId int not null,
    absoluteExpireAt bigint not null,
    FOREIGN KEY (userId) references users(id) ON DELETE CASCADE
);
