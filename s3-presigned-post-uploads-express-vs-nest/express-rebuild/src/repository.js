const ROW_COLUMNS_SELECT = `id, key, filename, content_type contentType, size, status, created_at createdAt, completed_at completedAt`

export function createRepository(db) {
    return {
        create: ({
            id, key, filename, contentType, size
                 }) => {
            const statementObject = db.prepare(`insert into uploads (id, key, filename, content_type, size, status, created_at, completed_at) values(@id, @key, @filename, @content_type, @size, 'pending', @created_at, null)`);
            statementObject.run({id, key, filename, content_type: contentType, size, created_at: Date.now()})
        },
        list: () => {
            return db.prepare(`select ${ROW_COLUMNS_SELECT} from uploads`).all();
        },
        getById: (id) => {

            return db.prepare(`select ${ROW_COLUMNS_SELECT} from uploads where id = @id`).get({ id: id });
        },
        markUploaded: (id) => {
            db.prepare(`update uploads set status = 'uploaded', completed_at = @completed_at where id = @id`).run({ id: id, completed_at: Date.now()})
        },
        remove: (id) => {
            db.prepare(`delete from uploads where id = @id`).run({ id });

        }
    }
}