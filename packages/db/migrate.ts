import { postgres } from './index.js';
import { migrate } from './migrations.js';
if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const {db,close}=postgres(process.env.DATABASE_URL);
try { await migrate(db); console.log('Migrations up to date'); } finally { await close(); }
