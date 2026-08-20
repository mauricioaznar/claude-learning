CREATE TABLE IF NOT EXISTS sessions (
    uuid varchar(36) PRIMARY KEY not null,
    user_id int not null,
    expire_at bigint not null,
    absolute_expire_at bigint not null
)