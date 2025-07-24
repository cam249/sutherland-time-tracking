const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to the new database using a specific path
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);

// Read the old JSON data from db.json
const data = JSON.parse(fs.readFileSync(path.join(__dirname, 'db.json')));

db.serialize(() => {
    console.log('Starting data migration...');

    // Migrate Properties
    const propStmt = db.prepare("INSERT INTO properties (id, fullName, address, services) VALUES (?, ?, ?, ?)");
    for (const prop of data.properties) {
        propStmt.run(prop.id, prop.fullName, prop.address, JSON.stringify(prop.services || {}));
    }
    propStmt.finalize();
    console.log(`${data.properties.length} properties migrated.`);

    // Migrate Employees
    const empStmt = db.prepare("INSERT INTO employees (name) VALUES (?)");
    for (const emp of data.employees) {
        empStmt.run(emp);
    }
    empStmt.finalize();
    console.log(`${data.employees.length} employees migrated.`);

    // Migrate Entries and their Employee links (Corrected Logic)
    const entryStmt = db.prepare(`INSERT INTO entries (id, date, client, propertyAddress, service, timeIn, timeOut, totalHours) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const linkStmt = db.prepare("INSERT INTO entry_employees (entry_id, employee_name) VALUES (?, ?)");
    
    for (const entry of data.entries) {
        const timeIn = entry.TimeIn || entry.timeIn;
        const timeOut = entry.TimeOut || entry.timeOut;

        // Run the main entry insert
        entryStmt.run(entry.id, entry.date, entry.client, entry.propertyAddress, entry.service, timeIn, timeOut, entry.totalHours);

        // Immediately run the employee link inserts
        if (entry.employees && entry.employees.length > 0) {
            for (const empName of entry.employees) {
                linkStmt.run(entry.id, empName);
            }
        }
    }
    entryStmt.finalize();
    linkStmt.finalize();
    console.log(`${data.entries.length} entries migrated.`);
    
    console.log('---');
    console.log('✅ Migration Complete!');
});

db.close();