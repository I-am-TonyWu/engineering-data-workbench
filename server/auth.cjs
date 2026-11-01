const { timingSafeEqual } = require('node:crypto');
function matches(token, configured) { if (!configured || configured.length < 24)
    return false; const a = Buffer.from(token), b = Buffer.from(configured); return a.length === b.length && timingSafeEqual(a, b); }
// Replace this adapter with the trusted identity from your deployment platform.
function identity(req) { const token = String(req.headers.authorization || '').replace(/^Bearer /, ''); if (matches(token, process.env.OWNER_TOKEN))
    return { id: 'creator', name: '应用创建人', role: 'creator' }; if (matches(token, process.env.ADMIN_TOKEN))
    return { id: 'admin', name: '资料管理员', role: 'admin' }; return { id: 'reader', name: '用户', role: 'user' }; }
module.exports = { identity };
