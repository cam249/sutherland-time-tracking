// setup.js
const sqlite3 = require('sqlite3').verbose();

// This creates a new file called 'database.db' - this is your new, smart storage system!
const db = new sqlite3.Database('./database.db', (err) => {
  if (err) {
    console.error(err.message);
  }
  console.log('Connected to the SQLite database.');
});

// We'll tell the database to create our "drawers" (tables)
db.serialize(() => {
  // A drawer for properties
  db.run(`CREATE TABLE properties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fullName TEXT,
    address TEXT UNIQUE,
    services TEXT
  )`);

  // A drawer for employees
  db.run(`CREATE TABLE employees (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE
  )`);

  // A drawer for time entries
  db.run(`CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    client TEXT,
    propertyAddress TEXT,
    service TEXT,
    timeIn TEXT,
    timeOut TEXT,
    totalHours TEXT
  )`);

  // A special drawer to remember which employees worked on which entry
  db.run(`CREATE TABLE entry_employees (
    entry_id INTEGER,
    employee_name TEXT,
    FOREIGN KEY(entry_id) REFERENCES entries(id)
  )`);



// A drawer for active timers
db.run(`CREATE TABLE activeTimers (
  id TEXT PRIMARY KEY,
  startTime TEXT,
  date TEXT,
  client TEXT,
  propertyAddress TEXT,
  service TEXT,
  employees TEXT
)`);

  console.log('Tables created successfully!');
});

db.close();