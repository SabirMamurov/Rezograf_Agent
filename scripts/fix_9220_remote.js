const {Client} = require('ssh2');
const c = new Client();
c.on('ready', () => {
  const cmd = `cd /var/www/rezograf && node -e "
    const Database = require('better-sqlite3');
    const db = new Database('./prisma/dev.db');
    db.prepare(\\"UPDATE Product SET composition = 'Состав: орехи кедровые расщепленные (жареные в масле), соль пищевая', weight = 'Масса нетто: 100 г', certCode = 'СТО 97588510-048-2021', storageCond = 'Срок годности: 6 месяцев. Хранить при температуре от +7 до +20 0С и относительной влажности не более 70 %' WHERE sku = '9220'\\").run();
    console.log('Fixed on server!');
  "`;
  c.exec(cmd, (err, stream) => {
    if (err) throw err;
    stream.on('data', d => process.stdout.write(d));
    stream.stderr.on('data', d => process.stderr.write(d));
    stream.on('close', () => c.end());
  });
}).connect({host:'192.168.242.112', port:22, username:'user1', password:'1'});
