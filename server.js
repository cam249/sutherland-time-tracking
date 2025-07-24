const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

// --- Setup ---
const dbPath = path.join(__dirname, 'database.db');
console.log('Attempting to connect to database at:', dbPath); // <-- ADD THIS LINE
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to SQLite database:', err.message);
  } else {
    console.log('✅ Connected to the SQLite database.');
    // Enable foreign key support
    db.run("PRAGMA foreign_keys = ON;");
  }
});

const app = express();
app.use(cors());
app.use(express.json());
// Serve static files from the 'public' directory
// app.use(express.static('public'));

// Serve the index.html file for the root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// --- Backup Function ---
const createBackup = async () => {
  const backupDir = path.join(__dirname, 'backups');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileName = `db-backup-${timestamp}.db`;
  const backupFilePath = path.join(backupDir, backupFileName);

  try {
    await fs.mkdir(backupDir, { recursive: true });
    await fs.copyFile(dbPath, backupFilePath);
    console.log(`✅ Backup created: ${backupFileName}`);
  } catch (error) {
    console.error('❌ Failed to create backup:', error);
  }
};

// Schedule daily backups
setInterval(createBackup, 24 * 60 * 60 * 1000);

// --- Helper Functions ---
// Helper to run multiple queries and get all results
const runPromiseAll = (queries) => {
  return Promise.all(queries.map(q =>
    new Promise((resolve, reject) => {
      db.all(q.sql, q.params || [], (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    })
  ));
};

// --- API Endpoints ---

// -- GET all data --
app.get('/api/data', async (req, res) => {
  try {
    const queries = [
      { sql: "SELECT * FROM entries ORDER BY date DESC, id DESC" },
      { sql: "SELECT * FROM properties" },
      { sql: "SELECT name FROM employees ORDER BY name" },
      { sql: "SELECT * FROM entry_employees" },
      { sql: "SELECT * FROM activeTimers" } // Also get active timers
    ];

    const [entries, properties, employees, entry_employees, activeTimers] = await runPromiseAll(queries);

    // Stitch the employee names back onto the entries
    const entriesWithEmployees = entries.map(entry => {
      const relatedEmployees = entry_employees
        .filter(link => link.entry_id === entry.id)
        .map(link => link.employee_name);
      return { ...entry, employees: relatedEmployees };
    });
    
    // Stitch employees onto active timers as well
    const timersWithEmployees = activeTimers.map(timer => {
        return {...timer, employees: JSON.parse(timer.employees) };
    });

    res.json({
      entries: entriesWithEmployees,
      properties: properties.map(p => ({ ...p, services: JSON.parse(p.services || '{}') })),
      employees: employees.map(e => e.name),
      activeTimers: timersWithEmployees
    });
  } catch (err) {
    console.error("Error fetching data:", err);
    res.status(500).json({ error: "Failed to fetch data from the database." });
  }
});

// -- ENTRIES --
app.post('/api/entries', (req, res) => {
  const { date, client, propertyAddress, service, employees, timeIn, timeOut, totalHours } = req.body;
  const sql = `INSERT INTO entries (date, client, propertyAddress, service, timeIn, timeOut, totalHours) VALUES (?, ?, ?, ?, ?, ?, ?)`;

  db.run(sql, [date, client, propertyAddress, service, timeIn, timeOut, totalHours], function (err) {
    if (err) {
      console.error(err.message);
      return res.status(500).json({ error: err.message });
    }
    const entryId = this.lastID;
    const stmt = db.prepare("INSERT INTO entry_employees (entry_id, employee_name) VALUES (?, ?)");
    for (const employee of employees) {
      stmt.run(entryId, employee);
    }
    stmt.finalize((err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ id: entryId, ...req.body });
    });
  });
});

app.put('/api/entries/:id', (req, res) => {
  const entryId = parseInt(req.params.id);
  const { date, client, propertyAddress, service, employees, timeIn, timeOut, totalHours } = req.body;
  const sql = `UPDATE entries SET date = ?, client = ?, propertyAddress = ?, service = ?, timeIn = ?, timeOut = ?, totalHours = ? WHERE id = ?`;

  db.serialize(() => {
    db.run('BEGIN TRANSACTION;');
    db.run(sql, [date, client, propertyAddress, service, timeIn, timeOut, totalHours, entryId]);
    db.run('DELETE FROM entry_employees WHERE entry_id = ?', [entryId]);
    const stmt = db.prepare("INSERT INTO entry_employees (entry_id, employee_name) VALUES (?, ?)");
    for (const employee of employees) {
      stmt.run(entryId, employee);
    }
    stmt.finalize();
    db.run('COMMIT;', (err) => {
        if(err) {
            console.error(err.message);
            return res.status(500).json({ error: err.message });
        }
        res.json(req.body);
    });
  });
});

app.delete('/api/entries/:id', (req, res) => {
  const entryId = parseInt(req.params.id);
  db.serialize(() => {
      db.run('DELETE FROM entry_employees WHERE entry_id = ?', [entryId]);
      db.run('DELETE FROM entries WHERE id = ?', [entryId], (err) => {
        if (err) {
            console.error(err.message);
            return res.status(500).json({ error: err.message });
        }
        res.status(204).send();
      });
  });
});


// -- PROPERTIES --
app.post('/api/properties', (req, res) => {
  const { fullName, address, services } = req.body;
  const sql = `INSERT INTO properties (fullName, address, services) VALUES (?, ?, ?)`;
  db.run(sql, [fullName, address, JSON.stringify(services)], function(err) {
    if(err) {
        console.error(err.message);
        return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ id: this.lastID, ...req.body });
  });
});

app.put('/api/properties/:id', (req, res) => {
  const propId = parseInt(req.params.id);
  const { fullName, address, services } = req.body;
  const sql = `UPDATE properties SET fullName = ?, address = ?, services = ? WHERE id = ?`;
  db.run(sql, [fullName, address, JSON.stringify(services), propId], function(err) {
    if(err) {
        console.error(err.message);
        return res.status(500).json({ error: err.message });
    }
    res.json(req.body);
  });
});

app.delete('/api/properties/:address', (req, res) => {
  const propAddress = req.params.address;
  db.serialize(() => {
    // Also delete associated time entries
    db.run('DELETE FROM entries WHERE propertyAddress = ?', [propAddress]);
    db.run('DELETE FROM properties WHERE address = ?', [propAddress], (err) => {
        if(err) {
            console.error(err.message);
            return res.status(500).json({ error: err.message });
        }
        res.status(204).send();
    });
  });
});

// -- EMPLOYEES --
app.post('/api/employees', (req, res) => {
  const { name } = req.body;
  db.run('INSERT OR IGNORE INTO employees (name) VALUES (?)', [name], function(err) {
    if(err) {
        console.error(err.message);
        return res.status(500).json({ error: err.message });
    }
    res.status(201).json({ name });
  });
});

app.delete('/api/employees/:name', (req, res) => {
  const employeeName = req.params.name;
  db.run('DELETE FROM employees WHERE name = ?', [employeeName], function(err) {
    if(err) {
        console.error(err.message);
        return res.status(500).json({ error: err.message });
    }
    // Also remove them from any entries
    db.run('DELETE FROM entry_employees WHERE employee_name = ?', [employeeName]);
    res.status(204).send();
  });
});


// --- ACTIVE TIMERS ENDPOINTS --- (Using a separate table for simplicity)
app.post('/api/timers', (req, res) => {
    const id = uuidv4();
    const { startTime, date, client, propertyAddress, service, employees } = req.body;
    // Store employees array as a JSON string in the database
    const sql = `INSERT INTO activeTimers (id, startTime, date, client, propertyAddress, service, employees) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    db.run(sql, [id, startTime, date, client, propertyAddress, service, JSON.stringify(employees)], function(err) {
        if(err) {
            console.error(err.message);
            return res.status(500).json({ error: err.message });
        }
        res.status(201).json({ id, ...req.body });
    });
});

app.delete('/api/timers/:id', (req, res) => {
    const timerId = req.params.id;
    db.run('DELETE FROM activeTimers WHERE id = ?', [timerId], function(err) {
        if(err) {
            console.error(err.message);
            return res.status(500).json({ error: err.message });
        }
        res.status(204).send();
    });
});


// --- Start Server ---
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend server is running at http://localhost:${PORT}`);
});