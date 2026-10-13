import {randomBytes,scryptSync} from 'node:crypto';
let password='';for await(const chunk of process.stdin)password+=chunk;
password=password.trimEnd();if(password.length<12){console.error('Supply a staff password of at least 12 characters through stdin.');process.exit(1);}
const salt=randomBytes(16).toString('hex');console.log(`scrypt$${salt}$${scryptSync(password,salt,32).toString('hex')}`);
