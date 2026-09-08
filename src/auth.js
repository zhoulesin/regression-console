import crypto from 'node:crypto';

export function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

export function tokenMiddleware(token) {
  return (req, res, next) => {
    const h = req.headers.authorization || '';
    const bearer = h.startsWith('Bearer ') ? h.slice(7) : '';
    const q = typeof req.query.token === 'string' ? req.query.token : '';
    if (bearer === token || q === token) return next();
    res.status(401).json({ error: 'unauthorized' });
  };
}
