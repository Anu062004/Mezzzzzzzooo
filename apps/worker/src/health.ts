import {stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
try{const heartbeat=await stat(join(tmpdir(),'mezoloop-worker-heartbeat'));if(Date.now()-heartbeat.mtimeMs>180000)process.exitCode=1;}catch{process.exitCode=1;}
