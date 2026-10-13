import {neon} from '@neondatabase/serverless';
import {readFile} from 'node:fs/promises';
if(!process.env.DATABASE_URL){console.error('Set DATABASE_URL in your shell before applying the Neon schema.');process.exit(1);}
const sql=neon(process.env.DATABASE_URL);
const source=await readFile(new URL('../db/migrations/001_dock.sql',import.meta.url),'utf8');
for(const statement of source.split(';').map(s=>s.trim()).filter(Boolean))await sql.query(statement);
console.log('Dock the Capsule schema applied.');
