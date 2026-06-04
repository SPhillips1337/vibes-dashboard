const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSIONS_FILE = path.join(DATA_DIR, 'sessions.json');

// Ensure data directory and files exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let users = [];
let sessions = {};

// Load users from disk
function loadUsers() {
  if (fs.existsSync(USERS_FILE)) {
    try {
      users = JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
    } catch (err) {
      console.error('[Auth] Failed to load users:', err);
    }
  }
}

// Save users to disk
function saveUsers() {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8');
  } catch (err) {
    console.error('[Auth] Failed to save users:', err);
  }
}

// Load sessions from disk and prune expired ones
function loadSessions() {
  if (fs.existsSync(SESSIONS_FILE)) {
    try {
      const data = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      const now = Date.now();
      // Only keep active sessions
      for (const [sid, session] of Object.entries(data)) {
        if (session.expiresAt && new Date(session.expiresAt).getTime() > now) {
          sessions[sid] = session;
        }
      }
      saveSessions();
    } catch (err) {
      console.error('[Auth] Failed to load sessions:', err);
    }
  }
}

// Save sessions to disk
function saveSessions() {
  try {
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (err) {
    console.error('[Auth] Failed to save sessions:', err);
  }
}

// Scrypt password hashing helper
function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString('hex');
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${derivedKey.toString('hex')}.${salt}`);
    });
  });
}

// Scrypt verification helper
function verifyPassword(password, storedHashAndSalt) {
  return new Promise((resolve, reject) => {
    if (!storedHashAndSalt) return resolve(false);
    const parts = storedHashAndSalt.split('.');
    if (parts.length !== 2) return resolve(false);
    const [hash, salt] = parts;
    crypto.scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (err, derivedKey) => {
      if (err) return reject(err);
      
      const derivedHex = derivedKey.toString('hex');
      // Use timingSafeEqual to prevent timing attacks on hash verification
      const hashBuffer = Buffer.from(hash, 'hex');
      const derivedBuffer = Buffer.from(derivedHex, 'hex');
      if (hashBuffer.length !== derivedBuffer.length) {
        resolve(false);
      } else {
        resolve(crypto.timingSafeEqual(hashBuffer, derivedBuffer));
      }
    });
  });
}

// Initialize system users with a default administrator if empty
async function seedAdmin() {
  loadUsers();
  if (users.length === 0) {
    const username = 'admin';
    const password = process.env.ADMIN_PASSWORD || 'VibesAdmin2026!';
    const hashedPassword = await hashPassword(password);
    
    users.push({
      id: 'u_' + crypto.randomBytes(8).toString('hex'),
      username: username,
      name: 'Administrator',
      role: 'admin',
      passwordHash: hashedPassword,
      createdAt: new Date().toISOString()
    });
    
    saveUsers();
    console.warn('\n=============================================================');
    console.warn(`[Auth] No users found. Seeded default admin account.`);
    console.warn(`Username: ${username}`);
    console.warn(`Password: ${password}`);
    console.warn(`WARNING: Change this password immediately after logging in!`);
    console.warn('=============================================================\n');
  }
}

// Brute-force rate limiting database
const loginAttempts = new Map();

function isRateLimited(ip) {
  const attempt = loginAttempts.get(ip);
  if (!attempt) return false;
  
  if (attempt.lockUntil && attempt.lockUntil > Date.now()) {
    return true;
  }
  
  if (attempt.lockUntil && attempt.lockUntil <= Date.now()) {
    loginAttempts.delete(ip);
  }
  return false;
}

function recordLoginAttempt(ip, success) {
  if (success) {
    loginAttempts.delete(ip);
    return;
  }
  
  const attempt = loginAttempts.get(ip) || { count: 0, lockUntil: null };
  attempt.count++;
  if (attempt.count >= 5) {
    attempt.lockUntil = Date.now() + 10 * 60 * 1000; // 10 minutes lock
    console.warn(`[Auth] IP ${ip} has been rate-limited for 10 minutes due to failed login attempts.`);
  }
  loginAttempts.set(ip, attempt);
}

// Clean up expired sessions periodically (every hour)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [sid, session] of Object.entries(sessions)) {
    if (session.expiresAt && new Date(session.expiresAt).getTime() < now) {
      delete sessions[sid];
      changed = true;
    }
  }
  if (changed) saveSessions();
}, 60 * 60 * 1000);

// Initialize database
loadUsers();
loadSessions();
seedAdmin();

module.exports = {
  users,
  sessions,
  saveUsers,
  saveSessions,
  hashPassword,
  verifyPassword,
  isRateLimited,
  recordLoginAttempt,
  
  // Creates and records a session
  createSession(userId, username, role) {
    const sessionId = crypto.randomBytes(32).toString('hex');
    const csrfToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // 24 hours
    
    sessions[sessionId] = {
      userId,
      username,
      role,
      csrfToken,
      expiresAt
    };
    saveSessions();
    return { sessionId, csrfToken };
  },
  
  // Destroys an active session
  destroySession(sessionId) {
    if (sessions[sessionId]) {
      delete sessions[sessionId];
      saveSessions();
      return true;
    }
    return false;
  },
  
  // Saves a key/value preference against a user
  saveUserPreference(username, key, value) {
    const user = users.find(u => u.username === username.toLowerCase());
    if (user) {
      user[key] = value;
      saveUsers();
      return true;
    }
    return false;
  }
};
