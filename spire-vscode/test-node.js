const { spawn } = require('child_process');
const p = spawn(process.execPath, ['-v'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }});
p.stdout.on('data', d => console.log(d.toString()));
p.on('close', () => console.log('done'));
