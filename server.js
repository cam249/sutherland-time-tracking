const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

// --- Setup ---
const dbPath = path.join(__dirname, 'database.db');
const db = new Database(dbPath, { verbose: console.log });
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const app = express();
app.use(cors());
app.use(express.json());

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
setInterval(createBackup, 24 * 60 * 60 * 1000);


// --- API Endpoints ---
app.get('/api/data', (req, res) => {
  try {
    const entries = db.prepare("SELECT * FROM entries ORDER BY date DESC, id DESC").all();
    const properties = db.prepare("SELECT * FROM properties").all();
    // MODIFICATION: Fetch all employee data, not just names
    const employees = db.prepare("SELECT * FROM employees ORDER BY name").all();
    const entry_employees = db.prepare("SELECT * FROM entry_employees").all();
    const activeTimers = db.prepare("SELECT * FROM activeTimers").all();

    const entriesWithEmployees = entries.map(entry => ({
      ...entry,
      employees: entry_employees.filter(link => link.entry_id === entry.id).map(link => link.employee_name)
    }));
    
    const timersWithEmployees = activeTimers.map(timer => ({
        ...timer, 
        employees: JSON.parse(timer.employees) 
    }));

    res.json({
      entries: entriesWithEmployees,
      properties: properties.map(p => ({ ...p, services: JSON.parse(p.services || '{}') })),
      // MODIFICATION: Send full employee objects to the client
      employees: employees,
      activeTimers: timersWithEmployees
    });
  } catch (err) {
    console.error("Error fetching data:", err);
    res.status(500).json({ error: "Failed to fetch data from the database." });
  }
});

// Entries
app.post('/api/entries', (req, res) => {
    const { date, client, propertyAddress, service, employees, timeIn, timeOut, totalHours } = req.body;
    try {
        const insertEntry = db.prepare(`INSERT INTO entries (date, client, propertyAddress, service, timeIn, timeOut, totalHours) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        const insertEmployeeLink = db.prepare("INSERT INTO entry_employees (entry_id, employee_name) VALUES (?, ?)");

        const result = db.transaction(() => {
            const info = insertEntry.run(date, client, propertyAddress, service, timeIn, timeOut, totalHours);
            for (const employee of employees) {
                insertEmployeeLink.run(info.lastInsertRowid, employee);
            }
            return info;
        })();
        
        res.status(201).json({ id: result.lastInsertRowid, ...req.body });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/entries/:id', (req, res) => {
  const entryId = parseInt(req.params.id);
  const { date, client, propertyAddress, service, employees, timeIn, timeOut, totalHours } = req.body;
  
  try {
    const updateEntry = db.prepare(`UPDATE entries SET date = ?, client = ?, propertyAddress = ?, service = ?, timeIn = ?, timeOut = ?, totalHours = ? WHERE id = ?`);
    const deleteEmployeeLinks = db.prepare('DELETE FROM entry_employees WHERE entry_id = ?');
    const insertEmployeeLink = db.prepare("INSERT INTO entry_employees (entry_id, employee_name) VALUES (?, ?)");

    db.transaction(() => {
        updateEntry.run(date, client, propertyAddress, service, timeIn, timeOut, totalHours, entryId);
        deleteEmployeeLinks.run(entryId);
        for (const employee of employees) {
            insertEmployeeLink.run(entryId, employee);
        }
    })();
    
    res.json(req.body);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/entries/:id', (req, res) => {
    try {
        db.transaction(() => {
            db.prepare('DELETE FROM entry_employees WHERE entry_id = ?').run(req.params.id);
            db.prepare('DELETE FROM entries WHERE id = ?').run(req.params.id);
        })();
        res.status(204).send();
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// Properties
app.post('/api/properties', (req, res) => {
  const { fullName, address, services } = req.body;
  try {
    const info = db.prepare(`INSERT INTO properties (fullName, address, services) VALUES (?, ?, ?)`).run(fullName, address, JSON.stringify(services));
    res.status(201).json({ id: info.lastInsertRowid, ...req.body });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/properties/:id', (req, res) => {
  const { fullName, address, services } = req.body;
  try {
    db.prepare(`UPDATE properties SET fullName = ?, address = ?, services = ? WHERE id = ?`).run(fullName, address, JSON.stringify(services), req.params.id);
    res.json(req.body);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/properties/:address', (req, res) => {
    try {
        db.transaction(() => {
            db.prepare('DELETE FROM entries WHERE propertyAddress = ?').run(req.params.address);
            db.prepare('DELETE FROM properties WHERE address = ?').run(req.params.address);
        })();
        res.status(204).send();
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// Employees
app.post('/api/employees', (req, res) => {
  try {
    // Note: This assumes new employees are added with only a name. Phone/email can be added via edit.
    db.prepare('INSERT OR IGNORE INTO employees (name) VALUES (?)').run(req.body.name);
    res.status(201).json({ name: req.body.name });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

// MODIFICATION: New endpoint to update employee details
app.put('/api/employees/:name', (req, res) => {
  const { phone, email } = req.body;
  const originalName = req.params.name;

  try {
    // This assumes the employee's name is the primary key and is not being changed.
    db.prepare('UPDATE employees SET phone = ?, email = ? WHERE name = ?')
      .run(phone, email, originalName);
    
    const updatedEmployee = db.prepare('SELECT * FROM employees WHERE name = ?').get(originalName);
    res.json(updatedEmployee);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/employees/:name', (req, res) => {
    try {
        db.transaction(() => {
            db.prepare('DELETE FROM employees WHERE name = ?').run(req.params.name);
            // This will cascade delete from entry_employees if foreign keys are set up correctly.
            // Adding an explicit delete for safety.
            db.prepare('DELETE FROM entry_employees WHERE employee_name = ?').run(req.params.name);
        })();
        res.status(204).send();
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

// Active Timers
app.post('/api/timers', (req, res) => {
    const id = uuidv4();
    const { startTime, date, client, propertyAddress, service, employees } = req.body;
    try {
        db.prepare(`INSERT INTO activeTimers (id, startTime, date, client, propertyAddress, service, employees) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, startTime, date, client, propertyAddress, service, JSON.stringify(employees));
        res.status(201).json({ id, ...req.body });
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/timers/:id', (req, res) => {
    try {
        db.prepare('DELETE FROM activeTimers WHERE id = ?').run(req.params.id);
        res.status(204).send();
    } catch(err) {
        console.error(err.message);
        return res.status(500).json({ error: err.message });
    }
});


// --- Start Server ---
const PORT = 3001;
app.listen(PORT, () => {
  console.log(`✅ Backend server is running at http://localhost:${PORT}`);
});