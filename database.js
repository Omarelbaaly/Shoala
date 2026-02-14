const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

class DatabaseManager {
  constructor() {
    this.db = null;
  }

  init(userDataPath) {
    const dbPath = path.join(userDataPath, 'shoala.db');
    this.db = new sqlite3.Database(dbPath);
    this.createTables();
  }

  createTables() {
    this.db.serialize(() => {
      // Users Table
      this.db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        role TEXT, -- admin, employee, viewer
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`, (err) => {
        if (!err) this.seedAdmin();
      });

      // Products Table
      this.db.run(`CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        code TEXT UNIQUE,
        min_limit INTEGER DEFAULT 0,
        quantity INTEGER DEFAULT 0,
        price REAL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )`);

      // Movements Table
      this.db.run(`CREATE TABLE IF NOT EXISTS movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER,
        type TEXT, -- IN, OUT
        quantity INTEGER,
        reason TEXT,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(product_id) REFERENCES products(id),
        FOREIGN KEY(user_id) REFERENCES users(id)
      )`);
    });
  }

  hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }

  seedAdmin() {
    const password = this.hashPassword('123456');
    this.db.run(`INSERT OR IGNORE INTO users (username, password, role) VALUES ('admin', ?, 'admin')`, [password]);
  }

  login(username, password) {
    return new Promise((resolve, reject) => {
      const hash = this.hashPassword(password);
      this.db.get(`SELECT id, username, role FROM users WHERE username = ? AND password = ?`, [username, hash], (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }

  // Dashboard Stats
  getStats() {
    return new Promise((resolve, reject) => {
      const stats = {};
      this.db.serialize(() => {
        this.db.get("SELECT COUNT(*) as count FROM products", (err, row) => stats.productsCount = row ? row.count : 0);
        this.db.get("SELECT SUM(quantity) as sum FROM products", (err, row) => stats.totalQuantity = row && row.sum ? row.sum : 0);
        this.db.get("SELECT COUNT(*) as count FROM movements", (err, row) => stats.movementsCount = row ? row.count : 0);
        this.db.get("SELECT COUNT(*) as count FROM movements WHERE date(created_at) = date('now')", (err, row) => stats.todayMovements = row ? row.count : 0);
        
        // Return accumulated stats
        // Note: In real world, use Promise.all, but serialize works for sqlite order
        setTimeout(() => resolve(stats), 100);
      });
    });
  }

  getRecentMovements() {
    return new Promise((resolve, reject) => {
      this.db.all(`
        SELECT m.*, p.name as product_name, u.username as user_name 
        FROM movements m 
        JOIN products p ON m.product_id = p.id 
        LEFT JOIN users u ON m.user_id = u.id 
        ORDER BY m.created_at DESC LIMIT 5
      `, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  // Products
  getProducts(search = '') {
    return new Promise((resolve, reject) => {
      let query = `SELECT * FROM products`;
      let params = [];
      if (search) {
        query += ` WHERE name LIKE ? OR code LIKE ?`;
        params = [`%${search}%`, `%${search}%`];
      }
      query += ` ORDER BY created_at DESC`;
      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  addProduct(product) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `INSERT INTO products (name, code, min_limit, quantity) VALUES (?, ?, ?, 0)`,
        [product.name, product.code, product.min_limit],
        function(err) {
          if (err) reject(err);
          else resolve(this.lastID);
        }
      );
    });
  }

  updateProduct(product) {
    return new Promise((resolve, reject) => {
      this.db.run(
        `UPDATE products SET name = ?, code = ?, min_limit = ? WHERE id = ?`,
        [product.name, product.code, product.min_limit, product.id],
        function(err) {
          if (err) reject(err);
          else resolve(this.changes);
        }
      );
    });
  }

  deleteProduct(id) {
    return new Promise((resolve, reject) => {
      // Check for movements first
      this.db.get("SELECT COUNT(*) as count FROM movements WHERE product_id = ?", [id], (err, row) => {
        if(row && row.count > 0) {
          reject(new Error("لا يمكن حذف صنف له حركات سابقة"));
        } else {
          this.db.run(`DELETE FROM products WHERE id = ?`, [id], function(err) {
            if (err) reject(err);
            else resolve(this.changes);
          });
        }
      });
    });
  }

  // Inventory Movement (Transaction)
  addMovement(data) {
    return new Promise((resolve, reject) => {
      this.db.get(`SELECT quantity FROM products WHERE id = ?`, [data.product_id], (err, row) => {
        if (err) return reject(err);
        if (!row) return reject(new Error("الصنف غير موجود"));

        let newQuantity = row.quantity;
        if (data.type === 'IN') {
          newQuantity += parseInt(data.quantity);
        } else {
          if (row.quantity < data.quantity) {
            return reject(new Error("الكمية المتاحة لا تكفي للصرف"));
          }
          newQuantity -= parseInt(data.quantity);
        }

        this.db.serialize(() => {
          this.db.run(`BEGIN TRANSACTION`);
          this.db.run(`UPDATE products SET quantity = ? WHERE id = ?`, [newQuantity, data.product_id]);
          this.db.run(
            `INSERT INTO movements (product_id, type, quantity, reason, user_id) VALUES (?, ?, ?, ?, ?)`,
            [data.product_id, data.type, data.quantity, data.reason, data.user_id]
          );
          this.db.run(`COMMIT`, (err) => {
            if (err) reject(err);
            else resolve(true);
          });
        });
      });
    });
  }

  // Reports
  getAllMovements(filters = {}) {
    return new Promise((resolve, reject) => {
      let query = `
        SELECT m.*, p.name as product_name, p.code, u.username 
        FROM movements m 
        JOIN products p ON m.product_id = p.id 
        LEFT JOIN users u ON m.user_id = u.id 
        WHERE 1=1
      `;
      let params = [];
      
      if (filters.startDate) {
        query += ` AND date(m.created_at) >= date(?)`;
        params.push(filters.startDate);
      }
      if (filters.endDate) {
        query += ` AND date(m.created_at) <= date(?)`;
        params.push(filters.endDate);
      }
      
      query += ` ORDER BY m.created_at DESC`;

      this.db.all(query, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }

  backup(destPath, userDataPath) {
    return new Promise((resolve, reject) => {
      const source = path.join(userDataPath, 'shoala.db');
      fs.copyFile(source, destPath, (err) => {
        if (err) reject(err);
        else resolve(true);
      });
    });
  }
}

module.exports = new DatabaseManager();