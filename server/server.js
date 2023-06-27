const { WebSocketServer } = require('ws');
const crypto = require('crypto');
const express = require('express');
const { Sequelize, DataTypes, Op } = require('sequelize');
const cors = require('cors');

const sequelize = new Sequelize('sqlite::memory:');

const PersistentEvent = sequelize.define('Event', {
  timestamp: DataTypes.BIGINT,
  nonce: DataTypes.STRING,
  data: DataTypes.STRING,
});

const app = express();
const port = 8181;

app.use(cors());

app.get('/', async (req, res) => {
    const [ timestamp, nonce ] = [ parseInt(req.query.timestamp || '0', 10), req.query.nonce || '' ];

    const events = await PersistentEvent.findAll({
        where: {
            timestamp: {
                [Op.gte]: timestamp,
            },
        },
    });

    const response = events.filter(i => {
        if (i.timestamp > timestamp) return true;

        return i.nonce >= nonce;
    });

    res.send(response);
});

app.listen(port, () => {
    console.log(`Example app listening on port ${port}`)
});

const wss = new WebSocketServer({ port: 8080 });

const sockets = [];

(async () => {
    await sequelize.sync();

    setInterval(async () => {
        const eventData = {
            timestamp: Date.now(),
            nonce: Date.now().toString(),
            data: crypto.randomUUID(),
        };
    
        await PersistentEvent.create(eventData);
        await PersistentEvent.destroy({
            where: {
                timestamp: {
                    [Op.lt]: Date.now() - 1000 * 60 * 60,
                }
            }
        });
    
        console.log('queue:item');
    
        sockets.forEach(socket => {
            socket.send(JSON.stringify({
                event: 'queue:item',
                src: 'server',
                data: eventData,
            }));
        });
    }, 3000);
})();

wss.on('connection', function connection(ws) {
    sockets.push(ws);

    ws.on('close', () => {
        const index = sockets.indexOf(ws);

        sockets.splice(index, 1);
    });

    ws.on('error', console.error);
  
    ws.on('message', function message(data) {
        const msg = data.toString();
        console.log('message: ', msg);
        for (const socket of sockets) {
            socket.send(msg);
        }
    });
});
